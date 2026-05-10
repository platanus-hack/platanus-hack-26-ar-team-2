/**
 * Settlement loop — corre dentro del worker Fly y materializa los pagos USDC
 * direct brand → creator que el accept endpoint deja pendientes.
 *
 * Flow:
 *   1. accept endpoint (apps/web) marca offer como accepted, INSERTa kind='brand'
 *      con payload.payment_status='pending_settlement' (sin tx_hash).
 *   2. Este loop pollea cada SETTLEMENT_INTERVAL_MS (default 2s) y agarra hasta
 *      SETTLEMENT_BATCH (default 5) rows con FOR UPDATE SKIP LOCKED.
 *   3. Por cada row: resuelve brand wallet + creator wallet, signTransferUsdc
 *      (live broadcasta en Base mainnet, mock devuelve hash sintético),
 *      UPDATEa payload con el resultado (payment + payment_status='settled' |
 *      'failed') + pg_notify para que el dock pueda mostrar el tx_hash.
 *
 * Idempotency: el FOR UPDATE SKIP LOCKED previene que dos workers se peleen
 * por la misma row. Si la firma falla, marcamos payment_status='failed' +
 * payment_error; un retry manual desde el dock puede flippearlo a
 * 'pending_settlement' otra vez.
 */

import type { Pool, PoolClient } from "pg";
import type { Address } from "viem";

import { signTransferUsdc } from "./chain/privy.js";
import { usdcAmount } from "./chain/escrow.js";
import { getCreatorWallet } from "./chain/wallets.js";

const INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS ?? 2000);
const BATCH = Number(process.env.SETTLEMENT_BATCH ?? 5);

type PendingRow = {
  id: string;
  creator_id: string;
  bid_usdc_cents: number | null;
  payload: Record<string, unknown> | null;
};

type PaymentRecord = {
  tx_hash: string;
  mode: "live" | "mock";
  payer_address: string;
  payer_brand_id: string;
  payee_address: string;
  amount_usdc_cents: number;
  amount_usdc: number;
  signed_at: string;
};

async function pickPending(client: PoolClient): Promise<PendingRow[]> {
  // FOR UPDATE SKIP LOCKED → si otro worker (o un retry concurrent del mismo)
  // ya tomó la row, la salteamos. La transacción que envuelve esto se cierra
  // ENSEGUIDA (justo después de este SELECT no escribimos nada hasta que
  // procesamos cada row con su propio commit). Por eso devolvemos rows acá
  // y rehacemos el lock dentro de settleOne con su propia tx.
  const res = await client.query<PendingRow>(
    `select id, creator_id, bid_usdc_cents, payload
       from render_events
      where kind = 'brand'
        and status = 'accepted'
        and (payload->>'payment_status') = 'pending_settlement'
      order by created_at asc
      limit $1
      for update skip locked`,
    [BATCH],
  );
  return res.rows;
}

async function settleOne(pool: Pool, row: PendingRow): Promise<void> {
  const t0 = Date.now();
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const brandSlug =
    typeof payload.brand_id === "string" ? payload.brand_id : null;
  const bidUsdcCents = row.bid_usdc_cents ?? 0;

  if (!brandSlug || bidUsdcCents <= 0) {
    // Nada que firmar — marcamos failed con razón clara así no se reprocesan.
    await markFailed(
      pool,
      row.id,
      !brandSlug
        ? "missing brand_id in payload"
        : `bid_usdc_cents=${bidUsdcCents}`,
    );
    console.warn(
      JSON.stringify({
        tag: "settlement:skip_no_inputs",
        row_id: row.id,
        brand_slug: brandSlug,
        bid_usdc_cents: bidUsdcCents,
      }),
    );
    return;
  }

  try {
    const creator = await getCreatorWallet(pool, row.creator_id);
    const amountUsdc = bidUsdcCents / 100;
    const result = await signTransferUsdc(pool, {
      brandSlug,
      to: creator.address as Address,
      amount: usdcAmount(amountUsdc.toFixed(6)),
    });

    const payment: PaymentRecord = {
      tx_hash: result.txHash,
      mode: result.mode,
      payer_address: result.payer.address,
      payer_brand_id: result.payer.slug,
      payee_address: result.payee_address,
      amount_usdc_cents: bidUsdcCents,
      amount_usdc: amountUsdc,
      signed_at: new Date().toISOString(),
    };

    await markSettled(pool, row.id, row.creator_id, payment);

    console.log(
      JSON.stringify({
        tag: "settlement:settled",
        row_id: row.id,
        brand_slug: brandSlug,
        creator_id: row.creator_id,
        tx_hash: result.txHash,
        mode: result.mode,
        amount_usdc: amountUsdc,
        latency_ms: Date.now() - t0,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(pool, row.id, message);
    console.error(
      JSON.stringify({
        tag: "settlement:error",
        row_id: row.id,
        brand_slug: brandSlug,
        creator_id: row.creator_id,
        error: message,
        latency_ms: Date.now() - t0,
      }),
    );
  }
}

async function markSettled(
  pool: Pool,
  rowId: string,
  creatorId: string,
  payment: PaymentRecord,
): Promise<void> {
  // Single UPDATE: jsonb_set anidado para payment + payment_status; limpiamos
  // payment_error si venía de un retry post-failure.
  const res = await pool.query<{ payload: Record<string, unknown> }>(
    `update render_events
        set payload = (payload
                        - 'payment_error')
                      || jsonb_build_object(
                           'payment', $2::jsonb,
                           'payment_status', 'settled'
                         )
      where id = $1
      returning payload`,
    [rowId, JSON.stringify(payment)],
  );
  // pg_notify para que el dock pueda actualizar la card con el tx_hash sin
  // re-fetchear. Reusamos el canal render_events del overlay con el shape de
  // siempre (creator_id:event_id:json).
  const updatedPayload = res.rows[0]?.payload ?? {};
  const sseEvent = {
    id: rowId,
    creator_id: creatorId,
    kind: "brand",
    settlement_update: true,
    ...updatedPayload,
  };
  await pool.query("select pg_notify('render_events', $1)", [
    `${creatorId}:${rowId}:${JSON.stringify(sseEvent)}`,
  ]);
}

async function markFailed(
  pool: Pool,
  rowId: string,
  reason: string,
): Promise<void> {
  await pool.query(
    `update render_events
        set payload = payload || jsonb_build_object(
                                   'payment_status', 'failed',
                                   'payment_error', $2::text
                                 )
      where id = $1`,
    [rowId, reason],
  );
}

async function tickOnce(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let rows: PendingRow[] = [];
  try {
    await client.query("BEGIN");
    rows = await pickPending(client);
    // Marcamos cada row con un payment_status='settling' para que un segundo
    // tick (en el mismo worker) no la agarre mientras procesamos. SKIP LOCKED
    // ya nos cubre cross-worker, pero esto cubre la ventana entre commit del
    // BEGIN y el await async de signTransferUsdc.
    if (rows.length > 0) {
      await client.query(
        `update render_events
            set payload = payload || jsonb_build_object('payment_status', 'settling')
          where id = any($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Procesamos cada row fuera de la tx — signTransferUsdc puede tardar (RPC
  // a Privy + Base) y no queremos un tx abierto durante todo el batch.
  for (const row of rows) {
    await settleOne(pool, row);
  }
  return rows.length;
}

export function startSettlementLoop(pool: Pool): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = async () => {
    if (stopped) return;
    try {
      const n = await tickOnce(pool);
      if (n > 0) {
        console.log(
          JSON.stringify({ tag: "settlement:batch_done", processed: n }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          tag: "settlement:loop_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(run, INTERVAL_MS);
      }
    }
  };

  console.log(
    JSON.stringify({
      tag: "settlement:start",
      interval_ms: INTERVAL_MS,
      batch: BATCH,
      live: process.env.CHAIN_LIVE_TXS === "true",
    }),
  );
  // primera corrida ya — no esperamos el primer interval.
  timer = setTimeout(run, 0);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

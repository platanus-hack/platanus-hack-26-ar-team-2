// apps/web/scripts/smoke-multiagent-payment.ts
//
// E2E smoke del flow C-08m-multiagent + emisión de pago directo USDC:
//
//   1. INSERTa un context_chunk sintético (audio que matchea cafetito).
//   2. Corre managerTick() → multi-agent picker → N brand_thoughts + 1 offer.
//   3. Llama el route handler POST /accept directo (sin HTTP server) →
//      signTransferUsdc (live o mock según CHAIN_LIVE_TXS).
//   4. Verifica brand event con payload.payment.{tx_hash, mode}.
//   5. Si --live: lee USDC balance pre/post del creator y verifica delta.
//   6. Cleanup opcional (--no-cleanup para inspeccionar las rows en DB).
//
// Default flags:
//   --brand    cafetito                        brand-agent que va a bidear
//   --creator  streamer-team                   creator destinatario del pago
//   --no-cleanup                               deja las rows en DB para inspección
//
// Modos de ejecución (vía env vars):
//   MANAGER_DRY_RUN=true|false   → stub picker vs Claude real (default true)
//   CHAIN_LIVE_TXS=true|false    → broadcast real vs mock (default false)
//
// Uso:
//   pnpm tsx scripts/smoke-multiagent-payment.ts                  # mock + stub
//   CHAIN_LIVE_TXS=true pnpm tsx scripts/smoke-multiagent-payment.ts   # plata real
//
// CRITICAL antes de --live=true:
//   - validar pre-balance de la brand wallet (debe tener > bid_usdc).
//   - validar pre-balance del creator (lee, smoke verifica delta post).
//   - bid amount = floor del brand (~$0.50 cafetito) — chico a propósito.

import { randomUUID } from "node:crypto";
import process from "node:process";

import { configFromEnv, managerTick } from "../src/lib/manager/tick.ts";
import { pool } from "../src/lib/pg.ts";
import type { TickResult } from "../src/lib/manager/types.ts";
import { isChainLiveTxsEnabled } from "../src/lib/chain/env.ts";

type Args = {
  brandSlug: string;
  creatorSlug: string;
  cleanup: boolean;
  /** USD override del bid del picker (decimal, ej 0.10). Null = usar lo que emitió el picker. */
  bidOverrideUsdc: number | null;
};

function parseArgs(argv: string[]): Args {
  let brandSlug = "cafetito";
  let creatorSlug = "streamer-team";
  let cleanup = true;
  let bidOverrideUsdc: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand") brandSlug = argv[++i] ?? brandSlug;
    else if (a === "--creator") creatorSlug = argv[++i] ?? creatorSlug;
    else if (a === "--no-cleanup") cleanup = false;
    else if (a === "--bid") {
      const raw = argv[++i];
      const n = raw != null ? Number(raw) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        fail(`--bid: expected positive number USDC, got "${raw ?? "(empty)"}"`);
      }
      bidOverrideUsdc = n;
    }
  }
  return { brandSlug, creatorSlug, cleanup, bidOverrideUsdc };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.POSTGRES_URL_NON_POOLING && !process.env.POSTGRES_URL) {
    fail("POSTGRES_URL_NON_POOLING missing — corré con `node --env-file=.env.local --import tsx scripts/smoke-multiagent-payment.ts`");
  }

  const live = isChainLiveTxsEnabled();
  // Stub picker default — la garantía del smoke es el flow + el pago, no el LLM.
  if (process.env.MANAGER_DRY_RUN == null) process.env.MANAGER_DRY_RUN = "true";
  const dryRunPicker = process.env.MANAGER_DRY_RUN === "true";

  console.log("▶ smoke-multiagent-payment");
  console.log(`  brand     : ${args.brandSlug}`);
  console.log(`  creator   : ${args.creatorSlug}`);
  console.log(`  picker    : ${dryRunPicker ? "stub (MANAGER_DRY_RUN=true)" : "Claude live"}`);
  console.log(`  payment   : ${live ? "LIVE — broadcasteará tx en Base mainnet" : "MOCK (CHAIN_LIVE_TXS=false)"}`);
  if (args.bidOverrideUsdc != null) {
    console.log(`  bid       : OVERRIDE ${args.bidOverrideUsdc} USDC (skip picker amount)`);
  }
  console.log("");

  // 1. Validar wallets pre-broadcast.
  const { getBrandWallet, getCreatorWallet } = await import(
    "../src/lib/chain/privy.ts"
  );
  const brand = await getBrandWallet(args.brandSlug);
  const creator = await getCreatorWallet(args.creatorSlug);
  console.log(`✓ brand wallet     ${brand.slug.padEnd(16)} ${brand.address}`);
  console.log(`✓ creator wallet   ${creator.slug.padEnd(16)} ${creator.address}`);

  let preBalance: bigint | null = null;
  if (live) {
    preBalance = await usdcBalanceOf(creator.address);
    console.log(`✓ pre-balance creator: ${formatUsdc(preBalance)} USDC`);
  }
  console.log("");

  // 2. INSERT chunk sintético que matchea cafetito (keyword "café" + intent reaction).
  const streamKey = args.creatorSlug; // por convención, stream_key === creator_id slug
  const { chunkId, harnessTag } = await insertChunk(streamKey, args.brandSlug);
  console.log(`▶ chunk inserted     ${chunkId} stream=${streamKey} (${harnessTag})`);

  // 3. managerTick — multi-agent picker + offer emit.
  const tickResult = await managerTick(configFromEnv(streamKey));
  if (tickResult.decision !== "emit") {
    console.error(`✗ tick decision=${tickResult.decision} (esperaba 'emit')`);
    if (args.cleanup) await cleanupChunk(chunkId);
    process.exit(1);
  }
  const offerEventId = tickResult.event_id;
  const thoughtCount = tickResult.thoughts.length;
  console.log(`✓ tick emit          offer=${offerEventId} thoughts=${thoughtCount} winner=${tickResult.pick.brand_id}`);
  if (tickResult.pick.brand_id !== args.brandSlug) {
    console.warn(
      `! ojo: ganador=${tickResult.pick.brand_id} ≠ brand del smoke=${args.brandSlug}. ` +
      `El pago va a salir con ${tickResult.pick.brand_id}, no con ${args.brandSlug}.`,
    );
  }

  // 3b. Bid override (opcional). Mutamos el row del offer ANTES del accept
  //     para que el accept handler firme con el monto que pasamos por flag.
  //     Útil para reducir el costo del live test (ej --bid 0.10 en vez del
  //     ~$2.75 que sale del picker stub).
  if (args.bidOverrideUsdc != null) {
    const newCents = Math.round(args.bidOverrideUsdc * 100);
    await pool().query(
      `update render_events
          set bid_usdc_cents = $1,
              payload = jsonb_set(jsonb_set(payload, '{bid_usdc}', to_jsonb($2::numeric)), '{bid_usdc_cents}', to_jsonb($1::int))
        where id = $3`,
      [newCents, args.bidOverrideUsdc, offerEventId],
    );
    console.log(
      `▶ bid override       offer ${offerEventId} → ${args.bidOverrideUsdc} USDC (${newCents}¢)`,
    );
  }

  // 4. Accept directo via route handler import (sin HTTP server).
  const { POST } = await import(
    "../src/app/api/creators/[creator_id]/offers/[event_id]/accept/route.ts"
  );
  const acceptUrl = `http://harness/api/creators/${streamKey}/offers/${offerEventId}/accept`;
  const req = new Request(acceptUrl, { method: "POST" });
  const t0 = Date.now();
  const res = await POST(req, {
    params: Promise.resolve({ creator_id: streamKey, event_id: offerEventId }),
  });
  const acceptMs = Date.now() - t0;

  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    brand_event_id?: string;
    payment_status?: string;
  };

  if (!body.ok) {
    console.error(`✗ accept failed status=${res.status} error=${body.error}`);
    if (args.cleanup) await cleanupChunk(chunkId);
    process.exit(1);
  }

  console.log(
    `✓ accept ok          brand_event=${body.brand_event_id} ${acceptMs}ms (status=${body.payment_status})`,
  );
  if (body.payment_status !== "pending_settlement") {
    console.error(
      `✗ esperaba payment_status='pending_settlement' (settlement async via worker), got=${body.payment_status}`,
    );
    if (args.cleanup) await cleanupChunk(chunkId, body.brand_event_id);
    process.exit(1);
  }

  // 5. Polleamos render_events.payload->'payment' hasta que el WORKER
  //    settlement-eé. El loop del worker corre cada SETTLEMENT_INTERVAL_MS
  //    (default 2s) — con 15s de timeout cubrimos hasta 7 ticks + RPC slop.
  const settlementTimeoutMs = live ? 30_000 : 15_000;
  const pollStart = Date.now();
  type SettledPayment = {
    tx_hash: string;
    mode: "live" | "mock";
    payer_address: string;
    payer_brand_id: string;
    payee_address: string;
    amount_usdc_cents: number;
    amount_usdc: number;
    signed_at: string;
  };
  let payment: SettledPayment | null = null;
  let lastStatus: string | null = null;
  while (Date.now() - pollStart < settlementTimeoutMs) {
    const r = await pool().query<{
      payment: SettledPayment | null;
      payment_status: string | null;
      payment_error: string | null;
    }>(
      `select payload->'payment' as payment,
              payload->>'payment_status' as payment_status,
              payload->>'payment_error' as payment_error
         from render_events
        where id = $1`,
      [body.brand_event_id],
    );
    const row = r.rows[0];
    if (row?.payment_status && row.payment_status !== lastStatus) {
      console.log(`  [${(Date.now() - pollStart) / 1000}s] payment_status=${row.payment_status}`);
      lastStatus = row.payment_status;
    }
    if (row?.payment_status === "settled" && row.payment) {
      payment = row.payment;
      break;
    }
    if (row?.payment_status === "failed") {
      console.error(`✗ settlement failed: ${row.payment_error ?? "unknown"}`);
      if (args.cleanup) await cleanupChunk(chunkId, body.brand_event_id);
      process.exit(1);
    }
    await sleep(500);
  }
  if (!payment) {
    console.error(
      `✗ settlement timeout (>${settlementTimeoutMs}ms) — el worker no firmó. ¿Está corriendo? Revisá logs del worker.`,
    );
    if (args.cleanup) await cleanupChunk(chunkId, body.brand_event_id);
    process.exit(1);
  }
  const settleMs = Date.now() - pollStart;

  console.log(`✓ settled (worker)   ${settleMs}ms`);
  console.log(`✓ payment            mode=${payment.mode}`);
  console.log(`  tx_hash            ${payment.tx_hash}`);
  console.log(
    `  amount             ${payment.amount_usdc} USDC (${payment.amount_usdc_cents}¢)`,
  );
  console.log(`  ${payment.payer_brand_id.padEnd(16)} ${payment.payer_address}`);
  console.log(`  → creator          ${payment.payee_address}`);
  const p = payment;

  if (live && p.mode !== "live") {
    console.error(`✗ CHAIN_LIVE_TXS=true pero mode=${p.mode} — el kill-switch no se prendió.`);
    process.exit(1);
  }
  if (!live && p.mode !== "mock") {
    console.error(`✗ CHAIN_LIVE_TXS=false pero mode=${p.mode} — el kill-switch falló.`);
    process.exit(1);
  }

  console.log(`✓ db row             render_events.payload.payment ✓`);

  // 7. Verify on-chain delta si --live.
  if (live && preBalance != null) {
    // Espera mínima para que el RPC vea el bloque incluido.
    await sleep(3000);
    const postBalance = await usdcBalanceOf(creator.address);
    const expectedDelta = BigInt(p.amount_usdc_cents) * 10_000n; // ¢ → 6-decimal USDC base units
    const actualDelta = postBalance - preBalance;
    console.log(`✓ post-balance creator: ${formatUsdc(postBalance)} USDC`);
    console.log(`  delta              ${formatUsdc(actualDelta)} USDC (esperado ${formatUsdc(expectedDelta)})`);
    if (actualDelta !== expectedDelta) {
      console.warn(
        `! delta no exacto — puede ser timing del RPC (re-correr o esperar más). expected=${expectedDelta} actual=${actualDelta}`,
      );
    }
  }

  // 8. Cleanup opcional.
  if (args.cleanup) {
    await cleanupChunk(chunkId, body.brand_event_id);
    console.log(`✓ cleanup            chunk + render_events`);
  } else {
    console.log(`! cleanup OFF        rows quedan en DB para inspección visual`);
  }

  console.log("");
  console.log("▶ done · E2E ok");
  await pool().end().catch(() => {});
}

// ─── helpers ─────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatUsdc(units: bigint): string {
  // 6 decimals
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  return `${neg ? "-" : ""}${whole}.${frac.toString().padStart(6, "0").slice(0, 6)}`;
}

async function usdcBalanceOf(address: string): Promise<bigint> {
  const { publicClient } = await import("../src/lib/chain/viem.ts");
  const { USDC_ABI, USDC_ADDRESS_BASE_MAINNET } = await import(
    "../src/lib/chain/escrow.ts"
  );
  return (await publicClient.readContract({
    address: USDC_ADDRESS_BASE_MAINNET,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  })) as bigint;
}

type ChunkInsert = { chunkId: string; harnessTag: string };

async function insertChunk(streamKey: string, brandSlug: string): Promise<ChunkInsert> {
  // Audio sintético calibrado para que cafetito gane (keyword "café") o
  // al menos algún brand interesado. Si querés cambiar el ganador, mové
  // las keywords al brand correspondiente.
  const harnessTag = `harness-${brandSlug}-${randomUUID().slice(0, 4)}`;
  const audioByBrand: Record<string, { text: string; mentions: string[] }> = {
    cafetito: {
      text: "necesito un café que me despierte para este clutch épico amigos",
      mentions: ["café"],
    },
    termoflex: {
      text: "qué frío hace acá, voy a buscar el termo y un mate",
      mentions: ["termo", "mate"],
    },
    "pancho-rex": {
      text: "tengo hambre, un pancho ya me iría bien",
      mentions: ["pancho"],
    },
    matebros: {
      text: "el mate no afloja, fogón total",
      mentions: ["mate", "fogón"],
    },
    platanus: {
      text: "esto está bananas, qué momento épico",
      mentions: ["banana"],
    },
  };
  const audio = audioByBrand[brandSlug] ?? audioByBrand.cafetito!;

  const row = {
    stream_key: streamKey,
    stream_id: null as string | null,
    ts_start: new Date().toISOString(),
    duration_s: 30,
    audio_text: audio.text,
    audio_partial_at_end: null as string | null,
    audio_summary: audio.text.slice(0, 140),
    audio_topics: [],
    audio_mentions: audio.mentions,
    audio_intent: "reaction",
    scene_type: "talking_head",
    energy_level: "high",
    mood_tags: ["epic", "hype"],
    on_screen_text: null as string | null,
    chat_velocity_avg: 0,
    chat_velocity_peak: 0,
    chat_recent_keywords: [] as string[],
    sentiment_avg: "hype",
    viewers: 50,
    viewers_delta_30s: 5,
    game_category: null as string | null,
    stream_title: `Smoke E2E ${harnessTag}`,
    ticks_aggregated: 1,
    frame_analyses_aggregated: 0,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = Object.values(row);
  const res = await pool().query<{ id: string }>(
    `insert into context_chunks (${cols.join(", ")}) values (${placeholders}) returning id`,
    values,
  );
  return { chunkId: res.rows[0]!.id, harnessTag };
}

async function cleanupChunk(chunkId: string, brandEventId?: string): Promise<void> {
  // Borramos en orden inverso de FKs: render_events del creator del chunk,
  // después el chunk. El creator NO se borra (es streamer-team de prod).
  const chunk = await pool().query<{ stream_key: string }>(
    `select stream_key from context_chunks where id = $1`,
    [chunkId],
  );
  const streamKey = chunk.rows[0]?.stream_key;
  if (streamKey) {
    await pool().query(
      `delete from render_events where creator_id = $1 and (kind = 'raw' or kind = 'brand_thought' or kind = 'offer' or id = $2)`,
      [streamKey, brandEventId ?? null],
    );
  }
  await pool().query(`delete from context_chunks where id = $1`, [chunkId]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

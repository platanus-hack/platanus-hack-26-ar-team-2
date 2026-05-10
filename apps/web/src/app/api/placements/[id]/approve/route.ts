/**
 * POST /api/placements/[id]/approve
 *
 * Aprueba un placement_request:
 *   1. UPDATE placement_requests SET status='approved' WHERE id=$1 AND status='pending'
 *      → atómico. Si dos approves llegan, el segundo no actualiza nada (RETURNING
 *        vacío) → 409. Idempotencia a nivel SQL, no a nivel app.
 *   2. INSERT render_events con kind='brand', message+payload del request.
 *      → es lo que el OBS overlay (vía worker SSE /events/:creator) renderiza.
 *   3. UPDATE placement_requests.render_event_id (UNIQUE) → garantiza un único
 *      render por approval. Si algo intentara linkear dos render_events al mismo
 *      request, el UNIQUE rebota.
 *   4. pg_notify('render_events', '<creator>:<event_id>:<json>') — el worker
 *      ya está LISTEN en este channel y broadcast SSE al overlay.
 *
 * Todo en una sola transacción. Si crashea entre el INSERT y el pg_notify, el
 * rollback deshace el approve completo y el creator puede reintentar.
 *
 * Pago on-chain (futuro): placement_requests.id es la idempotency key del
 * lockEscrow. Por ahora marcamos status='approved' y eso cuenta como "pago
 * commiteado" en DB.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";

type PlacementRequestRow = {
  id: string;
  creator_id: string;
  brand_id: string;
  brand_display_name: string;
  message: string;
  payload: Record<string, unknown> | null;
  bid_usdc: string;
  expires_at: string;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    return NextResponse.json(
      { ok: false, error: "id must be a uuid" },
      { status: 400 },
    );
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // 1. Atomic transition pending → approved. Si ya está approved/denied/expired,
    //    RETURNING viene vacío → 409.
    const upd = await client.query<PlacementRequestRow>(
      `update placement_requests
          set status = 'approved', decided_at = now()
        where id = $1
          and status = 'pending'
          and expires_at > now()
        returning id, creator_id, brand_id, brand_display_name, message,
                  payload, bid_usdc, expires_at`,
      [id],
    );

    if (upd.rows.length === 0) {
      // Distinguir entre "ya decidido" vs "expirado" vs "no existe" para mejor UX.
      const existing = await client.query<{ status: string; expires_at: string }>(
        `select status, expires_at from placement_requests where id = $1`,
        [id],
      );
      await client.query("ROLLBACK");

      if (existing.rows.length === 0) {
        return NextResponse.json(
          { ok: false, error: "placement_request not found" },
          { status: 404 },
        );
      }
      const row = existing.rows[0]!;
      if (row.status !== "pending") {
        return NextResponse.json(
          { ok: false, error: `already ${row.status}`, status: row.status },
          { status: 409 },
        );
      }
      // status='pending' pero filtró por expires_at → expirado.
      return NextResponse.json(
        { ok: false, error: "expired", expires_at: row.expires_at },
        { status: 410 },
      );
    }

    const reqRow = upd.rows[0]!;

    // 2. INSERT render_event con el ad real. El payload del request ya tiene
    //    chunk_id + asset_url (si la brand tenía asset). Le agregamos el
    //    placement_request_id para trazabilidad (auditoría on-chain futura).
    const enrichedPayload = {
      ...(reqRow.payload ?? {}),
      placement_request_id: reqRow.id,
      bid_usdc: Number(reqRow.bid_usdc),
    };

    const ins = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, payload)
       values ($1, $2, 'brand', $3)
       returning id, created_at`,
      [
        reqRow.creator_id,
        reqRow.message,
        JSON.stringify(enrichedPayload),
      ],
    );
    const eventRow = ins.rows[0]!;

    // 3. Linkear render_event al request — UNIQUE constraint garantiza 1:1.
    await client.query(
      `update placement_requests set render_event_id = $1 where id = $2`,
      [eventRow.id, reqRow.id],
    );

    // 4. pg_notify('render_events', ...) — el worker LISTEN está en este channel
    //    y broadcast SSE al overlay de OBS. Mismo formato que usaba el worker
    //    cuando insertaba directo (<creator>:<event_id>:<json>).
    const sseEvent = {
      id: eventRow.id,
      creator_id: reqRow.creator_id,
      created_at: eventRow.created_at,
      kind: "brand",
      message: reqRow.message,
      ...enrichedPayload,
    };
    await client.query(`select pg_notify('render_events', $1)`, [
      `${reqRow.creator_id}:${eventRow.id}:${JSON.stringify(sseEvent)}`,
    ]);

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      placement_request_id: reqRow.id,
      render_event_id: eventRow.id,
      brand_id: reqRow.brand_id,
      brand_display_name: reqRow.brand_display_name,
      bid_usdc: Number(reqRow.bid_usdc),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[approve] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

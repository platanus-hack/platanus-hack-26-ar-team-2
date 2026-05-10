/**
 * POST /api/placements/[id]/deny
 *
 * Rechaza un placement_request. Marca status='denied' atómicamente. No genera
 * render_event ni dispara pago. El trigger pg_notify('placement_requests_status'
 * ...) avisa al Dock para sacarlo de la lista.
 *
 * Idempotente: WHERE status='pending' garantiza que un segundo deny no haga
 * nada (RETURNING vacío → 409). Mismo patrón que approve.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";

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
    const upd = await client.query<{ id: string; status: string }>(
      `update placement_requests
          set status = 'denied', decided_at = now()
        where id = $1 and status = 'pending'
        returning id, status`,
      [id],
    );

    if (upd.rows.length === 0) {
      const existing = await client.query<{ status: string }>(
        `select status from placement_requests where id = $1`,
        [id],
      );
      if (existing.rows.length === 0) {
        return NextResponse.json(
          { ok: false, error: "placement_request not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: `already ${existing.rows[0]!.status}`,
          status: existing.rows[0]!.status,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, placement_request_id: upd.rows[0]!.id });
  } catch (err) {
    console.error("[deny] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

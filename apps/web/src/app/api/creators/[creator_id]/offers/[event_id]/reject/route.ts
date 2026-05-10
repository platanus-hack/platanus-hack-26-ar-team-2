/**
 * POST /api/creators/[creator_id]/offers/[event_id]/reject
 *
 * Streamer rechaza un offer desde el /dock. UPDATE status='rejected' +
 * responded_at=now(). NO emite ningún brand event derivado — el overlay
 * nunca ve el ad. Idempotente: si ya está rejected, devuelve 200 (no-op).
 *
 * También maneja "rejection durante TTL vencido" — si llegó tarde, marca
 * expired (auto-housekeeping). Para el streamer es lo mismo: el ad no salió.
 */

import { NextResponse } from "next/server";
import { transactPool } from "@/lib/pg";
import { requireInternalBearer } from "@/lib/route-security";

export const runtime = "nodejs";

const OFFER_TTL_MS = Number(process.env.MANAGER_OFFER_TTL_S ?? 8) * 1000;

type OfferRow = {
  id: string;
  creator_id: string;
  kind: string;
  status: string;
  created_at: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ creator_id: string; event_id: string }> },
) {
  const authError = requireInternalBearer(req);
  if (authError) return authError;

  const { creator_id, event_id } = await params;

  const client = await transactPool().connect();
  try {
    const offerRes = await client.query<OfferRow>(
      `select id, creator_id, kind, status, created_at
         from render_events
        where id = $1`,
      [event_id],
    );
    const offer = offerRes.rows[0];
    if (!offer) {
      return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
    }
    if (offer.creator_id !== creator_id) {
      return NextResponse.json({ ok: false, error: "creator mismatch" }, { status: 403 });
    }
    if (offer.kind !== "offer") {
      return NextResponse.json(
        { ok: false, error: `event kind=${offer.kind}, not an offer` },
        { status: 400 },
      );
    }

    // Idempotencia — si ya respondió antes (rejected, accepted, expired)
    // devolvemos 200 sin tocar nada. UI puede llamar dos veces sin romperse.
    if (offer.status !== "pending") {
      return NextResponse.json({ ok: true, offer_id: offer.id, status: offer.status });
    }

    // TTL — si expiró marcamos expired en vez de rejected (cosmetic
    // distinction; functionally idéntico para el streamer).
    const ageMs = Date.now() - new Date(offer.created_at).getTime();
    const finalStatus = ageMs > OFFER_TTL_MS ? "expired" : "rejected";

    await client.query(
      `update render_events
          set status = $1, responded_at = now()
        where id = $2 and status = 'pending'`,
      [finalStatus, event_id],
    );

    return NextResponse.json({ ok: true, offer_id: offer.id, status: finalStatus });
  } catch {
    return NextResponse.json({ ok: false, error: "database error" }, { status: 500 });
  } finally {
    client.release();
  }
}

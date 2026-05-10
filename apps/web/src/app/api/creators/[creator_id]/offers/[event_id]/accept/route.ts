/**
 * POST /api/creators/[creator_id]/offers/[event_id]/accept
 *
 * Streamer aprueba un offer pending desde el /dock. El endpoint:
 *   1. Valida que el offer existe, pertenece a este creator, y status='pending'.
 *   2. Verifica que no expiró (TTL desde MANAGER_OFFER_TTL_S, default 8s).
 *   3. UPDATE status='accepted' + responded_at=now() en el offer.
 *   4. INSERT un NUEVO render_event kind='brand' con el mismo payload del
 *      offer — esa row es la que el overlay (/o/<creator_id>) consume vía SSE
 *      para mostrar el ad real.
 *   5. pg_notify del brand event para push instantáneo.
 *
 * Los retornos son explícitos para que el dock pueda dar feedback sin
 * polling: 200 OK con la row del brand event creado, 410 Gone si expiró,
 * 404 si no existe, 409 Conflict si ya tiene otro status (no-op safe).
 */

import { NextResponse } from "next/server";
import { transactPool } from "@/lib/pg";
import type { RenderEventPayload } from "@/lib/types/render";

export const runtime = "nodejs";

const OFFER_TTL_MS = Number(process.env.MANAGER_OFFER_TTL_S ?? 8) * 1000;

type OfferRow = {
  id: string;
  creator_id: string;
  message: string | null;
  kind: string;
  status: string;
  created_at: string;
  bid_usdc_cents: number | null;
  payload: Record<string, unknown> | null;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ creator_id: string; event_id: string }> },
) {
  const { creator_id, event_id } = await params;

  const client = await transactPool().connect();
  try {
    // 1. Lookup offer + validar pertenencia, kind, y estado.
    const offerRes = await client.query<OfferRow>(
      `select id, creator_id, message, kind, status, created_at, bid_usdc_cents, payload
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
    if (offer.status !== "pending") {
      return NextResponse.json(
        { ok: false, error: `offer already ${offer.status}`, status: offer.status },
        { status: 409 },
      );
    }

    // 2. TTL check. Si expiró, marcamos expired ahora (auto-housekeeping) y
    //    devolvemos 410 — el client sabe que reaccionó tarde.
    const ageMs = Date.now() - new Date(offer.created_at).getTime();
    if (ageMs > OFFER_TTL_MS) {
      await client.query(
        `update render_events
            set status = 'expired', responded_at = now()
          where id = $1 and status = 'pending'`,
        [event_id],
      );
      return NextResponse.json(
        {
          ok: false,
          error: "offer expired",
          age_ms: ageMs,
          ttl_ms: OFFER_TTL_MS,
          status: "expired",
        },
        { status: 410 },
      );
    }

    // 3. Mark offer accepted.
    await client.query(
      `update render_events
          set status = 'accepted', responded_at = now()
        where id = $1 and status = 'pending'`,
      [event_id],
    );

    // 4. Emit derived brand event. Reusamos el payload del offer (zone, bid,
    //    duration, brand_label, etc) — el overlay lo lee igual que un render
    //    normal vía SSE. Destructuramos `kind` y `status` del payload original
    //    porque vamos a reescribirlos a 'brand' y 'accepted' respectivamente
    //    (sin destructure, TS nos rompe por "specified more than once").
    const offerPayload = (offer.payload ?? {}) as Record<string, unknown>;
    const {
      kind: _ignoreKind,
      status: _ignoreStatus,
      ...inheritedPayload
    } = offerPayload;
    void _ignoreKind;
    void _ignoreStatus;
    const brandPayload = {
      ...inheritedPayload,
      kind: "brand" as const,
      from_offer_id: offer.id,
    };
    const brandInsert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, status, bid_usdc_cents, payload)
       values ($1, $2, 'brand', 'accepted', $3, $4)
       returning id, created_at`,
      [creator_id, offer.message ?? "", offer.bid_usdc_cents, brandPayload],
    );
    const brandId = brandInsert.rows[0]!.id;
    const brandCreatedAt = brandInsert.rows[0]!.created_at;

    // 5. pg_notify con payload completo — el SSE del overlay agarra esto
    //    al toque. Mismo formato que /api/creators/[id]/render.
    // Spreadeamos brandPayload PRIMERO (que ya incluye kind:'brand') y
    // después overrideamos los campos server-set para que prevalezcan.
    const sseEvent: RenderEventPayload = {
      ...brandPayload,
      id: brandId,
      creator_id,
      created_at: brandCreatedAt,
      kind: "brand",
      message: offer.message ?? undefined,
    };
    await client.query("select pg_notify('render_events', $1)", [
      `${creator_id}:${brandId}:${JSON.stringify(sseEvent)}`,
    ]);

    return NextResponse.json({
      ok: true,
      offer_id: offer.id,
      brand_event_id: brandId,
      brand_created_at: brandCreatedAt,
      latency_ms: ageMs,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  } finally {
    client.release();
  }
}

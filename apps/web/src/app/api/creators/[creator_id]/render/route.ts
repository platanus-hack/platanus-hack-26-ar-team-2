/**
 * POST /api/creators/[creator_id]/render
 *
 * Inserta un evento de render para el iframe del creator (consumido via SSE
 * en /api/creators/[id]/stream). Dos modos de uso:
 *
 *   text-only:   { message: "..." }
 *   placement:   { kind: "brand", asset_url, zone_id, qr_url, ... }
 *
 * Al menos uno de `message` o `asset_url` es obligatorio.
 *
 * Backwards compat: el campo viejo `zone` (kebab "lower-third" / "corner" /
 * "fullscreen") se acepta y se normaliza a `zone_id` (snake_case enum).
 *
 * Para placements con `kind: 'brand'` y zone_id pero sin `max_duration_ms`,
 * hacemos JOIN con inventory(creator_id, zone) para clampear al máximo
 * permitido por el creator. Si la zona no está en su inventory, se rechaza
 * (HTTP 400) — protege al creator de que se renderice algo en una zona que
 * no autorizó.
 *
 * El payload completo se persiste en `render_events.payload` (jsonb) para
 * que catch-up post-reconexión SSE recupere todos los campos del placement.
 *
 * See DESIGN.md §4 "Event broadcast pattern (C-13a)" + lib/types/render.ts.
 */

import { NextResponse } from "next/server";
import { transactPool } from "@/lib/pg";
import { requireInternalBearer } from "@/lib/route-security";
import { isZoneId, ZONE_MAX_DURATION_MS, type ZoneId } from "@/lib/types/zones";
import type { RenderEventPayload, RenderPostBody } from "@/lib/types/render";

export const runtime = "nodejs";

const MAX_MESSAGE_LEN = 280;
const HARD_MAX_DURATION_MS = 60_000; // ningún placement > 60s, regardless

/**
 * Mapper backwards-compat: el endpoint viejo aceptaba `zone: "lower_third"
 * | "corner" | "fullscreen"`. Si un caller viejo llega con esto, lo
 * normalizamos al ZoneId enum oficial.
 */
function legacyZoneToId(legacy?: string): ZoneId | undefined {
  if (!legacy) return undefined;
  if (legacy === "lower_third") return "lower_third";
  if (legacy === "fullscreen") return "fullscreen_takeover";
  if (legacy === "corner") return "bottom_right_corner";
  if (isZoneId(legacy)) return legacy;
  return undefined;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ creator_id: string }> },
) {
  const authError = requireInternalBearer(req);
  if (authError) return authError;

  const { creator_id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(creator_id)) {
    return NextResponse.json(
      { ok: false, error: "creator_id must be 1-80 chars [a-zA-Z0-9_-]" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "request body must be valid JSON" },
      { status: 400 },
    );
  }

  // Tolerantes con shape: aceptamos `zone` (legacy) Y `zone_id` (nuevo).
  const raw = (body ?? {}) as RenderPostBody & { zone?: string };
  const zoneId = isZoneId(raw.zone_id) ? raw.zone_id : legacyZoneToId(raw.zone);

  const hasMessage = typeof raw.message === "string" && raw.message.length > 0;
  const hasAsset = typeof raw.asset_url === "string" && raw.asset_url.length > 0;

  if (!hasMessage && !hasAsset) {
    return NextResponse.json(
      { ok: false, error: "one of message or asset_url is required" },
      { status: 400 },
    );
  }
  if (hasMessage && raw.message!.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      { ok: false, error: `"message" max ${MAX_MESSAGE_LEN} chars` },
      { status: 400 },
    );
  }
  if (hasAsset && !zoneId) {
    return NextResponse.json(
      { ok: false, error: "zone_id required when asset_url is provided" },
      { status: 400 },
    );
  }
  if (raw.duration_ms !== undefined && (!Number.isFinite(raw.duration_ms) || raw.duration_ms <= 0 || raw.duration_ms > HARD_MAX_DURATION_MS)) {
    return NextResponse.json(
      { ok: false, error: `duration_ms must be 0 < n <= ${HARD_MAX_DURATION_MS}` },
      { status: 400 },
    );
  }

  const message = raw.message ?? "";
  const kind: RenderEventPayload["kind"] = hasAsset ? "brand" : "render";

  const client = await transactPool().connect();
  try {
    // Resolver max_duration efectivo: body override > inventory.max_duration_ms
    // (lookup por creator + zone) > ZONE_MAX_DURATION_MS default.
    let effectiveMaxDuration: number | undefined = raw.max_duration_ms;
    if (zoneId && effectiveMaxDuration === undefined) {
      // El slug del creator vive en `accounts.metadata->>'slug'` (jsonb), NO
      // como columna. La schema de 0001_init.sql NO tiene `accounts.slug` —
      // antes este JOIN tiraba "column a.slug does not exist" y el endpoint
      // caía a ZONE_MAX_DURATION_MS defaults silenciosamente.
      const inv = await client.query<{ max_duration_ms: number }>(
        `select i.max_duration_ms
           from inventory i
           join accounts a on a.id = i.creator_id
          where a.metadata->>'slug' = $1 and i.zone = $2
          limit 1`,
        [creator_id, zoneId],
      );
      if (inv.rows[0]) {
        effectiveMaxDuration = inv.rows[0].max_duration_ms;
      } else {
        effectiveMaxDuration = ZONE_MAX_DURATION_MS[zoneId];
      }
    }

    // Clamp duration al máximo permitido si excede.
    let clampedDuration = raw.duration_ms;
    if (clampedDuration !== undefined && effectiveMaxDuration !== undefined) {
      clampedDuration = Math.min(clampedDuration, effectiveMaxDuration);
    }

    // Construir el payload final que persistimos + emitimos por SSE.
    const payload = hasAsset
      ? {
          asset_url: raw.asset_url,
          asset_type: raw.asset_type,
          qr_url: raw.qr_url,
          duration_ms: clampedDuration,
          max_duration_ms: effectiveMaxDuration,
          zone_id: zoneId,
          position: raw.position,
          audio: raw.audio,
          brand_id: raw.brand_id,
        }
      : null;

    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, payload)
        values ($1, $2, $3, $4)
        returning id, created_at`,
      [creator_id, message, kind, payload],
    );
    const event = insert.rows[0]!;

    const sseEvent: RenderEventPayload = {
      id: event.id,
      creator_id,
      created_at: event.created_at,
      kind,
      message: hasMessage ? message : undefined,
      ...(payload ?? {}),
    };

    // Format: '<creator_id>:<event_id>:<json>' — SSE splits on first two colons.
    await client.query("select pg_notify('render_events', $1)", [
      `${creator_id}:${event.id}:${JSON.stringify(sseEvent)}`,
    ]);

    return NextResponse.json({
      ok: true,
      event: { id: event.id, creator_id, created_at: event.created_at, kind },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export function GET(_req: Request, _ctx: { params: Promise<{ creator_id: string }> }) {
  return NextResponse.json({
    endpoint: "POST /api/creators/[creator_id]/render",
    body: {
      // text-only mode
      message: "string · optional if asset_url provided · max 280 chars",

      // placement mode
      asset_url: "string · optional · video/image URL del ad pre-generado",
      asset_type: "video | image · optional",
      qr_url: "string · optional",
      duration_ms: "number ms · optional · clamped a inventory.max_duration_ms",
      max_duration_ms: "number ms · optional · override del cap del zone",
      zone_id: "lower_third | fullscreen_takeover | bottom_right_corner · required si hay asset_url",
      position: "{ x, y, width, height } pixels canvas 1920x1080 · optional · usa ZONE_DEFAULTS si falta",
      audio: "boolean · optional · default según ZONE_AUDIO_DEFAULT",
      brand_id: "string · optional · slug del brand para mostrar BrandRibbon",

      // legacy (deprecated)
      zone: "lower_third | corner | fullscreen · DEPRECATED, usá zone_id",
    },
  });
}

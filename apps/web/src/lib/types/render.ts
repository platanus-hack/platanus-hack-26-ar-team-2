/**
 * Shape unificado de los render_events emitidos al iframe del creator via SSE.
 *
 * Source of truth para:
 *  - POST /api/creators/[creator_id]/render (body validation)
 *  - GET /api/creators/[creator_id]/stream (push + catch-up)
 *  - components/overlay/PlacementOverlay (consumidor)
 *  - components/overlay-creator/OverlayClient (mid-layer SSE)
 *  - C-14 /api/auctions/run (publisher, cuando exista)
 *
 * Antes había 4 versiones distintas de este tipo entre los archivos. Bug-bait.
 */

import type { ZoneId, ZonePosition } from "./zones";

/**
 * Payload completo que el endpoint POST /render acepta y que el SSE manda
 * al iframe. Todos los fields salvo creator_id+id+created_at+kind son
 * opcionales — un text-only `message` también es un render event válido.
 */
export interface RenderEventPayload {
  // ─── server-set ───────────────────────────────────────────────────
  id: string;
  creator_id: string;
  created_at: string;

  /**
   * Tipo de evento:
   *   'render' = mensaje text-only desde POST /render (default)
   *   'raw'    = dump del context_chunk completo (firehose del manager-tick cron, every 5s)
   *   'brand'  = placement ganado de una subasta (lo que rendereamos en pantalla)
   */
  kind?: "render" | "raw" | "brand";

  // ─── opcional · text-only mode ────────────────────────────────────
  message?: string;

  // ─── opcional · placement mode (asset visual) ─────────────────────
  asset_url?: string;
  asset_type?: "video" | "image";
  qr_url?: string;
  duration_ms?: number;
  /** Cap del zone (override del default ZONE_MAX_DURATION_MS). */
  max_duration_ms?: number;
  /** Zone enum (snake_case). Resuelve cómo se renderiza el ad. */
  zone_id?: ZoneId;
  /**
   * Posición pixel-canvas del placement. Si no viene se usa
   * ZONE_DEFAULTS[zone_id] o el JOIN con inventory_zones del endpoint.
   */
  position?: ZonePosition;
  /** Default según ZONE_AUDIO_DEFAULT[zone_id]. */
  audio?: boolean;
  brand_id?: string;
}

/**
 * Body que el endpoint POST acepta. Server llena id+creator_id+created_at,
 * el publisher (apps/web /api/auctions/run o el manager-worker cron) manda
 * el resto.
 */
export type RenderPostBody = Omit<RenderEventPayload, "id" | "creator_id" | "created_at">;

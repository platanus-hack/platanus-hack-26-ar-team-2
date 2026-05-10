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
   *   'render'        = mensaje text-only desde POST /render (default)
   *   'raw'           = dump del context_chunk completo (firehose del manager-tick cron)
   *   'brand_thought' = decisión per-brand del multi-agent picker (C-08m-multiagent).
   *                     Una row por brand sobreviviente al gate1; agrupadas por
   *                     `payload.deliberation_id`. Visibles en /demo-display como
   *                     deliberación cascada antes del offer ganador.
   *   'offer'         = candidato del agent esperando approve/reject del streamer
   *                     (consumido por /dock, NO por el overlay — el overlay lo filtra)
   *   'brand'         = placement aprobado, sale en pantalla via overlay SSE
   */
  kind?: "render" | "raw" | "brand_thought" | "brand" | "offer";

  /**
   * UUID que agrupa todos los render_events de un mismo tick del manager
   * (raw + N brand_thoughts + offer). La vista SQL `agent_deliberations`
   * lo usa como key. Llenado por C-08m-multiagent.
   */
  deliberation_id?: string;

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
  /** Vertical position of the ad: top, center, or bottom. */
  ad_position?: "top" | "center" | "bottom";

  // ─── opcional · payment metadata (kind='brand' post-accept) ───────
  /**
   * Resultado de la transferencia USDC directa brand → creator firmada cuando
   * el streamer aprobó el offer.
   *   - mode='live' → tx broadcasteada en Base mainnet (CHAIN_LIVE_TXS=true).
   *   - mode='mock' → CHAIN_LIVE_TXS=false; tx_hash sintético para que el
   *                   demo / dock muestre el flow del pago sin gastar USDC.
   */
  payment?: {
    tx_hash: string;
    mode: "live" | "mock";
    payer_address: string;
    payer_brand_id: string;
    payee_address: string;
    amount_usdc_cents: number;
    amount_usdc: number;
    signed_at: string;
  };
}

/**
 * Body que el endpoint POST acepta. Server llena id+creator_id+created_at,
 * el publisher (apps/web /api/auctions/run o el manager Vercel Cron) manda
 * el resto.
 */
export type RenderPostBody = Omit<RenderEventPayload, "id" | "creator_id" | "created_at">;

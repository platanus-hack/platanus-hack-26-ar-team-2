/**
 * Zonas de inventory donde un placement puede renderizarse sobre el stream del
 * creator. Source of truth single — antes había 3 versiones distintas (kebab
 * en PlacementOverlay, snake en YAMLs/DB, mixed en RenderEvent) y un
 * `mapZone()` lossy que silently caía a "corner" para todo lo desconocido.
 *
 * Convención: snake_case porque eso es lo que la DB y los YAMLs ya usan
 * (`allowed_zones: ["lower_third", "bottom_right_corner"]`).
 */

export const ZONE_IDS = ["lower_third", "fullscreen_takeover", "bottom_right_corner"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export function isZoneId(v: unknown): v is ZoneId {
  return typeof v === "string" && (ZONE_IDS as readonly string[]).includes(v);
}

/**
 * Posición + tamaño de una zona en pixels relativos al canvas del stream
 * (referencia: 1920×1080). El PlacementOverlay normaliza a porcentajes para
 * que sea responsive a cualquier resolución de Browser Source en OBS.
 */
export interface ZonePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Canvas de referencia. Cambialo si el creator stremea en otra resolución. */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/**
 * Defaults razonables si el placement no trae `position` desde
 * `inventory_zones`. El creator puede override en /settings/inventory.
 */
export const ZONE_DEFAULTS: Record<ZoneId, ZonePosition> = {
  lower_third: { x: 0, y: 850, width: 1920, height: 230 },
  fullscreen_takeover: { x: 0, y: 0, width: 1920, height: 1080 },
  bottom_right_corner: { x: 1620, y: 850, width: 280, height: 200 },
};

/**
 * Convierte coordenadas pixel-canvas → CSS porcentajes para que el overlay
 * sea responsive si el Browser Source de OBS no es exactamente 1920×1080.
 */
export function zoneToCss(pos: ZonePosition): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${(pos.x / CANVAS_WIDTH) * 100}%`,
    top: `${(pos.y / CANVAS_HEIGHT) * 100}%`,
    width: `${(pos.width / CANVAS_WIDTH) * 100}%`,
    height: `${(pos.height / CANVAS_HEIGHT) * 100}%`,
  };
}

/**
 * Caps por zona — protege al creator de placements que pidan duraciones
 * desproporcionadas (ej. corner ad de 5 minutos). El inventory_zones del DB
 * puede sobrescribir estos defaults con `max_duration_s` per-creator.
 */
export const ZONE_MAX_DURATION_MS: Record<ZoneId, number> = {
  lower_third: 12_000,           // 12s — branded interlude
  fullscreen_takeover: 30_000,   // 30s — premium spot
  bottom_right_corner: 60_000,   // 60s — persistent logo
};

/**
 * Default de audio por zona. Corner y lower-third silenciados (no querés
 * pisar al creator). Fullscreen con audio porque es un takeover real con voz.
 */
export const ZONE_AUDIO_DEFAULT: Record<ZoneId, boolean> = {
  lower_third: false,
  fullscreen_takeover: true,
  bottom_right_corner: false,
};

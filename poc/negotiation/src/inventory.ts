import type { Inventory, StreamerMandate } from "./types.js";

// SINGLE AD PER MOMENT.
// Solo UN placement corre en pantalla en cualquier instante. Las "zonas"
// definen el FORMATO del ad (dónde y cuán grande), no slots simultáneos.
// El streamer-agent elige UN único ganador por subasta a través de TODAS
// las zonas competidoras.
//
// `enabled` = la zona puede usarse en MVP. `manual_only` = solo se activa
// vía hotkey FULL BREAK (ver DESIGN.md §11 / Demo Acto 4).
export const INVENTORY: Inventory = {
  lower_third: { enabled: true, min_bid_usdc: 0.5, max_duration_s: 8 },
  bottom_right_corner: { enabled: true, min_bid_usdc: 0.2, max_duration_s: 60 },
  fullscreen_takeover: { enabled: false, min_bid_usdc: 5.0, max_duration_s: 30, manual_only: true },
};

export const STREAMER_MANDATE: StreamerMandate = {
  display_name: "Coscu",
  blocked_keywords: ["puto", "maricón", "trolo"],
  preferred_brands: ["adidas", "nike", "quilmes", "mp"],
  hard_floor_usdc: 0.2,
  color: "#A855F7",
};

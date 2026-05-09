// Client-safe brand registry for overlay/UI components that cannot use fs.
// The agent (pickBrand/tick) reads from YAML files directly via the loader.
// This file provides color/name/targeting lookups for client components.

export type Brand = {
  id: string;
  display_name: string;
  brand_color: string;
  default_persona: string;
  allowed_zones: string[];
  preferred_zones: string[];
  target_moods: string[];
};

// Client registry — keep in sync with apps/web/src/lib/agents/brands/*.yaml
export const BRANDS: readonly Brand[] = [
  {
    id: "cafetito",
    display_name: "☕ CafetITO",
    brand_color: "#6f4e37",
    default_persona: "Café premium argentino — energía para momentos épicos.",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "clutch"],
  },
  {
    id: "termoflex",
    display_name: "🧊 TermoFlex",
    brand_color: "#3b7a98",
    default_persona: "Tu termo inteligente para el mate perfecto.",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["calm", "chat_active", "social"],
  },
  {
    id: "pancho-rex",
    display_name: "🌭 Pancho Rex",
    brand_color: "#d2691e",
    default_persona: "Los mejores panchos del stream. Hambre = Pancho Rex.",
    allowed_zones: ["lower_third", "bottom_right_corner", "fullscreen_takeover"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "social", "celebration"],
  },
  {
    id: "platanus",
    display_name: "🍌 Platanus",
    brand_color: "#f5c400",
    default_persona: "Platanus Hack — builder culture, 24hs de código.",
    allowed_zones: ["lower_third", "bottom_right_corner", "fullscreen_takeover"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "community", "social"],
  },
  {
    id: "matebros",
    display_name: "🧉 MateBros",
    brand_color: "#5d8a3a",
    default_persona: "Yerba premium para la ronda infinita.",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["calm", "social", "chat_active"],
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);

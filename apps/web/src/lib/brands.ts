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
  ad_asset_url?: string;
};

// Client registry — keep in sync with worker/brands/*.yaml
export const BRANDS: readonly Brand[] = [
  {
    id: "platanus",
    display_name: "🍌 Platanus",
    brand_color: "#f5c400",
    default_persona: "Platanus Hack — builder culture, 24hs de código.",
    allowed_zones: ["lower_third", "bottom_right_corner", "fullscreen_takeover"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "community", "social"],
    ad_asset_url: "https://tcbljbmedl5ntsz1.public.blob.vercel-storage.com/banana.mp4",
  },
  {
    id: "doritos",
    display_name: "🔺 Doritos",
    brand_color: "#e3000b",
    default_persona: "For the Bold — snack de los momentos intensos.",
    allowed_zones: ["lower_third", "bottom_right_corner", "fullscreen_takeover"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "hype", "celebration", "party", "gaming", "social"],
    ad_asset_url: "https://tcbljbmedl5ntsz1.public.blob.vercel-storage.com/doritos.mp4",
  },
  {
    id: "monster",
    display_name: "🟢 Monster Energy",
    brand_color: "#95d600",
    default_persona: "Unleash the Beast — energía para momentos épicos.",
    allowed_zones: ["lower_third", "fullscreen_takeover", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "celebration", "hype", "epic", "party"],
    ad_asset_url: "https://tcbljbmedl5ntsz1.public.blob.vercel-storage.com/monster.mp4",
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);

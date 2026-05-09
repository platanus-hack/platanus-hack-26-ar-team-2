export type Brand = {
  id: string;
  display_name: string;
  brand_color: string;
  logo_url: string;
  default_persona: string;
  daily_cap_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  always_bid_floor: boolean;
  tracking_url: string;
  allowed_zones: string[];
  preferred_zones: string[];
  target_moods: string[];
  safety_keywords: string[];
};

export const BRANDS: readonly Brand[] = [
  {
    id: "zapzap",
    display_name: "ZapZap Accesorios",
    brand_color: "#6366f1",
    logo_url: "",
    default_persona: "Gadgets y periféricos para gamers. Directo y técnico.",
    daily_cap_usdc: 40,
    min_bid_usdc: 0.40,
    max_bid_usdc: 4.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "victory", "new_game"],
    safety_keywords: ["violencia", "drogas", "insulto_grave"],
  },
  {
    id: "buenaonda",
    display_name: "BuenaOnda Café",
    brand_color: "#f59e0b",
    logo_url: "",
    default_persona: "Café de especialidad. Momentos de pausa y concentración.",
    daily_cap_usdc: 25,
    min_bid_usdc: 0.20,
    max_bid_usdc: 2.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["calm", "idle", "chat_active", "casual"],
    safety_keywords: ["violencia", "drogas", "menores"],
  },
  {
    id: "pizzarocket",
    display_name: "PizzaRocket",
    brand_color: "#ef4444",
    logo_url: "",
    default_persona: "Pizza delivery rápida. Momentos de hambre y pausa larga.",
    daily_cap_usdc: 30,
    min_bid_usdc: 0.25,
    max_bid_usdc: 2.50,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["idle", "calm", "chat_active", "celebration"],
    safety_keywords: ["violencia", "drogas"],
  },
  {
    id: "fitmax",
    display_name: "FitMax Argentina",
    brand_color: "#22c55e",
    logo_url: "",
    default_persona: "Suplementos y gym. Momentos de esfuerzo y superación.",
    daily_cap_usdc: 35,
    min_bid_usdc: 0.30,
    max_bid_usdc: 3.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "comeback", "victory", "clutch"],
    safety_keywords: ["violencia", "drogas", "menores"],
  },
  {
    id: "pixelbros",
    display_name: "PixelBros Studio",
    brand_color: "#a855f7",
    logo_url: "",
    default_persona: "Indie game studio. Contextos de gaming y creatividad.",
    daily_cap_usdc: 20,
    min_bid_usdc: 0.20,
    max_bid_usdc: 2.00,
    always_bid_floor: true,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["any"],
    safety_keywords: ["violencia_real", "drogas"],
  },
  {
    id: "turbosnacks",
    display_name: "TurboSnacks",
    brand_color: "#f97316",
    logo_url: "",
    default_persona: "Snacks energéticos para gamers. Urgente y directo.",
    daily_cap_usdc: 28,
    min_bid_usdc: 0.20,
    max_bid_usdc: 2.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["idle", "chat_active", "casual", "calm"],
    safety_keywords: ["violencia", "drogas"],
  },
  {
    id: "codingpal",
    display_name: "CodingPal",
    brand_color: "#06b6d4",
    logo_url: "",
    default_persona: "Plataforma de cursos de programación. Aspiracional y técnico.",
    daily_cap_usdc: 22,
    min_bid_usdc: 0.25,
    max_bid_usdc: 2.50,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["calm", "technical", "idle", "chat_active"],
    safety_keywords: ["violencia", "drogas", "discriminacion"],
  },
  {
    id: "gamergear",
    display_name: "GamerGear AR",
    brand_color: "#eab308",
    logo_url: "",
    default_persona: "Sillas, auriculares y setups gaming. El momento épico merece el mejor equipo.",
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["fullscreen_takeover"],
    target_moods: ["high_energy", "victory", "clutch", "comeback", "celebration"],
    safety_keywords: ["violencia", "drogas", "insulto_grave"],
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);

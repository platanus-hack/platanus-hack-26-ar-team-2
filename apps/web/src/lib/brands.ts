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
    id: "adidas",
    display_name: "Adidas Argentina",
    brand_color: "#e8e8e8",
    logo_url: "",
    default_persona: "Directo, deportivo y apasionado. Solo momentos épicos.",
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "https://adidas.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "victory", "clutch", "comeback", "goal"],
    safety_keywords: ["muerte", "violencia", "drogas", "insulto_grave"],
  },
  {
    id: "nike",
    display_name: "Nike Argentina",
    brand_color: "#ff6600",
    logo_url: "",
    default_persona: "Inspiracional y directo. Momentos de superación personal.",
    daily_cap_usdc: 55,
    min_bid_usdc: 0.50,
    max_bid_usdc: 6.00,
    always_bid_floor: false,
    tracking_url: "https://nike.com.ar/addie",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["fullscreen_takeover"],
    target_moods: ["high_energy", "comeback", "victory", "clutch"],
    safety_keywords: ["muerte", "violencia", "drogas"],
  },
  {
    id: "quilmes",
    display_name: "Quilmes",
    brand_color: "#f5c400",
    logo_url: "",
    default_persona: "Relajado y social. Momentos de compartir y celebrar.",
    daily_cap_usdc: 40,
    min_bid_usdc: 0.30,
    max_bid_usdc: 3.50,
    always_bid_floor: false,
    tracking_url: "https://quilmes.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["celebration", "casual", "chat_active", "social"],
    safety_keywords: ["muerte", "violencia", "drogas", "menores"],
  },
  {
    id: "mp",
    display_name: "Mercado Pago",
    brand_color: "#009ee3",
    logo_url: "",
    default_persona: "Default bidder. Garantiza fill al floor. No negocia.",
    daily_cap_usdc: 100,
    min_bid_usdc: 0.20,
    max_bid_usdc: 2.00,
    always_bid_floor: true,
    tracking_url: "https://mercadopago.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["any"],
    safety_keywords: ["estafa", "fraude", "hack", "robo", "muerte", "violencia", "drogas"],
  },
  {
    id: "steam",
    display_name: "Steam",
    brand_color: "#66c0f4",
    logo_url: "",
    default_persona: "Gamer-nativo y técnico. Contextos de gaming intenso.",
    daily_cap_usdc: 45,
    min_bid_usdc: 0.40,
    max_bid_usdc: 4.00,
    always_bid_floor: false,
    tracking_url: "https://store.steampowered.com/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "new_game", "rage", "victory"],
    safety_keywords: ["muerte", "violencia_real", "drogas"],
  },
  {
    id: "rappi",
    display_name: "Rappi Argentina",
    brand_color: "#ff441f",
    logo_url: "",
    default_persona: "Urgente y conveniente. Momentos de pausa y snack.",
    daily_cap_usdc: 35,
    min_bid_usdc: 0.25,
    max_bid_usdc: 2.50,
    always_bid_floor: false,
    tracking_url: "https://rappi.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["idle", "calm", "chat_active", "casual"],
    safety_keywords: ["muerte", "violencia", "drogas"],
  },
  {
    id: "globant",
    display_name: "Globant",
    brand_color: "#b8d430",
    logo_url: "",
    default_persona: "Tech-forward y aspiracional. Audiencias gamer-profesionales.",
    daily_cap_usdc: 30,
    min_bid_usdc: 0.30,
    max_bid_usdc: 3.00,
    always_bid_floor: false,
    tracking_url: "https://globant.com/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "victory", "technical"],
    safety_keywords: ["muerte", "violencia", "drogas", "discriminacion"],
  },
  {
    id: "cocacola",
    display_name: "Coca-Cola Argentina",
    brand_color: "#f40009",
    logo_url: "",
    default_persona: "Clásico y celebratorio. Los momentos más épicos del stream.",
    daily_cap_usdc: 80,
    min_bid_usdc: 1.00,
    max_bid_usdc: 8.00,
    always_bid_floor: false,
    tracking_url: "https://coca-cola.com.ar/addie",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["fullscreen_takeover"],
    target_moods: ["celebration", "victory", "high_energy", "goal"],
    safety_keywords: ["muerte", "violencia", "drogas", "menores", "insulto_grave"],
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);

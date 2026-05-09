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
  /** Hint keywords the Claude agent uses to detect brand relevance in audio. */
  match_keywords: string[];
};

export const BRANDS: readonly Brand[] = [
  {
    id: "yerba_mate",
    display_name: "Yerba Mate",
    brand_color: "#22c55e",
    logo_url: "",
    default_persona: "Yerba mate argentina. Tradición, energía y compañerismo.",
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["any"],
    safety_keywords: [],
    match_keywords: [
      "mate", "yerba", "matear", "cebar", "bombilla", "termo",
      "tereré", "terere", "amargo", "cebado", "mateada",
    ],
  },
  {
    id: "adidas",
    display_name: "Ropa Adidas",
    brand_color: "#000000",
    logo_url: "",
    default_persona: "Adidas. Ropa deportiva, zapatillas y estilo urbano.",
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["any"],
    safety_keywords: [],
    match_keywords: [
      "adidas", "zapatillas", "zapatilla", "ropa", "remera",
      "camiseta", "deportivo", "deportiva", "running", "sneakers",
      "jogging", "buzo", "campera", "calzado", "botines",
    ],
  },
  {
    id: "fernet_branca",
    display_name: "Fernet Branca",
    brand_color: "#8B4513",
    logo_url: "",
    default_persona: "Fernet Branca. El sabor de la juntada argentina.",
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["any"],
    safety_keywords: [],
    match_keywords: [
      "fernet", "branca", "fernecito", "ferné", "trago",
      "previa", "juntada", "coca", "fernets",
    ],
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);


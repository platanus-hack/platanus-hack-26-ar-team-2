// 4 brands ficticias del demo (post-pivote a meta-streaming, ver docs/PITCH.md).
// Espejo plano de los YAMLs en src/lib/agents/brands/*.yaml — intencional para
// los consumers (UI client components, manager pickBrand, overlay color lookup)
// que no pueden cargar YAMLs en runtime. Cuando edites un YAML, espejá acá.

export type Brand = {
  id: string;
  display_name: string;
  brand_color: string;
  logo_url: string;
  default_persona: string;
  /** Heurística del stub picker (MANAGER_DRY_RUN=true) + signal opcional para Haiku. */
  match_keywords: string[];
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
    id: "cafetito",
    display_name: "☕ CafetITO",
    brand_color: "#6f4e37",
    logo_url: "",
    default_persona: "Café premium argentino. Voz épica, segunda persona, deportiva. Entra en clutchs, comebacks, breakthroughs técnicos vivos en cámara.",
    match_keywords: ["café", "cafe", "cafetito", "cargado", "espresso"],
    daily_cap_usdc: 50,
    min_bid_usdc: 0.50,
    max_bid_usdc: 5.00,
    always_bid_floor: false,
    tracking_url: "https://cafetito.demo/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "victory", "clutch", "comeback"],
    safety_keywords: ["muerte", "violencia", "droga", "suicidio"],
  },
  {
    id: "termoflex",
    display_name: "🧊 TermoFlex",
    brand_color: "#3b7a98",
    logo_url: "",
    default_persona: "Termo cotidiano. Default bidder al floor — siempre presente, no pisa, no sube. Voz calma, casual argentina, como un mate compartido.",
    match_keywords: ["termo", "termito", "agua caliente"],
    daily_cap_usdc: 100,
    min_bid_usdc: 0.20,
    max_bid_usdc: 2.00,
    always_bid_floor: true,
    tracking_url: "https://termoflex.demo/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["any"],
    safety_keywords: ["estafa", "fraude", "droga", "muerte", "violencia"],
  },
  {
    id: "pancho-rex",
    display_name: "🌭 Pancho Rex",
    brand_color: "#d2691e",
    logo_url: "",
    default_persona: "Pancho late-night. Voz humorística, charlatán argentino, hambriento. Solo entra en momentos relajados, almuerzo o late-night — NO en clutchs ni alta energía.",
    match_keywords: ["pancho", "choripán", "hambre", "comer", "almuerzo", "cena"],
    daily_cap_usdc: 35,
    min_bid_usdc: 0.25,
    max_bid_usdc: 2.50,
    always_bid_floor: false,
    tracking_url: "https://panchorex.demo/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["calm", "chat_active", "idle", "social", "late_night", "hambre"],
    safety_keywords: ["droga", "violencia"],
  },
  {
    id: "matebros",
    display_name: "🧉 MateBros",
    brand_color: "#5d8a3a",
    logo_url: "",
    default_persona: "Yerba comunitaria. Voz cálida, fogón, primera persona del plural. Entra en festejos grupales, charlas relajadas. NO en clutchs individuales ni audiencias masivas — es ronda, no estadio.",
    match_keywords: ["mate", "yerba", "ronda", "fogón", "fogon", "equipo"],
    daily_cap_usdc: 40,
    min_bid_usdc: 0.30,
    max_bid_usdc: 3.50,
    always_bid_floor: false,
    tracking_url: "https://matebros.demo/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["casual_chat", "social", "chat_active", "celebration", "community", "fogón"],
    safety_keywords: ["menor", "droga", "violencia"],
  },
];

export const getBrand = (id: string): Brand | undefined =>
  BRANDS.find((b) => b.id === id);

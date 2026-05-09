import type { BrandMandate } from "./types.js";

export const BRANDS: BrandMandate[] = [
  {
    id: "adidas",
    display_name: "adidas",
    brand_voice: "épico, deportivo, performance, segunda persona, energía alta",
    daily_cap_usdc: 50,
    spent_today_usdc: 12.4,
    min_bid_usdc: 0.5,
    max_bid_usdc: 5.0,
    targeting: {
      games: ["FIFA", "eFootball", "Just Chatting"],
      moods: ["high_energy", "celebration", "win_moment"],
    },
    color: "#000000",
    ads: [
      { id: "epic_goal_lower", variant_name: "Epic Goal Lower", format: "lower_third", duration_s: 6, mood_tags: ["high_energy", "celebration"] },
      { id: "premium_takeover_adi", variant_name: "Predator Takeover", format: "fullscreen_takeover", duration_s: 30, mood_tags: ["storytelling"] },
      { id: "persistent_logo_adi", variant_name: "Stripes Corner", format: "bottom_right_corner", duration_s: 60, mood_tags: ["any"] },
    ],
  },
  {
    id: "nike",
    display_name: "Nike",
    brand_voice: "directo, confiado, just-do-it, frase corta",
    daily_cap_usdc: 60,
    spent_today_usdc: 9.0,
    min_bid_usdc: 0.6,
    max_bid_usdc: 6.0,
    targeting: {
      games: ["FIFA", "NBA 2K", "Just Chatting"],
      moods: ["win_moment", "celebration", "training"],
    },
    color: "#FA5400",
    ads: [
      { id: "win_moment_lower", variant_name: "Win Moment Lower", format: "lower_third", duration_s: 5, mood_tags: ["high_energy", "win_moment"] },
      { id: "premium_takeover_nike", variant_name: "Air Takeover", format: "fullscreen_takeover", duration_s: 30, mood_tags: ["storytelling"] },
      { id: "swoosh_corner", variant_name: "Swoosh Corner", format: "bottom_right_corner", duration_s: 60, mood_tags: ["any"] },
    ],
  },
  {
    id: "quilmes",
    display_name: "Quilmes",
    brand_voice: "social, argentino, festivo, calle, gol futbolero",
    daily_cap_usdc: 40,
    spent_today_usdc: 5.2,
    min_bid_usdc: 0.3,
    max_bid_usdc: 3.0,
    targeting: {
      games: ["FIFA", "Just Chatting"],
      moods: ["celebration", "social", "calm"],
    },
    color: "#FFD400",
    ads: [
      { id: "social_celebration_q", variant_name: "Encuentro Quilmes", format: "bottom_right_corner", duration_s: 30, mood_tags: ["celebration", "social"] },
      { id: "calm_chat_lower_q", variant_name: "Charla Quilmes", format: "lower_third", duration_s: 5, mood_tags: ["calm", "social"] },
    ],
  },
  {
    id: "mp",
    display_name: "Mercado Pago",
    brand_voice: "fintech, simple, rendidor, prácticp",
    daily_cap_usdc: 35,
    spent_today_usdc: 18.5,
    min_bid_usdc: 0.2,
    max_bid_usdc: 2.0,
    targeting: {
      games: ["any"],
      moods: ["any"],
    },
    color: "#00B1EA",
    ads: [
      { id: "persistent_logo_mp", variant_name: "Logo MP", format: "bottom_right_corner", duration_s: 60, mood_tags: ["any"] },
      { id: "calm_chat_lower_mp", variant_name: "Tip MP", format: "lower_third", duration_s: 5, mood_tags: ["calm"] },
    ],
  },
  {
    id: "rappi",
    display_name: "Rappi",
    brand_voice: "delivery, hambre, rápido, food porn",
    daily_cap_usdc: 30,
    spent_today_usdc: 22.0,
    min_bid_usdc: 0.4,
    max_bid_usdc: 3.5,
    targeting: {
      games: ["Just Chatting", "Cooking"],
      moods: ["calm", "hungry", "social"],
    },
    color: "#FF441F",
    ads: [
      { id: "hungry_lower_rap", variant_name: "Hambre Rappi", format: "lower_third", duration_s: 6, mood_tags: ["hungry", "calm"] },
      { id: "logo_rap", variant_name: "Logo Rappi", format: "bottom_right_corner", duration_s: 60, mood_tags: ["any"] },
    ],
  },
  {
    id: "steam",
    display_name: "Steam",
    brand_voice: "gamer, irónico, oferta, callout a wishlist",
    daily_cap_usdc: 45,
    spent_today_usdc: 7.0,
    min_bid_usdc: 0.5,
    max_bid_usdc: 4.0,
    targeting: {
      games: ["any"],
      moods: ["any"],
    },
    color: "#1B2838",
    ads: [
      { id: "sale_lower_steam", variant_name: "Sale Steam", format: "lower_third", duration_s: 6, mood_tags: ["any"] },
      { id: "wishlist_corner_steam", variant_name: "Wishlist Steam", format: "bottom_right_corner", duration_s: 45, mood_tags: ["any"] },
    ],
  },
  {
    id: "globant",
    display_name: "Globant",
    brand_voice: "B2B, AI-forward, premium tech, formal pero cool",
    daily_cap_usdc: 25,
    spent_today_usdc: 0,
    min_bid_usdc: 0.5,
    max_bid_usdc: 2.5,
    targeting: {
      games: ["Just Chatting"],
      moods: ["calm", "intellectual"],
    },
    color: "#62D84E",
    ads: [
      { id: "ai_corner_glob", variant_name: "AI Globant", format: "bottom_right_corner", duration_s: 60, mood_tags: ["calm", "intellectual"] },
    ],
  },
  {
    id: "cocacola",
    display_name: "Coca-Cola",
    brand_voice: "feliz, masivo, momento, Argentina",
    daily_cap_usdc: 80,
    spent_today_usdc: 4.0,
    min_bid_usdc: 0.5,
    max_bid_usdc: 8.0,
    targeting: {
      games: ["any"],
      moods: ["celebration", "social", "calm"],
    },
    color: "#F40009",
    ads: [
      { id: "premium_takeover_coke", variant_name: "Momento Coca", format: "fullscreen_takeover", duration_s: 30, mood_tags: ["storytelling", "celebration"] },
      { id: "calm_lower_coke", variant_name: "Pausa Coca", format: "lower_third", duration_s: 5, mood_tags: ["calm", "social"] },
      { id: "logo_coke", variant_name: "Logo Coca", format: "bottom_right_corner", duration_s: 60, mood_tags: ["any"] },
    ],
  },
];

export function brandById(id: string): BrandMandate {
  const b = BRANDS.find((b) => b.id === id);
  if (!b) throw new Error(`Unknown brand: ${id}`);
  return b;
}

export type ZoneId = "lower_third" | "bottom_right_corner" | "fullscreen_takeover";

export type Ad = {
  id: string;
  variant_name: string;
  format: ZoneId;
  duration_s: number;
  mood_tags: string[];
};

export type BrandMandate = {
  id: string;
  display_name: string;
  brand_voice: string;
  daily_cap_usdc: number;
  spent_today_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  targeting: { games: string[]; moods: string[] };
  ads: Ad[];
  /** ANSI color hex used in terminal output, e.g. "#000000" */
  color: string;
};

export type StreamerMandate = {
  display_name: string;
  blocked_keywords: string[];
  preferred_brands: string[];
  /** Below this absolute USDC, never accept regardless of zone. */
  hard_floor_usdc: number;
  color: string;
};

export type StreamContext = {
  audio_30s: string;
  frame_description: string;
  chat_velocity_msgs: number;
  chat_baseline_msgs: number;
  sentiment: number;
  viewers: number;
  game: string;
  /** Optional override mood label that the streamer wants to communicate. */
  mood?: string;
};

export type ZoneRule = {
  /** Whether this zone format can be auctioned in MVP. */
  enabled: boolean;
  min_bid_usdc: number;
  max_duration_s: number;
  /** Only triggered manually (e.g. FULL BREAK hotkey), never auto-bid. */
  manual_only?: boolean;
};

export type Inventory = Record<ZoneId, ZoneRule>;

export type DealTerms = {
  bid_usdc: number;
  duration_s: number;
  zone: ZoneId;
  /**
   * Multi-issue: seconds of competitor lockout post-placement.
   * 0 = no exclusivity (default). Up to 60s. Brand pays premium for it.
   */
  exclusivity_s?: number;
};

export type ValuationBreakdown = {
  /** Brand's self-assessed fit multiplier vs the moment, 0.4-2.0 */
  brand_fit_multiplier: number;
  /** Bullet rationale: which fit factors hit (game/mood/audience/voice). */
  fit_reasons: string[];
  /** Brand's perceived value of THIS slot: market fair_value × brand_fit. */
  perceived_value_usdc: number;
  /** Walk-away ceiling: never pay more than this for this slot. */
  max_acceptable_usdc: number;
  /** Opening factor 0.55-0.75 — how aggressive the open is vs max_acceptable. */
  opening_factor: number;
  /** Opening bid = max_acceptable × opening_factor (clamped to min/max bid). */
  opening_bid_usdc: number;
  /** What competitive landscape the brand assumes (drives opening_factor). */
  competitive_assumption: string;
};

export type OpeningOffer = {
  brand_id: string;
  ad_id: string;
  message: string;
  terms: DealTerms;
  valuation: ValuationBreakdown;
};

export type HuntDecision =
  | { should_bid: true; offer: OpeningOffer; reason: string }
  | { should_bid: false; reason: string; brand_fit_multiplier?: number };

export type TurnAction = "open" | "counter" | "accept" | "reject" | "walk";

export type Turn = {
  from: "brand" | "streamer";
  brand_id: string;
  action: TurnAction;
  message: string;
  terms?: DealTerms;
  ts_ms: number;
  /** Concession-curve target the speaker was supposed to follow this round (for audit). */
  curve_target_usdc?: number;
  /** If a code-side gate forced this action (e.g., AC_combi override of LLM). */
  override?: { from_action: TurnAction; rule: string; reason: string };
};

export type StreamerReplyForBrand = {
  action: "counter" | "accept" | "reject";
  counter_terms?: DealTerms;
  message: string;
};

export type BrandResponse = {
  action: "counter" | "accept" | "walk";
  counter_terms?: DealTerms;
  message: string;
};

export type ClosedDeal = {
  brand_id: string;
  accepted: boolean;
  terms?: DealTerms;
  history: Turn[];
  closing_action: TurnAction;
};

/**
 * Single-ad-per-moment: at most ONE winner per round across all zones.
 * `winner` is null if no closed deal was worth running.
 */
export type FinalDecision = {
  winner: { brand_id: string; terms: DealTerms; reason: string } | null;
  rejected: { brand_id: string; reason: string }[];
  total_revenue_usdc: number;
};

/** End-of-round metrics surfaced in the demo log. */
export type RoundMetrics = {
  brands_evaluated: number;
  brands_bid: number;
  closure_rate: number;            // closed deals / openings
  avg_rounds_to_close: number;     // mean rounds to first non-counter action
  total_llm_calls: number;
  ac_overrides_fired: number;
  walks_due_to_walk_away: number;
  winner_pct_of_fair_value: number; // winning bid / fair_value of its zone
};

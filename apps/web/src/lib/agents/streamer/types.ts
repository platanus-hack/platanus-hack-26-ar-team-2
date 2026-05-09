/**
 * Streamer-agent types (C-09).
 *
 * Single-shot variant: streamer evaluates ONCE at the T+5s auction deadline
 * with the full snapshot of brand standing offers + market signals + manager
 * hint + creator mandate. NO turn-by-turn counter-offers. See DESIGN.md §4
 * "Mecánica" + "Por qué single-shot".
 */

import type {
  AccountId,
  DealTerms,
  NegotiationTurn,
  StandingOffer,
  StreamerMandate,
  ZoneId,
} from "../types";

// ─── Per-zone numeric tuple ──────────────────────────────────────────

/**
 * Helper shape used by market signals — a number for each ad zone.
 * Centralizes the zones list so adding a zone touches one place.
 */
export type ZoneAmounts = {
  lower_third: number;
  bottom_right_corner: number;
  fullscreen_takeover: number;
};

// ─── Market signals (input to streamer & brand agents) ───────────────

/**
 * Pre-computed market context for the auction. Produced upstream by
 * `computeMarketSignals(tick)` in C-14 (`/api/auctions/run`); the streamer
 * receives this read-only and uses it as price anchor + RP source.
 *
 * Brands also receive this (visible in their prompt) so price-discovery
 * happens via brands escalating against `fair_value_usdc` and against each
 * other's standing offers — not via streamer counters.
 */
export type MarketSignals = {
  /** Manager-tagged narrative intensity for this moment. */
  intensity_label: "epic" | "building" | "rage" | "mundane";
  /** 0.5–2.0 multiplier applied on top of base zone fair values. */
  intensity_multiplier: number;
  /** What the market thinks each zone is worth right now (anchor for brands). */
  fair_value_usdc: ZoneAmounts;
  /**
   * Hard reservation price per zone — streamer will NEVER accept below this.
   * The single-shot RP gate (post-LLM) enforces this even if the LLM misses.
   */
  dynamic_reserve_usdc: ZoneAmounts;
  /** Streamer's stretch goal per zone (informational, not enforced). */
  streamer_aspiration_usdc: ZoneAmounts;
};

// ─── Manager hint (handed off from manager to auction) ───────────────

/**
 * Compressed manager decision passed into the auction so the streamer-agent
 * has the manager's narrative context. Subset of `ManagerDecision` from
 * DESIGN.md §4 — only the fields the streamer needs to pick + reason.
 */
export type ManagerHint = {
  intensity_label: MarketSignals["intensity_label"];
  recommended_zones: ZoneId[];
  recommended_max_duration_s: number;
  /** Lowercased keyword/phrase if manager pre-flagged brand-safety; else null. */
  brand_safety_pre_flag: string | null;
  /** Spanish ≤2 sentences. Streamer can quote this in its reason. */
  reason: string;
};

// ─── Input ───────────────────────────────────────────────────────────

/**
 * Everything the streamer-agent sees at the deadline. Brands have already
 * settled their concession curves; standing_offers is the snapshot.
 */
export type StreamerInput = {
  /**
   * Last-vigent offer per brand. Walked brands may still be present with
   * `walked: true` — the streamer ignores them. Empty list = no bidders
   * (rare; default bidder normally guarantees at least one).
   */
  standing_offers: StandingOffer[];
  market_signals: MarketSignals;
  manager_hint: ManagerHint;
  creator_mandate: StreamerMandate;
};

// ─── Decision (output) ───────────────────────────────────────────────

/**
 * Single-shot streamer-agent output. Exactly ONE of {accept, walk}.
 *
 * On accept: `winner_brand_id` + `terms` are set to the chosen standing
 * offer's terms (verbatim — streamer doesn't modify the brand's terms).
 *
 * On walk: no winner; `reason` explains why none cleared the dynamic
 * reserve. The auction ends with no placement, no escrow.lock(). Falls to
 * default bidder if one was present and cleared the floor.
 *
 * `override` is set iff the post-LLM RP gate caught the LLM trying to
 * accept a standing below `dynamic_reserve_usdc[zone]` — we override to
 * walk and persist the audit trail.
 */
export type StreamerDecision = {
  action: "accept" | "walk";
  winner_brand_id?: AccountId;
  terms?: DealTerms;
  /** Spanish, ≤25 words. Surfaced to /demo-display chat columns. */
  reason: string;
  override?: NegotiationTurn["override"];
  /** Per-rejected-brand audit lines. Empty if no other bidders. */
  rejected: { brand_id: AccountId; reason: string }[];
  /** Convenience for settlement: 0 on walk, terms.bid_usdc on accept. */
  total_revenue_usdc: number;
};

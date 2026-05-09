// Pure-math negotiation primitives. NO LLM calls in this file.
// The LLM does the LANGUAGE; this module owns the NUMBERS.
// (CICERO architectural principle: separate strategic reasoning from natural-language wrapping.)

import type { DealTerms } from "./types.js";

// ─── Faratin–Sierra–Jennings concession curve (1998) ────────────────────────
//
//   offer(t) = startPrice + (endPrice - startPrice) × (t / T)^(1/β)
//
//   β < 1  → BOULWARE (concedes only at the deadline; tough)
//   β = 1  → LINEAR
//   β > 1  → CONCEDER (concedes early; agreeable)
//
// β values used here are tournament-validated heuristics (GENIUS / ANAC):
//   STREAMER_PREMIUM_BETA = 0.30   premium slots (lower_third in epic moments)
//   STREAMER_FILLER_BETA  = 0.60   filler slots (corner)
//   BRAND_DEFAULT_BETA    = 0.50   moderate Boulware

export const STREAMER_PREMIUM_BETA = 0.3;
export const STREAMER_FILLER_BETA = 0.6;
export const BRAND_DEFAULT_BETA = 0.5;

export type ConcessionParams = {
  /** Where the agent starts (its aspiration / opening). */
  start_price: number;
  /** Where the agent ends at deadline (its reservation / walk-away). */
  end_price: number;
  /** 1-indexed current round. */
  round: number;
  /** Total rounds in the auction. */
  max_rounds: number;
  /** Curve shape — see β notes above. */
  beta: number;
};

/**
 * Concession curve. Returns the price the agent SHOULD propose this round.
 * For a seller, start_price is high (aspiration), end_price is low (reserve) — concedes downward.
 * For a buyer, start_price is low (opening_bid), end_price is high (max_acceptable) — concedes upward.
 */
export function concessionPrice(p: ConcessionParams): number {
  const t = Math.min(1, Math.max(0, p.round / p.max_rounds));
  const fraction = Math.pow(t, 1 / Math.max(0.05, p.beta));
  return p.start_price + (p.end_price - p.start_price) * fraction;
}

// ─── AC_combi acceptance condition (Baarslag–Hindriks–Jonker 2013) ──────────
//
// Accept iff ANY of:
//   AC_const(c)    — offer ≥ a fixed threshold c (the agent's RP / reserve)
//   AC_next(α,β)   — offer ≥ α × utility(my next planned offer) + β  (no point countering)
//   AC_time(T)     — deadline-imminent and offer is in ZOPA
//
// Combined under OR — the empirical winner in their tournaments and standard
// in top ANAC agents.

export type AcceptDecision =
  | { accept: true; rule: "AC_const" | "AC_next" | "AC_time"; reason: string }
  | { accept: false; rule_violated: "AC_const"; reason: string };

export type ValidateAcceptInput = {
  side: "brand" | "streamer";
  /** The price proposed by the OTHER party that this agent might accept. */
  offer_price_usdc: number;
  /** This agent's hard reservation — the worst it'll ever take. */
  reservation_usdc: number;
  /** This agent's next planned offer per its concession curve. */
  next_planned_price_usdc: number;
  /** Tunable threshold for AC_next (default 0.95: accept if opponent matches 95% of what we'd propose). */
  alpha_next?: number;
  /** Rounds remaining in the auction. */
  rounds_remaining: number;
  /** Wall-clock seconds remaining in the auction. */
  seconds_remaining: number;
};

const DEFAULT_ALPHA_NEXT = 0.95;
const T_CRITICAL_ROUNDS = 1;
const T_CRITICAL_SECONDS = 1.5;

export function validateAccept(opts: ValidateAcceptInput): AcceptDecision {
  const { side, offer_price_usdc, reservation_usdc, next_planned_price_usdc } = opts;
  const alpha = opts.alpha_next ?? DEFAULT_ALPHA_NEXT;

  // AC_const — the hard reservation gate. For a brand (buyer), beneficial = offer ≤ reservation.
  // For a streamer (seller), beneficial = offer ≥ reservation.
  const meetsReservation =
    side === "brand"
      ? offer_price_usdc <= reservation_usdc
      : offer_price_usdc >= reservation_usdc;

  if (!meetsReservation) {
    return {
      accept: false,
      rule_violated: "AC_const",
      reason:
        side === "brand"
          ? `offer $${offer_price_usdc.toFixed(2)} > reservation $${reservation_usdc.toFixed(2)} (would breach max_acceptable)`
          : `offer $${offer_price_usdc.toFixed(2)} < reservation $${reservation_usdc.toFixed(2)} (would breach dynamic_reserve)`,
    };
  }

  // AC_time — deadline imminent + in ZOPA → take it.
  if (opts.rounds_remaining <= T_CRITICAL_ROUNDS || opts.seconds_remaining <= T_CRITICAL_SECONDS) {
    return {
      accept: true,
      rule: "AC_time",
      reason: `deadline imminent (rounds=${opts.rounds_remaining}, seconds=${opts.seconds_remaining.toFixed(1)}) and offer in ZOPA`,
    };
  }

  // AC_next — opponent matches/beats what we'd propose next, no point countering.
  const opponentMatchesNext =
    side === "brand"
      ? offer_price_usdc <= next_planned_price_usdc / alpha // brand wants offer ≤ next_planned (low)
      : offer_price_usdc >= next_planned_price_usdc * alpha; // streamer wants offer ≥ next_planned (high)

  if (opponentMatchesNext) {
    return {
      accept: true,
      rule: "AC_next",
      reason: `offer $${offer_price_usdc.toFixed(2)} ${side === "brand" ? "below" : "above"} ${alpha.toFixed(2)}× next planned $${next_planned_price_usdc.toFixed(2)}`,
    };
  }

  // Beneficial but not yet hitting AC_next or AC_time — would normally counter.
  // Returning accept:true with AC_const lets the LLM still choose to accept (within RP) for soft reasons.
  return {
    accept: true,
    rule: "AC_const",
    reason: `offer $${offer_price_usdc.toFixed(2)} within reservation $${reservation_usdc.toFixed(2)}`,
  };
}

// ─── Soft expiry: standing offer utility decays per round it ages ───────────

export const SOFT_EXPIRY_DECAY_PER_ROUND = 0.05;

export function softExpiryFactor(rounds_aged: number): number {
  return Math.max(0, 1 - rounds_aged * SOFT_EXPIRY_DECAY_PER_ROUND);
}

// ─── BATNA: streamer's next-best is the runner-up bid this round ────────────
//
// Real ad-tech: the seller's BATNA in a sealed-bid is "second-highest bid"
// (Vickrey insight). For our open-dialogue auction, equivalent = highest
// standing offer from any OTHER active brand session.

export type BatnaInput = {
  /** All active sessions' last brand offer (excluding the focal brand). */
  other_active_offers_usdc: number[];
  /** Floor below which streamer would prefer empty slot — typically dynamic_reserve. */
  floor_usdc: number;
};

export function streamerBatna(opts: BatnaInput): number {
  if (opts.other_active_offers_usdc.length === 0) return opts.floor_usdc;
  return Math.max(opts.floor_usdc, Math.max(...opts.other_active_offers_usdc));
}

// ─── Multi-issue: exclusivity premium ───────────────────────────────────────
//
// Brand offers exclusivity_s = N seconds during which no competitor ad runs.
// For the streamer this has cost (foregoing other auctions in window).
// For the brand it has value (no competitive contamination of their placement).
//
// Streamer's premium for accepting exclusivity:
//   premium = base_price × min(1.0, exclusivity_s / 60) × 0.30
// i.e. up to +30% of base price for full 60s exclusivity.

export const MAX_EXCLUSIVITY_S = 60;
export const MAX_EXCLUSIVITY_PREMIUM = 0.30;

export function exclusivityPremium(base_price_usdc: number, exclusivity_s: number): number {
  const factor = Math.min(1, exclusivity_s / MAX_EXCLUSIVITY_S);
  return base_price_usdc * factor * MAX_EXCLUSIVITY_PREMIUM;
}

/** Effective price the streamer "feels" they're collecting given exclusivity. */
export function effectivePriceForStreamer(terms: DealTerms): number {
  return terms.bid_usdc - exclusivityPremium(terms.bid_usdc, terms.exclusivity_s ?? 0);
}

/** Effective value the brand perceives given exclusivity (their valuation includes the premium). */
export function effectiveValueForBrand(terms: DealTerms, base_value: number): number {
  return base_value + exclusivityPremium(base_value, terms.exclusivity_s ?? 0);
}

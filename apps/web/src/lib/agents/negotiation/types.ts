/**
 * Negotiation orchestrator types (C-10).
 *
 * The orchestrator runs N brand-agents through `cap_turns` rounds and emits
 * the snapshot of standing offers that `streamerEvaluate()` (C-09) consumes
 * at T+5s.
 *
 * MVP ships with `cap_turns: 1` — the `opening_message` produced by Sonnet
 * inside `huntForBrand()` (gate4) already carries the brand voice, so turn-0
 * standings are the auction. Multi-turno (`cap_turns ≥ 2`) is wired-in but
 * not exercised in MVP — when we want LLM-generated counters per turn, we
 * plug a Haiku call inside `runOneTurn()` without touching this shape.
 *
 * Cross-reference: DESIGN.md §4 (Mecánica + Standing offers).
 */

import type { LoadedBrand } from "../brands/loader.ts";
import type {
  AccountId,
  BrandValuation,
  DealTerms,
  NegotiationTurn,
  StandingOffer,
} from "../types.ts";
import type { ManagerHint, MarketSignals } from "../streamer/types.ts";

/**
 * One brand entering the auction. Built from a `huntForBrand()` HuntResult
 * whose `decision.should_bid === true`. SKIP brands never reach the
 * orchestrator — the C-14 flow filters them out before calling here.
 */
export type NegotiationBrand = {
  brand: LoadedBrand;
  /** UUID of the brand's `accounts` row — used as `brand_id` everywhere on-chain/off-chain. */
  account_id: AccountId;
  /** Terms emitted by gate4 Sonnet — these become the turn-0 standing offer. */
  opening_terms: DealTerms;
  /** Sonnet-generated text in brand voice. Persisted as the open turn's `message`. */
  opening_message: string;
  /** Auditable valuation breakdown carried into `placements.agent_reasoning` for the winner. */
  valuation: BrandValuation;
  /** Off-chain available balance after holds — clamps any concession in turns ≥ 2. */
  available_balance_usdc: number;
};

export type NegotiationArgs = {
  /**
   * Stable id for this auction across logs / broadcasts. Recommended:
   * `<placement_id>` if a `placements` row exists, else `<chunk_id>` from
   * the manager tick. Surfaced in every `negotiation:*` log line.
   */
  auction_id: string;
  brands: NegotiationBrand[];
  market_signals: MarketSignals;
  manager_hint: ManagerHint;
  /** Default 1 (MVP). 2–3 enables multi-turno once concession LLM is wired. */
  cap_turns?: number;
  /** Default 5000ms. Hard deadline; turns past it are skipped. */
  deadline_ms?: number;
  /** Injectable for tests. Default `() => Date.now()`. */
  now?: () => number;
  /**
   * Per-turn broadcast hook (C-13a). The orchestrator calls this for every
   * turn it emits — typically wired to `POST /api/creators/<id>/render`
   * with `{ kind: 'negotiation_turn', auction_id, turn }` so /demo-display
   * shows the chat live. Default: no-op (smoke + harness paths run silent).
   */
  onTurn?: (turn: NegotiationTurn) => void | Promise<void>;
};

/**
 * What runNegotiation emits. Consumed by:
 *   - C-09 streamerEvaluate() — reads `standing_offers` to pick a winner
 *   - C-12 settlement engine  — uses `standing_offers` + transcript for placement
 *   - C-16 audit metadata     — persists `transcript` to `placements.negotiation_transcript`
 */
export type NegotiationResult = {
  /** Last vigent offer per brand at the deadline. Only `walked: false` are eligible to win. */
  standing_offers: StandingOffer[];
  /** Every turn that fired, in chronological order. Persisted as audit. */
  transcript: NegotiationTurn[];
  metrics: {
    /** Total turns that fired (sum across brands × rounds). */
    total_turns: number;
    /** Rounds the orchestrator entered (≤ cap_turns). */
    total_rounds: number;
    /** Times AC_combi gate forced a walk because LLM tried to breach reservation price. */
    ac_overrides_fired: number;
    /** True if the deadline cut the loop short. */
    deadline_hit: boolean;
    /** Wall-clock ms from start to last turn. */
    total_ms: number;
  };
};

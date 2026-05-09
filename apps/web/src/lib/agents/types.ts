/**
 * Common types for the agent layer.
 *
 * These are the canonical shapes shared by:
 *   - brand-agent runner       (apps/web/src/lib/agents/brand/, C-08)
 *   - streamer-agent runner    (apps/web/src/lib/agents/streamer/, C-09)
 *   - negotiation orchestrator (apps/web/src/lib/agents/negotiation/, C-10)
 *   - soft-hold ledger         (apps/web/src/lib/agents/negotiation/holds.ts, C-11)
 *   - settlement engine        (C-12)
 *   - audit metadata writer    (C-16)
 *
 * The DB schema in `supabase/migrations/` mirrors these where persisted —
 * mandates.payload JSONB stores Mandate; placements.negotiation_transcript
 * stores NegotiationTurn[]; placements.agent_reasoning stores the winning
 * BrandAgentDecision.
 *
 * Cross-reference: DESIGN.md §4 (negotiation), §5 (audit per placement).
 * See also poc/negotiation/src/types.ts for the prototype this distils.
 */

// ─── Identity ────────────────────────────────────────────────────────

/** UUID of an `accounts` row. Brand, creator, or platform. */
export type AccountId = string;

/** UUID of a `streams` row. */
export type StreamId = string;

/** UUID of a `placements` row. Auction unit. */
export type PlacementId = string;

/** UUID of an `ads` row in the brand's library. */
export type AdId = string;

// ─── Inventory ───────────────────────────────────────────────────────

/**
 * Ad format options. Per DESIGN.md §4 these are FORMATS of the single slot
 * (single-ad-per-moment), not parallel slots.
 *
 * - lower_third: 1920×180 banner, 5–8s, episodic on epic moments
 * - bottom_right_corner: 240×240 logo, up to 60s, default-bidder eligible
 * - fullscreen_takeover: 1920×1080, 30s, manual-only via FULL BREAK hotkey
 */
export type ZoneId = "lower_third" | "bottom_right_corner" | "fullscreen_takeover";

// ─── Stream context (input from pipeline B-07) ───────────────────────

/**
 * Context tick produced by the pipeline (audio + frame + chat) and broadcast
 * on the Supabase Realtime channel that brand-agents subscribe to.
 */
export type StreamContext = {
  stream_id: StreamId;
  /** Rolling 30s of speech-to-text from Deepgram. */
  audio_30s: string;
  /** Frame summary + tags from Gemini Flash multimodal. */
  frame_description: string;
  /** Twitch chat msgs/s from tmi.js. */
  chat_velocity_msgs: number;
  /** Channel's rolling baseline for spike detection. */
  chat_baseline_msgs: number;
  /** 0..1 from chat sentiment classifier. */
  sentiment: number;
  viewers: number;
  game: string;
  /** Optional pipeline-side mood label, e.g. "high_energy_celebration". */
  mood?: string;
  /** Server-generated millis since epoch. */
  ts_ms: number;
};

// ─── Mandate (signed autonomy boundary) ──────────────────────────────

/**
 * Brand mandate. Signed by the brand-human, carried by the brand-agent.
 * Stored as `mandates.payload` JSONB when type='brand'.
 */
export type BrandMandate = {
  type: "brand";
  account_id: AccountId;
  display_name: string;
  /** Voice/tone fingerprint passed to Claude in the system prompt. */
  brand_voice: string;
  /** Hard daily spend cap (USDC). */
  daily_cap_usdc: number;
  /** USDC already spent today — refreshed by the orchestrator pre-bid. */
  spent_today_usdc: number;
  /** Hard min/max per placement. max_bid is the absolute ceiling. */
  min_bid_usdc: number;
  max_bid_usdc: number;
  targeting: {
    /** Game titles this brand wants to bid against. ['any'] = unrestricted. */
    games: string[];
    /** Mood tags this brand wants. ['any'] = unrestricted. */
    moods: string[];
  };
  brand_safety: {
    /** Lower-cased keywords that trigger refund if heard during render. */
    blocked_keywords: string[];
  };
  /**
   * Default bidder flag — DESIGN.md §4. mp uses this: always emits a
   * floor-priced offer if the context isn't brand-unsafe, guaranteeing
   * fill when no premium brand bids.
   */
  always_bid_floor?: boolean;
  /** UI/log color hex, e.g. "#000000" for adidas. */
  color?: string;
};

/**
 * Streamer mandate. Signed by the creator, carried by the streamer-agent.
 * Stored as `mandates.payload` JSONB when type='streamer'.
 */
export type StreamerMandate = {
  type: "streamer";
  account_id: AccountId;
  display_name: string;
  /**
   * Absolute minimum USDC the streamer will ever accept regardless of zone
   * or context. Per-zone reserves come from market signals + this floor.
   */
  hard_floor_usdc: number;
  /** Trigger refund if any of these is detected during render. */
  blocked_keywords: string[];
  /** Tiebreaker: prefer these brand_ids when offers tie. */
  preferred_brands: AccountId[];
  /** UI/log color hex. */
  color?: string;
};

export type Mandate = BrandMandate | StreamerMandate;

// ─── Deal terms (multi-issue) ────────────────────────────────────────

/**
 * The negotiable bundle. Issues per DESIGN.md §4: price, zone (format),
 * duration, exclusivity (multi-issue extension).
 */
export type DealTerms = {
  /** Bid amount in USDC (decimal). */
  bid_usdc: number;
  /** Placement duration in seconds (typically 5–60 depending on zone). */
  duration_s: number;
  /** Which ad format/zone the placement runs in. */
  zone: ZoneId;
  /**
   * Multi-issue: seconds of competitor lockout AFTER this placement ends.
   * 0 (or undefined) = no exclusivity. Up to 60s. Brand pays implicit
   * premium for it; streamer values the lockout cost.
   */
  exclusivity_s?: number;
  /** Which ad from the brand's library. Set on accept; absent in some early offers. */
  ad_id?: AdId;
};

// ─── Brand-agent hunt decision (output of C-08) ──────────────────────

/**
 * Auditable per-placement reasoning the brand-agent committed to.
 * Persisted to `placements.agent_reasoning` for the winner (C-16).
 */
export type BrandValuation = {
  /** 0.4–2.0 score combining game/mood/audience/voice/ad-library fit. */
  brand_fit_multiplier: number;
  /** Bullet rationale: which fit factors hit. */
  fit_reasons: string[];
  /** market.fair_value × brand_fit_multiplier. */
  perceived_value_usdc: number;
  /** Walk-away ceiling: min(perceived × 0.85, daily_remaining × 0.30, max_bid). */
  max_acceptable_usdc: number;
  /** 0.55–0.75: how aggressive the open is vs max_acceptable. */
  opening_factor: number;
  /** Final opening_bid = clamp(min_zone, max_acceptable × opening_factor). */
  opening_bid_usdc: number;
  /** What competitive landscape the brand assumed (drives opening_factor). */
  competitive_assumption: string;
};

/**
 * What the brand-agent emits per context tick.
 * Either it bids (with full deal terms + reasoning) or it skips (with reason).
 */
export type BrandAgentDecision =
  | {
      should_bid: true;
      ad_id: AdId;
      zone: ZoneId;
      bid_usdc: number;
      duration_s: number;
      exclusivity_s?: number;
      /** Spanish, ≤25 words, in brand voice. First message of the negotiation. */
      opening_message: string;
      reasoning: BrandValuation;
    }
  | {
      should_bid: false;
      /** 1–2 sentence rationale (Spanish). Persisted to audit even on SKIP. */
      reason: string;
      /** For audit: even SKIPs report the fit they computed. */
      brand_fit_multiplier?: number;
    };

// ─── Negotiation turn (one row in the dialogue) ──────────────────────

export type TurnAction = "open" | "counter" | "accept" | "reject" | "walk";

/**
 * One utterance in a brand↔streamer negotiation. The full sequence for a
 * placement is persisted to `placements.negotiation_transcript` (C-16).
 */
export type NegotiationTurn = {
  from: "brand" | "streamer";
  brand_id: AccountId;
  action: TurnAction;
  /** Spanish, ≤25 words. */
  message: string;
  /** Terms attached to this turn (open/counter carry them; accept/reject can omit). */
  terms?: DealTerms;
  /** Millis since the negotiation started (T+0 = first opening). */
  ts_ms: number;
  /**
   * The price the speaker SHOULD have proposed this round per the
   * concession curve (Faratin–Sierra–Jennings). Audit-only; the actual
   * `terms.bid_usdc` may differ within ±5% per tactic.
   */
  curve_target_usdc?: number;
  /**
   * If the code-side AC_combi gate (C-10) overrode the LLM's intended
   * action — e.g. LLM said `accept` but offer breached reservation, so we
   * forced `walk`. Critical for audit ("LLM mistake caught by gate").
   */
  override?: {
    from_action: TurnAction;
    /** Which AC_combi rule fired: AC_const | AC_next | AC_time. */
    rule: string;
    reason: string;
  };
  /** Streamer-side: which playbook tactic was applied (PLAY_BIDDERS, etc.). */
  tactic?: string;
};

// ─── Standing offer (DESIGN.md §4) ───────────────────────────────────

/**
 * The brand's currently-vigent offer in a negotiation. Updated each
 * brand turn. At the T+5s deadline the streamer-agent picks the best
 * standing ≥ floor across all sessions ("going once, going twice, sold").
 *
 * If a brand walks or the session times out, its standing decays via
 * soft-expiry (5%/round) until it expires entirely.
 */
export type StandingOffer = {
  brand_id: AccountId;
  placement_id: PlacementId;
  terms: DealTerms;
  /** Last message from the brand carrying this standing. */
  message: string;
  /** Millis since the negotiation started; updated each refresh. */
  last_turn_ts_ms: number;
  /** Rounds since this standing was last updated. Drives soft-expiry decay. */
  rounds_aged: number;
  /** True if the brand explicitly walked (do not consider for settlement). */
  walked: boolean;
};

// ─── Soft hold (off-chain ledger, DESIGN.md §4) ──────────────────────

/**
 * Off-chain reservation against a brand's wallet. Prevents double-spend
 * across parallel auctions on different streams.
 *
 * Lifecycle:
 *   1. Brand-agent emits/updates a standing offer → orchestrator creates/
 *      refreshes a SoftHold (expires_at = now + 10s).
 *   2. `available_balance = on_chain_balance - sum(active holds for brand)`
 *      is exposed to the LLM in subsequent prompts.
 *   3. On settlement, the WINNING hold is converted to escrow.lock() on Base.
 *      Loser holds are released; expired holds auto-expire.
 *
 * Post-MVP §14: replaced with EIP-3009 transferWithAuthorization (real
 * onchain holds, no central ledger).
 */
export type SoftHold = {
  brand_id: AccountId;
  placement_id: PlacementId;
  amount_usdc: number;
  created_at_ms: number;
  /** Default: created_at_ms + 10_000. Expired holds are ignored. */
  expires_at_ms: number;
};

// ─── Closed deal + settlement (used by C-12) ─────────────────────────

/**
 * Output of a single negotiation session at the deadline.
 * Single-ad-per-moment: only ONE accepted deal will be settled per round
 * (the streamer-agent's pickWinner picks across all closed deals).
 */
export type ClosedDeal = {
  brand_id: AccountId;
  /** True if the session ended in mutual acceptance with valid terms. */
  accepted: boolean;
  /** Final agreed terms if accepted; absent otherwise. */
  terms?: DealTerms;
  history: NegotiationTurn[];
  closing_action: TurnAction | "timeout";
};

/**
 * The settlement engine's final pick (C-12). At most one winner per round
 * (single-ad-per-moment). `winner = null` if no closed deal cleared the
 * dynamic_reserve of its zone.
 */
export type FinalDecision = {
  winner: { brand_id: AccountId; terms: DealTerms; reason: string } | null;
  rejected: { brand_id: AccountId; reason: string }[];
  total_revenue_usdc: number;
};

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
  /** Rolling 30s of speech-to-text from ElevenLabs Scribe v2 realtime. */
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
 * AI prompting bundle for a brand-agent. Persisted on `mandates.prompt`
 * (separate JSONB column from `mandates.payload` because it's owned by
 * the brand's marketing/creative team, not legal/finance — different
 * stakeholders, different update cadence).
 *
 * Goes into Claude's system message when the brand-agent runs.
 */
export type BrandPrompt = {
  /**
   * Full system persona block. Describes WHO the agent is, what it
   * cares about, what tone to use. Goes verbatim into Claude system msg.
   * Example: "Sos el agent de adidas Argentina. Voz épica, deportiva,
   * segunda persona, energía alta. Mandate: máxima atención a momentos
   * celebratorios deportivos."
   */
  system_persona: string;
  /**
   * 2–4 example utterances in brand voice. Few-shot anchor — helps the
   * model nail tone faster than instructions alone.
   * Example: ["Dale campeón, ese golazo merece adidas.", "Sentilo: tu juego, nuestra energía."]
   */
  voice_examples: string[];
  /**
   * Hard prohibitions — exact words/phrases the agent must never produce.
   * Filtered against output post-LLM. Example: ["barato", "promo", "descuento"]
   */
  dont_say: string[];
  /**
   * Soft behavioral guidance — things to avoid in spirit, not exact strings.
   * Example: ["mencionar precios competidores", "tono formal/corporativo"]
   */
  dont_do: string[];
};

/**
 * Brand mandate. Signed by the brand-human, carried by the brand-agent.
 * Stored as `mandates.payload` JSONB when type='brand'.
 *
 * The AI prompting (system persona, voice examples, prohibitions) lives
 * SEPARATELY in `mandates.prompt` JSONB → see {@link BrandPrompt}.
 */
export type BrandMandate = {
  type: "brand";
  account_id: AccountId;
  display_name: string;
  /**
   * Short voice/tone fingerprint — kept for backward compat + brevity in logs.
   * The full prompting lives in {@link BrandPrompt} on `mandates.prompt`.
   */
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

// ─── Mandate extensions — gate ladder schema (C-02b) ─────────────────

/**
 * Gate-1 deterministic event filters. All optional — missing field = gate
 * sub-check is skipped (backwards-compat with mandates that don't declare it).
 *
 * Spec: docs/GATES.md §3.
 */
export type EventFilters = {
  /**
   * Gate 1: at least ONE tag must match `frame_tags`/`scene_type`/`mood_tags`
   * of the context tick. `undefined` or `[]` = no tag requirement.
   */
  required_any_tag?: string[];
  /**
   * Gate 1: stream's `StreamMetadata.category` must be in this list.
   * `undefined` = any category allowed.
   */
  preferred_categories?: string[];
  /** Gate 1: skip if `stream.viewers < min_viewers`. Default 0. */
  min_viewers?: number;
  /**
   * Gate 1: skip if `stream.viewers > max_viewers`. Default = no upper bound.
   *
   * Used by community-style brands (e.g. MateBros) that prefer intimate
   * audiences over massive ones — the SKIP message is "audience too big for
   * this mandate". See docs/GATES.md §3 + docs/PITCH.md Bloque 3.
   */
  max_viewers?: number;
  /**
   * Gate 1: at least one keyword must appear in `recent_keywords`/`audio_30s`.
   * `undefined` or `[]` = no chat keyword requirement.
   */
  required_chat_keyword_any?: string[];
};

/**
 * Extended brand-safety. Merges with `BrandMandate.brand_safety.blocked_keywords`
 * (legacy) and adds category + competitor checks.
 */
export type BrandSafetyExtended = {
  /** Lower-cased keywords that trigger SKIP at gate 1 (and refund post-render). */
  blocked_keywords: string[];
  /** Stream categories to skip ('politics' | 'nsfw' | 'gambling' | …). */
  blocked_categories?: string[];
  /** Lowercased competitor brand names — SKIP if mentioned in chat/audio. */
  blocked_competitor_brands?: string[];
};

/**
 * Active dayparts. Each entry is a window in `"HH:MM-HH:MM TZ"` format
 * (e.g. `"19:00-23:59 ART"`). Wrap-around past midnight is supported
 * (e.g. `"23:00-02:00 ART"` matches `01:30 ART`).
 */
export type MandateDayparts = {
  active: string[];
};

/**
 * Free-text descriptions of moments the brand wants to bid on. Embedded
 * once at boot for gate 2 (cosine similarity vs context_snapshot).
 *
 * Tradeoff: keeping these as `string[]` (not `{ text, weight }[]`) avoids
 * over-engineering for MVP — equal weight is fine for 4 brands × 3-4
 * contexts each. Revisit post-MVP if calibration needs per-context weighting.
 */
export type IdealContext = string;

/**
 * The gate-ladder schema extension. Sidecar to {@link BrandMandate} so the
 * legal/financial mandate stays unchanged. Loader splits the YAML into
 * (BrandMandate, BrandPrompt, MandateExtensions) — see brands/loader.ts.
 *
 * All fields optional: a mandate without extensions falls back to legacy
 * behavior (no gate ladder, just BrandMandate.targeting + brand_safety).
 */
export type MandateExtensions = {
  event_filters?: EventFilters;
  brand_safety?: BrandSafetyExtended;
  dayparts?: MandateDayparts;
  ideal_contexts?: IdealContext[];
};

// ─── Gate ladder runtime types (C-08a/c/d) ──────────────────────────

/**
 * Gate1 (deterministic mandate filter) skip reason codes. Pure function,
 * no LLM. Spec: docs/GATES.md §8.1 — order is budget → brand_safety →
 * event_filters → dayparts (early-return on first match).
 */
export type Gate1ReasonCode =
  | "daily_cap_exceeded"
  | "available_balance_below_min_bid"
  | "blocked_keyword"
  | "blocked_competitor_brand"
  | "blocked_category"
  | "category_not_preferred"
  | "viewers_below_min"
  | "viewers_above_max"
  | "missing_required_tag"
  | "missing_required_chat_keyword"
  | "outside_daypart";

/**
 * Gate3 (cheap-LLM triage) skip reason codes. Per-brand Haiku call that
 * filters voice/persona mismatches surviving gate1. Spec: docs/GATES.md §8.3.
 */
export type Gate3ReasonCode = "triage_should_not_bid" | "triage_low_confidence";

/**
 * Per-skip audit + UI event emitted whenever a brand fails any gate.
 * Persisted to `render_events.payload.gate_skips[]` and rendered verbatim
 * by the D-09a didactic feed.
 */
export type GateSkipReason = {
  brand_id: string;
  brand_display_name: string;
  gate: 1 | 2 | 3 | 4;
  /** Machine-readable code. Cast to Gate{N}ReasonCode at consumption site. */
  code: string;
  /** Context detail: which keyword matched / which threshold was breached. */
  detail?: string;
  /** Spanish, ≤25 words. Renderable verbatim in the gate-skip feed. */
  human_message: string;
};

/**
 * Minimal shape gate1 reads from the context tick. Both `ContextChunk`
 * (manager/types.ts, post-B-07c) and `StreamContext` (in-memory pipeline
 * tick) satisfy this structurally — gate1 stays decoupled from either.
 */
export type Gate1Context = {
  audio_text?: string | null;
  audio_mentions?: string[] | null;
  audio_topics?: string[] | null;
  mood_tags?: string[] | null;
  scene_type?: string | null;
  chat_recent_keywords?: string[] | null;
  viewers?: number | null;
  game_category?: string | null;
};

// ─── Stream metadata (C-02c) ─────────────────────────────────────────

/**
 * Per-stream config used by gate 1 (event_filters match) and as baseline
 * context for gate 2 (embeddings). Loaded from
 * `apps/web/src/lib/streams/<stream_id>.yaml`.
 *
 * Spec: docs/GATES.md §5.
 */
export type StreamMetadata = {
  stream_id: string;
  /** Twitch handle or platform-specific ID. */
  streamer: string;
  /** 'gaming' | 'just_chatting' | 'irl' | etc. — matched against EventFilters.preferred_categories. */
  category: string;
  /** Game title if applicable, else null. */
  game: string | null;
  language: string;
  /** Daypart slugs (e.g. 'midday_arg', 'evening_arg') — informational, not gate-evaluated. */
  expected_dayparts?: string[];
  /** Topics the streamer plans to cover — used as gate-2 baseline if available. */
  expected_topics?: string[];
  /** Legacy del modelo acústico (pre-pivote 2026-05-09) — el cron manager
   *  hoy filtra semánticamente vía audio_intent + audio_mentions (B-07c),
   *  no por trigger words. Campo se mantiene por backwards-compat con
   *  fixtures viejas; no consumido por la pipeline activa. */
  rehearsed_triggers?: { word: string; expected_mood: string }[];
  audience?: {
    expected_viewers_min?: number;
    expected_viewers_max?: number;
    primary_locale?: string;
  };
};

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

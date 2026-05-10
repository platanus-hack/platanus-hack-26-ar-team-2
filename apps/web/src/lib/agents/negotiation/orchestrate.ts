/**
 * Negotiation orchestrator — C-10.
 *
 * Runs N brand-agents through `cap_turns` rounds and emits the snapshot of
 * standing offers consumed by `streamerEvaluate()` (C-09) at T+5s and by
 * the C-12 settlement engine.
 *
 * MVP shape (cap_turns=1):
 *   - Each NegotiationBrand carries a Sonnet-blessed opening (terms + message
 *     + valuation) from `huntForBrand()`. The orchestrator turns each opening
 *     into a `NegotiationTurn{action:'open'}` + a `StandingOffer`.
 *   - No counters fire. The streamer-agent picks from these standings at T+5s.
 *   - 5s deadline acts as a guardrail (won't fire in turn-1 path).
 *
 * Multi-turno (cap_turns ≥ 2) leaves `runOneRound()` as the seam where a
 * Haiku-driven concession step plugs in later. Today rounds 2+ short-circuit
 * with the brand holding its turn-0 standing — same audit shape, no LLM.
 *
 * Logging: every invocation emits `negotiation:start`, then one
 * `negotiation:turn` per emitted turn, then `negotiation:result`. All carry
 * `auction_id` so we can grep the full life of one auction in Vercel logs.
 *
 * Cross-reference: DESIGN.md §4 (Mecánica + Standing offers).
 */

import type {
  NegotiationTurn,
  StandingOffer,
} from "../types.ts";

import type {
  NegotiationArgs,
  NegotiationBrand,
  NegotiationResult,
} from "./types.ts";

const DEFAULT_DEADLINE_MS = 5000;
const DEFAULT_CAP_TURNS = 1;

export async function runNegotiation(args: NegotiationArgs): Promise<NegotiationResult> {
  const now = args.now ?? (() => Date.now());
  const deadlineMs = args.deadline_ms ?? DEFAULT_DEADLINE_MS;
  const capTurns = Math.max(1, args.cap_turns ?? DEFAULT_CAP_TURNS);
  const t0 = now();
  const deadlineAt = t0 + deadlineMs;

  logStart(args, { capTurns, deadlineMs, t0 });

  const transcript: NegotiationTurn[] = [];
  const standings = new Map<string, StandingOffer>();
  let acOverridesFired = 0;
  let deadlineHit = false;
  let roundsRan = 0;

  // ── Round 0 — openings come straight from huntForBrand gate4 ────────
  const openings = buildOpenings(args, t0);
  for (const turn of openings) {
    transcript.push(turn);
    standings.set(turn.brand_id, openingToStanding(args, turn));
    await emitTurn(args, turn);
  }
  roundsRan = 1;

  // ── Rounds 1..cap_turns-1 — concession (no-op in MVP) ───────────────
  // Today every brand HOLDS its turn-0 standing. When LLM-generated counters
  // land, replace `runOneRound` with a per-brand concession step (Haiku).
  for (let round = 1; round < capTurns; round++) {
    if (now() >= deadlineAt) {
      deadlineHit = true;
      break;
    }
    const result = await runOneRound({
      args,
      round,
      now,
      standings,
      transcript,
    });
    acOverridesFired += result.ac_overrides_fired;
    roundsRan = round + 1;
  }

  const totalMs = now() - t0;
  const standingOffers = Array.from(standings.values());
  const metrics: NegotiationResult["metrics"] = {
    total_turns: transcript.length,
    total_rounds: roundsRan,
    ac_overrides_fired: acOverridesFired,
    deadline_hit: deadlineHit,
    total_ms: totalMs,
  };

  logResult(args, metrics, standingOffers);

  return {
    standing_offers: standingOffers,
    transcript,
    metrics,
  };
}

// ─── Round 0: openings ───────────────────────────────────────────────

function buildOpenings(
  args: NegotiationArgs,
  t0: number,
): NegotiationTurn[] {
  return args.brands.map((b, idx) => ({
    from: "brand" as const,
    brand_id: b.account_id,
    action: "open" as const,
    message: b.opening_message,
    terms: b.opening_terms,
    // Stagger micro-jitter (1ms) so transcripts have a stable order even if
    // multiple brands open in the "same" tick. Audit-friendly, doesn't affect
    // settlement.
    ts_ms: t0 + idx,
    curve_target_usdc: b.opening_terms.bid_usdc,
  }));
}

function openingToStanding(
  _args: NegotiationArgs,
  turn: NegotiationTurn,
): StandingOffer {
  return {
    brand_id: turn.brand_id,
    // Placement id is unknown until C-14 inserts the row; the orchestrator
    // runs against an in-memory ledger, so we use the brand_id as the offer
    // key. Settlement (C-12) will mint the real `placement_id` post-pickWinner.
    placement_id: turn.brand_id,
    terms: turn.terms!,
    message: turn.message,
    last_turn_ts_ms: turn.ts_ms,
    rounds_aged: 0,
    walked: false,
  };
}

// ─── Rounds 1+: concession step (no-op in MVP, seam for Haiku later) ─

type RoundContext = {
  args: NegotiationArgs;
  round: number;
  now: () => number;
  standings: Map<string, StandingOffer>;
  transcript: NegotiationTurn[];
};

async function runOneRound(
  ctx: RoundContext,
): Promise<{ ac_overrides_fired: number }> {
  // MVP: every brand holds. Age each standing one round so we have a stable
  // audit field even when nothing changed. Default-bidder brands always hold
  // here too — they're explicit floor-only, no climb logic.
  for (const [, standing] of ctx.standings) {
    if (standing.walked) continue;
    standing.rounds_aged += 1;
  }
  // Future seam: per brand, call decideConcession(brand, competitorMax, …)
  //   → if action='concede' → push counter turn + update standing
  //   → if action='walk'    → push walk turn + standing.walked=true
  //   → if AC_combi gate fires (LLM tried to breach RP) → ac_overrides++
  return { ac_overrides_fired: 0 };
}

// ─── Broadcast hook ──────────────────────────────────────────────────

async function emitTurn(
  args: NegotiationArgs,
  turn: NegotiationTurn,
): Promise<void> {
  logTurn(args, turn);
  if (!args.onTurn) return;
  try {
    await args.onTurn(turn);
  } catch (err) {
    // Broadcast failure must never break the auction. Log and continue.
    console.log(
      JSON.stringify({
        tag: "negotiation:on_turn_error",
        auction_id: args.auction_id,
        brand_id: turn.brand_id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Structured logging ──────────────────────────────────────────────

function logStart(
  args: NegotiationArgs,
  meta: { capTurns: number; deadlineMs: number; t0: number },
): void {
  console.log(
    JSON.stringify({
      tag: "negotiation:start",
      auction_id: args.auction_id,
      n_brands: args.brands.length,
      brand_ids: args.brands.map((b) => b.account_id),
      cap_turns: meta.capTurns,
      deadline_ms: meta.deadlineMs,
      zones_in_play: distinctZones(args.brands),
      total_opening_volume_usdc: sumOpeningBids(args.brands),
      ts_ms: meta.t0,
    }),
  );
}

function logTurn(args: NegotiationArgs, turn: NegotiationTurn): void {
  console.log(
    JSON.stringify({
      tag: "negotiation:turn",
      auction_id: args.auction_id,
      brand_id: turn.brand_id,
      action: turn.action,
      bid_usdc: turn.terms?.bid_usdc ?? null,
      zone: turn.terms?.zone ?? null,
      curve_target_usdc: turn.curve_target_usdc ?? null,
      override_rule: turn.override?.rule ?? null,
      ts_ms: turn.ts_ms,
    }),
  );
}

function logResult(
  args: NegotiationArgs,
  metrics: NegotiationResult["metrics"],
  standings: StandingOffer[],
): void {
  const active = standings.filter((s) => !s.walked);
  const finalMaxBid = active.reduce(
    (max, s) => (s.terms.bid_usdc > max ? s.terms.bid_usdc : max),
    0,
  );
  console.log(
    JSON.stringify({
      tag: "negotiation:result",
      auction_id: args.auction_id,
      total_turns: metrics.total_turns,
      total_rounds: metrics.total_rounds,
      ac_overrides_fired: metrics.ac_overrides_fired,
      deadline_hit: metrics.deadline_hit,
      total_ms: metrics.total_ms,
      n_active: active.length,
      n_walked: standings.length - active.length,
      final_max_bid_usdc: finalMaxBid,
    }),
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function distinctZones(brands: NegotiationBrand[]): string[] {
  const set = new Set<string>();
  for (const b of brands) set.add(b.opening_terms.zone);
  return Array.from(set);
}

function sumOpeningBids(brands: NegotiationBrand[]): number {
  return brands.reduce((sum, b) => sum + b.opening_terms.bid_usdc, 0);
}

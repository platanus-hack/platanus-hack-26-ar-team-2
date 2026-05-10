// Smoke test for negotiation orchestrator (C-10).
//
// Runs `runNegotiation()` against synthetic NegotiationBrand fixtures with no
// LLM, no DB, no network. Validates the 1-turn MVP path (cap_turns=1):
//   - Openings are turned into NegotiationTurn{action:'open'} + StandingOffer
//   - onTurn callback fires once per emitted turn
//   - metrics shape (total_turns, total_rounds, deadline_hit, total_ms)
//   - cap_turns=2 path runs as no-op concession (rounds_aged advances)
//   - Hard deadline guardrail short-circuits when now() jumps past deadlineAt
//   - onTurn errors don't break the orchestrator
//
// Run from apps/web:
//   pnpm smoke:negotiation
//   node --experimental-strip-types scripts/smoke-negotiation.mts
//
// No env vars required — fully offline.

import {
  runNegotiation,
  type NegotiationArgs,
  type NegotiationBrand,
} from "../src/lib/agents/negotiation/index.ts";
import type {
  ManagerHint,
  MarketSignals,
} from "../src/lib/agents/streamer/types.ts";
import type {
  BrandValuation,
  DealTerms,
  NegotiationTurn,
  ZoneId,
} from "../src/lib/agents/types.ts";
import type { LoadedBrand } from "../src/lib/agents/brands/loader.ts";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass++;
  else fail++;
  console.log(
    `[${ok ? "OK  " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

// ─── Fixture builders ────────────────────────────────────────────────

function mkMarket(): MarketSignals {
  return {
    intensity_label: "epic",
    intensity_multiplier: 1.4,
    fair_value_usdc: {
      lower_third: 2.5,
      bottom_right_corner: 1.0,
      fullscreen_takeover: 6.0,
    },
    dynamic_reserve_usdc: {
      lower_third: 1.5,
      bottom_right_corner: 0.5,
      fullscreen_takeover: 3.0,
    },
    streamer_aspiration_usdc: {
      lower_third: 3.0,
      bottom_right_corner: 1.5,
      fullscreen_takeover: 8.0,
    },
  };
}

function mkManagerHint(): ManagerHint {
  return {
    intensity_label: "epic",
    recommended_zones: ["lower_third", "bottom_right_corner"],
    recommended_max_duration_s: 8,
    brand_safety_pre_flag: null,
    reason: "Momento épico — clutch a 30s del cierre.",
  };
}

function mkValuation(overrides?: Partial<BrandValuation>): BrandValuation {
  return {
    brand_fit_multiplier: 1.2,
    fit_reasons: ["[smoke] sintético"],
    perceived_value_usdc: 2.0,
    max_acceptable_usdc: 3.0,
    opening_factor: 0.7,
    opening_bid_usdc: 1.4,
    competitive_assumption: "2 competidor(es) en lower_third",
    ...overrides,
  };
}

function mkBrand(opts: {
  slug: string;
  bid_usdc: number;
  zone?: ZoneId;
  duration_s?: number;
  message?: string;
  available_balance_usdc?: number;
  always_bid_floor?: boolean;
}): NegotiationBrand {
  const zone = opts.zone ?? "lower_third";
  const terms: DealTerms = {
    bid_usdc: opts.bid_usdc,
    duration_s: opts.duration_s ?? 8,
    zone,
  };
  // Minimal LoadedBrand stub — orchestrator only reads payload.always_bid_floor
  // + display_name in MVP. Full shape kept partial via cast for smoke speed.
  const loaded = {
    slug: opts.slug,
    payload: {
      type: "brand" as const,
      account_id: opts.slug,
      display_name: opts.slug,
      brand_voice: "(smoke)",
      daily_cap_usdc: 100,
      spent_today_usdc: 0,
      min_bid_usdc: 0.2,
      max_bid_usdc: 5,
      targeting: { games: ["any"], moods: ["any"] },
      brand_safety: { blocked_keywords: [] },
      always_bid_floor: opts.always_bid_floor,
    },
    prompt: null,
    ext: {},
    ad_variants: [],
    description: "(smoke fixture)",
    match_keywords: [],
    ad: {},
    display: { tracking_url: "https://example.test/" },
  } as unknown as LoadedBrand;
  return {
    brand: loaded,
    account_id: opts.slug,
    opening_terms: terms,
    opening_message: opts.message ?? `${opts.slug}: opening en voz de la brand.`,
    valuation: mkValuation({ opening_bid_usdc: opts.bid_usdc }),
    available_balance_usdc: opts.available_balance_usdc ?? 50,
  };
}

function mkArgs(overrides: Partial<NegotiationArgs> = {}): NegotiationArgs {
  return {
    auction_id: overrides.auction_id ?? "test-auction-001",
    brands:
      overrides.brands ??
      [
        mkBrand({ slug: "cafetito", bid_usdc: 1.4 }),
        mkBrand({ slug: "termoflex", bid_usdc: 0.5, always_bid_floor: true }),
      ],
    market_signals: overrides.market_signals ?? mkMarket(),
    manager_hint: overrides.manager_hint ?? mkManagerHint(),
    cap_turns: overrides.cap_turns,
    deadline_ms: overrides.deadline_ms,
    now: overrides.now,
    onTurn: overrides.onTurn,
  };
}

// ─── Test N-01: happy path 1-turn ────────────────────────────────────

async function testHappyPath() {
  const result = await runNegotiation(mkArgs());

  check("N-01 transcript has 2 open turns", result.transcript.length === 2);
  check(
    "N-01 all turns action=open",
    result.transcript.every((t) => t.action === "open"),
  );
  check(
    "N-01 all turns from=brand",
    result.transcript.every((t) => t.from === "brand"),
  );
  check(
    "N-01 standings has 2 entries",
    result.standing_offers.length === 2,
  );
  check(
    "N-01 cafetito standing bid=1.4",
    result.standing_offers.find((s) => s.brand_id === "cafetito")?.terms
      .bid_usdc === 1.4,
  );
  check(
    "N-01 termoflex standing bid=0.5 (floor)",
    result.standing_offers.find((s) => s.brand_id === "termoflex")?.terms
      .bid_usdc === 0.5,
  );
  check(
    "N-01 no walked brands",
    result.standing_offers.every((s) => !s.walked),
  );
  check(
    "N-01 rounds_aged=0 in turn-1 path",
    result.standing_offers.every((s) => s.rounds_aged === 0),
  );
  check("N-01 metrics.total_turns=2", result.metrics.total_turns === 2);
  check("N-01 metrics.total_rounds=1", result.metrics.total_rounds === 1);
  check(
    "N-01 metrics.ac_overrides_fired=0",
    result.metrics.ac_overrides_fired === 0,
  );
  check("N-01 metrics.deadline_hit=false", result.metrics.deadline_hit === false);
  check("N-01 metrics.total_ms <1000", result.metrics.total_ms < 1000);
}

// ─── Test N-02: onTurn callback fires per turn ──────────────────────

async function testOnTurnCallback() {
  const seen: NegotiationTurn[] = [];
  await runNegotiation(
    mkArgs({
      onTurn: (turn) => {
        seen.push(turn);
      },
    }),
  );
  check("N-02 onTurn fired twice", seen.length === 2);
  check(
    "N-02 onTurn payload preserves brand_id",
    seen[0]?.brand_id === "cafetito" && seen[1]?.brand_id === "termoflex",
  );
  check(
    "N-02 onTurn payload carries terms",
    seen.every((t) => t.terms !== undefined),
  );
  check(
    "N-02 onTurn payload carries curve_target_usdc",
    seen.every((t) => typeof t.curve_target_usdc === "number"),
  );
}

// ─── Test N-03: opening_message + terms preserved verbatim ──────────

async function testOpeningPreserved() {
  const customMsg = "CafetITO: este clutch merece un cargado, ahora.";
  const brands = [
    mkBrand({
      slug: "cafetito",
      bid_usdc: 2.1,
      duration_s: 6,
      zone: "lower_third",
      message: customMsg,
    }),
  ];
  const result = await runNegotiation(mkArgs({ brands }));
  const standing = result.standing_offers[0]!;
  const turn = result.transcript[0]!;
  check("N-03 standing.message=opening_message", standing.message === customMsg);
  check("N-03 turn.message=opening_message", turn.message === customMsg);
  check("N-03 standing.terms.bid=2.1", standing.terms.bid_usdc === 2.1);
  check("N-03 standing.terms.duration=6", standing.terms.duration_s === 6);
  check("N-03 standing.terms.zone=lower_third", standing.terms.zone === "lower_third");
  check(
    "N-03 turn.curve_target=2.1 (audit field)",
    turn.curve_target_usdc === 2.1,
  );
}

// ─── Test N-04: cap_turns=2 → no-op concession ──────────────────────

async function testMultiTurnNoOp() {
  const result = await runNegotiation(mkArgs({ cap_turns: 2 }));
  check(
    "N-04 transcript still has only opens (no counters in MVP)",
    result.transcript.every((t) => t.action === "open"),
  );
  check("N-04 metrics.total_rounds=2", result.metrics.total_rounds === 2);
  check(
    "N-04 metrics.total_turns=2 (only opens)",
    result.metrics.total_turns === 2,
  );
  check(
    "N-04 standings.rounds_aged=1 after round 2",
    result.standing_offers.every((s) => s.rounds_aged === 1),
  );
  check("N-04 metrics.deadline_hit=false", result.metrics.deadline_hit === false);
}

// ─── Test N-05: deadline guardrail ──────────────────────────────────

async function testDeadlineGuardrail() {
  // Inject a clock that jumps past the deadline before round 1.
  let calls = 0;
  const fakeNow = () => {
    calls++;
    // First call (t0) returns 0; subsequent calls return 99999 (past deadline).
    return calls === 1 ? 0 : 99999;
  };
  const result = await runNegotiation(
    mkArgs({ cap_turns: 3, deadline_ms: 5000, now: fakeNow }),
  );
  check(
    "N-05 deadline_hit=true when clock jumps past deadlineAt",
    result.metrics.deadline_hit === true,
  );
  check(
    "N-05 stopped at round 1 (openings only)",
    result.metrics.total_rounds === 1,
  );
  check(
    "N-05 standings still emitted (round 0 always runs)",
    result.standing_offers.length === 2,
  );
}

// ─── Test N-06: onTurn error tolerance ──────────────────────────────

async function testOnTurnErrorTolerant() {
  let seen = 0;
  const result = await runNegotiation(
    mkArgs({
      onTurn: () => {
        seen++;
        throw new Error("[smoke] simulated broadcast failure");
      },
    }),
  );
  check(
    "N-06 onTurn called for every brand despite throws",
    seen === 2,
  );
  check(
    "N-06 result still emitted (orchestrator did not abort)",
    result.standing_offers.length === 2 && result.transcript.length === 2,
  );
}

// ─── Test N-07: empty brands array ──────────────────────────────────

async function testEmptyBrands() {
  const result = await runNegotiation(mkArgs({ brands: [] }));
  check("N-07 zero standings on empty input", result.standing_offers.length === 0);
  check("N-07 zero transcript on empty input", result.transcript.length === 0);
  check(
    "N-07 metrics.total_turns=0",
    result.metrics.total_turns === 0,
  );
  check(
    "N-07 metrics.total_rounds=1 (round 0 always counts)",
    result.metrics.total_rounds === 1,
  );
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("=== smoke:negotiation (C-10) ===");
  await testHappyPath();
  await testOnTurnCallback();
  await testOpeningPreserved();
  await testMultiTurnNoOp();
  await testDeadlineGuardrail();
  await testOnTurnErrorTolerant();
  await testEmptyBrands();

  console.log(`\n${pass} OK · ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(2);
});

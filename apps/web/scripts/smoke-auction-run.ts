// Smoke test for runAuction() — C-14.
//
// Exercises the auction core end-to-end against a synthetic ContextChunk +
// ManagerDecisionSummary, fully offline:
//   - dry_run=true → stub picker for hunts, stub streamer evaluator
//   - CHAIN_LIVE_TXS unset → kill-switch short-circuit (decision: lock_skipped_killswitch)
//   - no DB writes (resolveOnchainIds returns empty in dry_run)
//   - /render + /audit/clip fetches WILL fail (no server running) but their
//     errors are swallowed by .catch — the orchestrator must still return a
//     coherent AuctionResult.
//
// Run from apps/web:
//   pnpm smoke:auction-run
//   node --experimental-strip-types scripts/smoke-auction-run.mts
//
// No env vars required.

import { runAuction } from "../src/lib/auctions/runAuction.ts";
import { computeMarketSignals } from "../src/lib/auctions/marketSignals.ts";
import type { ContextChunk } from "../src/lib/manager/types.ts";
import type { ManagerDecisionSummary } from "../src/lib/agents/brand/huntForBrand.ts";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass++;
  else fail++;
  console.log(`[${ok ? "OK  " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function mkChunk(overrides: Partial<ContextChunk> = {}): ContextChunk {
  return {
    id: "00000000-0000-4000-8000-00000000beef",
    stream_key: "team-stream",
    stream_id: null,
    ts_start: new Date().toISOString(),
    duration_s: 30,
    audio_text:
      "che, tomate un cafetito antes del clutch. ¿Tenés mate listo? Vamos con todo.",
    audio_partial_at_end: null,
    audio_summary: "Creator hype talking about café and the next clutch round",
    audio_topics: ["clutch", "café"],
    audio_mentions: ["cafetito"],
    audio_intent: "reaction",
    scene_type: "Counter-Strike gameplay",
    energy_level: "epic",
    mood_tags: ["high_energy", "celebration"],
    on_screen_text: null,
    chat_velocity_avg: 12,
    chat_velocity_peak: 20,
    chat_recent_keywords: ["LET'S GO"],
    sentiment_avg: "hype",
    viewers: 8,
    viewers_delta_30s: 3,
    game_category: "esports",
    stream_title: "demo addie",
    ticks_aggregated: 6,
    frame_analyses_aggregated: 3,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function mkManagerDecision(): ManagerDecisionSummary {
  return {
    should_emit: true,
    moment_quality: 0.8,
    brand_match: 0.85,
    reason: "Clutch épico mencionando cafetito — momento alto-fit.",
  };
}

async function caseHappyPath() {
  const chunk = mkChunk();
  const md = mkManagerDecision();

  const result = await runAuction({
    tick: chunk,
    manager_decision: md,
    dry_run: true,
  });

  check("returns auction_id", typeof result.auction_id === "string" && result.auction_id.length > 0);
  check(
    "decision is one of {placed, lock_skipped_killswitch, walk, no_bidders}",
    ["placed", "lock_skipped_killswitch", "walk", "no_bidders"].includes(result.decision),
  );
  check(
    "hunt_summary populated",
    typeof result.hunt_summary.bid_count === "number" &&
      typeof result.hunt_summary.skip_count === "number" &&
      result.hunt_summary.total_ms >= 0,
  );
  check(
    "negotiation transcript matches bidders (1-turn MVP)",
    result.negotiation.total_turns >= 0 &&
      result.negotiation.transcript.every(
        (t) => t.from === "brand" || t.from === "streamer",
      ),
  );
  // With CHAIN_LIVE_TXS unset, lock should short-circuit. If we got bidders
  // and didn't walk, decision should be lock_skipped_killswitch.
  if (result.streamer_decision?.action === "accept") {
    check(
      "kill-switch path: decision = lock_skipped_killswitch",
      result.decision === "lock_skipped_killswitch",
      `got decision=${result.decision}`,
    );
    check(
      "placement.lock_tx_hash null under kill-switch",
      result.placement?.lock_tx_hash === null,
    );
    check(
      "placement.brand_slug populated",
      typeof result.placement?.brand_slug === "string" &&
        result.placement.brand_slug.length > 0,
    );
  }
}

async function caseNoBidders() {
  // Force a SKIP across all brands by giving a chunk with no audio + 0 viewers.
  const chunk = mkChunk({
    audio_text: "",
    audio_mentions: [],
    audio_topics: [],
    mood_tags: [],
    energy_level: "calm",
    audio_intent: "silence",
    viewers: 0,
  });
  const md: ManagerDecisionSummary = {
    should_emit: true,
    moment_quality: 0.1,
    brand_match: 0.1,
    reason: "Momento mundano, sin audio.",
  };

  const result = await runAuction({
    tick: chunk,
    manager_decision: md,
    dry_run: true,
  });

  // It might still bid — TermoFlex (always_bid_floor) bypasses gate3. Check
  // the *shape* but tolerate either path. The stub picker key-matches against
  // audio_text only; with empty audio + zero match_keywords, only default-bidder
  // brands should fire.
  check(
    "no-bidders or forced-floor path produces a coherent decision",
    ["no_bidders", "walk", "placed", "lock_skipped_killswitch", "lock_failed"].includes(
      result.decision,
    ),
    `decision=${result.decision} bid_count=${result.hunt_summary.bid_count}`,
  );
}

async function caseMarketSignalsShape() {
  const chunk = mkChunk();
  const signals = computeMarketSignals({
    tick: chunk,
    manager_decision: mkManagerDecision(),
  });
  check(
    "intensity_label = epic for energy=epic",
    signals.streamer.intensity_label === "epic",
  );
  check(
    "fair_value > dynamic_reserve per zone",
    signals.streamer.fair_value_usdc.lower_third >
      signals.streamer.dynamic_reserve_usdc.lower_third,
  );
  check(
    "hunt zone is lower_third for epic",
    signals.hunt.zone === "lower_third",
  );
  check(
    "manager_hint.recommended_zones starts with primary",
    signals.manager_hint.recommended_zones[0] === signals.hunt.zone,
  );
}

async function main() {
  console.log("=== smoke:auction-run (C-14) ===\n");

  console.log("\n[case] computeMarketSignals shape");
  await caseMarketSignalsShape();

  console.log("\n[case] happy path (cafetito-leaning chunk)");
  await caseHappyPath();

  console.log("\n[case] no-bidders / mundane chunk");
  await caseNoBidders();

  console.log(`\n${pass} pass · ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(2);
});

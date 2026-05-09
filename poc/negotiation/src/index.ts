import { huntForBrand } from "./brandAgent.js";
import { BRANDS } from "./brands.js";
import * as log from "./log.js";
import { runNegotiationRound } from "./orchestrator.js";
import { getScenario, SCENARIOS } from "./scenarios.js";
import { pickWinner } from "./streamerAgent.js";
import type { OpeningOffer } from "./types.js";
import { computeMarketSignals } from "./valuation.js";

function parseScenarioFlag(): string {
  const flag = process.argv.find((a) => a.startsWith("--scenario="));
  return flag ? flag.split("=")[1]! : "fifa_goal";
}

async function main() {
  const scenarioName = parseScenarioFlag();
  if (!SCENARIOS[scenarioName]) {
    console.error(`Unknown scenario "${scenarioName}". Available: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }
  const context = getScenario(scenarioName);
  const market = computeMarketSignals(context);

  log.banner(
    "ADDIE  ·  AGENT NEGOTIATION POC",
    `Scenario: ${scenarioName}  ·  ${BRANDS.length} brand-agents · 1 streamer-agent · single-ad-per-moment`,
  );

  // ---- PHASE 0: context broadcast + market signals ----
  log.section("PHASE 0 · CONTEXT TICK BROADCAST");
  log.note("Audio", `"${context.audio_30s}"`);
  log.note("Frame", context.frame_description);
  log.note("Game", context.game);
  log.note(
    "Chat",
    `${context.chat_velocity_msgs} msg/s  (baseline ${context.chat_baseline_msgs}, ${(context.chat_velocity_msgs / context.chat_baseline_msgs).toFixed(1)}× spike)`,
  );
  log.note("Sentiment", context.sentiment.toFixed(2));
  log.note("Viewers", context.viewers.toLocaleString());
  log.note("Mood", context.mood ?? "n/a");
  console.log("");
  log.marketSignalsBlock(market);
  await log.phasePause();

  // ---- PHASE 1: parallel hunt with valuation playbook ----
  log.section(`PHASE 1 · BRAND HUNT  (${BRANDS.length} parallel · CPM-based valuation)`);
  log.thinking("streamer", "(escuchando) — todos los brand-agents corren el playbook de valuación en paralelo…");

  const decisions = await Promise.all(
    BRANDS.map(async (b) => ({
      brand: b,
      decision: await huntForBrand(b, context, market),
    })),
  );

  const openings: OpeningOffer[] = [];
  for (const { brand, decision } of decisions) {
    if (decision.should_bid) {
      const t = decision.offer.terms;
      const adName = brand.ads.find((a) => a.id === decision.offer.ad_id)?.variant_name ?? decision.offer.ad_id;
      log.tickRow(
        brand.id,
        "BID",
        `$${t.bid_usdc.toFixed(2)} · ${t.zone} · ${t.duration_s}s · "${adName}"`,
      );
      log.valuationLine(brand.id, decision.offer.valuation);
      openings.push(decision.offer);
    } else {
      const fitNote = decision.brand_fit_multiplier !== undefined
        ? ` (fit ×${decision.brand_fit_multiplier.toFixed(2)})`
        : "";
      log.tickRow(brand.id, "SKIP", `${decision.reason}${fitNote}`);
    }
  }

  if (openings.length === 0) {
    log.section("END · NO BIDS");
    log.info("Ningún brand-agent decidió bidear este context tick.");
    return;
  }

  await log.phasePause();

  // ---- PHASE 2: multi-turn negotiation with playbook + valuation anchoring ----
  const closed = await runNegotiationRound(openings, market);

  // ---- PHASE 3: single-winner selection ----
  log.section("PHASE 3 · WINNER SELECTION  (single ad per moment — streamer picks ONE)");
  for (const c of closed) {
    if (c.accepted && c.terms) {
      log.dealRow(c.brand_id, c.terms, true);
    } else {
      log.info(`${c.brand_id}: closed without deal (${c.closing_action})`);
    }
  }

  await log.phasePause();
  const decision = await pickWinner(closed, market);

  log.section("RESULT · WINNING PLACEMENT");
  if (!decision.winner) {
    log.info("Ningún deal cerrado vale la pena correr. No placement este round.");
  } else {
    log.winnerRow(decision.winner.brand_id, decision.winner.terms, decision.winner.reason);
  }
  if (decision.rejected.length > 0) {
    console.log("");
    for (const r of decision.rejected) log.rejectedRow(r.brand_id, r.reason);
  }

  console.log("");
  log.info(`Revenue this round: $${decision.total_revenue_usdc.toFixed(2)} USDC`);
  log.info("(Settlement → AddieEscrow.lock() on Base — fuera del scope de este POC)");
  console.log("");
}

main().catch((err) => {
  console.error("\nERROR:", err);
  process.exit(1);
});

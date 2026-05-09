import { brandRespond } from "./brandAgent.js";
import { brandById } from "./brands.js";
import * as log from "./log.js";
import { streamerBatna } from "./negotiationMath.js";
import { streamerBatchReply } from "./streamerAgent.js";
import type {
  ClosedDeal,
  DealTerms,
  OpeningOffer,
  RoundMetrics,
  Turn,
  ValuationBreakdown,
} from "./types.js";
import type { MarketSignals } from "./valuation.js";

const MAX_TURNS = 3;
/** Total wall-clock budget for the negotiation phase (DESIGN.md §4 hard deadline). */
const NEGOTIATION_DEADLINE_S = 5;

type SessionState = {
  brand_id: string;
  history: Turn[];
  status: "open" | "closed";
  closing_action?: "accept" | "reject" | "walk" | "timeout";
  valuation?: ValuationBreakdown;
  rounds_to_close?: number;
};

export type RoundResult = {
  closed: ClosedDeal[];
  metrics: Pick<
    RoundMetrics,
    "closure_rate" | "avg_rounds_to_close" | "ac_overrides_fired" | "walks_due_to_walk_away" | "total_llm_calls"
  > & { brands_bid: number };
};

export async function runNegotiationRound(
  openings: OpeningOffer[],
  market: MarketSignals,
): Promise<RoundResult> {
  const startTs = Date.now();
  const sessions: SessionState[] = openings.map((o) => ({
    brand_id: o.brand_id,
    history: [
      {
        from: "brand",
        brand_id: o.brand_id,
        action: "open",
        message: o.message,
        terms: o.terms,
        ts_ms: 0,
      },
    ],
    status: "open",
    valuation: o.valuation,
  }));

  let total_llm_calls = 0;
  let ac_overrides_fired = 0;
  let walks_due_to_walk_away = 0;

  log.section("PHASE 2 · OPENING OFFERS  (parallel hunt → all brands open at once)");
  for (const s of sessions) {
    const open = s.history[0]!;
    await log.turnLine({
      from: s.brand_id,
      to: "streamer",
      action: "OPEN",
      message: open.message,
      terms: open.terms,
    });
  }

  for (let round = 1; round <= MAX_TURNS; round++) {
    const open = sessions.filter((s) => s.status === "open");
    if (open.length === 0) break;

    const elapsed = (Date.now() - startTs) / 1000;
    const seconds_remaining = Math.max(0, NEGOTIATION_DEADLINE_S - elapsed);
    const rounds_remaining = MAX_TURNS - round + 1;

    log.section(
      `PHASE 2 · NEGOTIATION ROUND ${round}/${MAX_TURNS}  (streamer batched, sees all · ⏰ ${seconds_remaining.toFixed(1)}s left)`,
    );
    log.thinking("streamer", `evaluando ${open.length} negociaciones con curva + BATNA por sesión…`);

    // BATNA per session: highest competing brand's last bid (excluding focal).
    const batnaByBrand = new Map<string, number>();
    for (const s of open) {
      const others = open
        .filter((o) => o.brand_id !== s.brand_id)
        .map((o) => lastBrandBid(o.history))
        .filter((x): x is number => x !== undefined);
      const focalZone = lastTermsFromSide(s.history, "brand")?.zone;
      const floor = focalZone ? market.dynamic_reserve_usdc[focalZone] : 0;
      batnaByBrand.set(s.brand_id, streamerBatna({ other_active_offers_usdc: others, floor_usdc: floor }));
    }

    const { replies, round_strategy } = await streamerBatchReply({
      active_negotiations: open.map((s) => ({ brand_id: s.brand_id, history: s.history })),
      market,
      round_index: round,
      max_rounds: MAX_TURNS,
      rounds_remaining,
      seconds_remaining,
      batna_by_brand: batnaByBrand,
    });
    total_llm_calls += 1; // streamer batched call
    log.strategyLine(round_strategy);

    for (const s of open) {
      const reply = replies.get(s.brand_id);
      if (!reply) {
        s.history.push({
          from: "streamer",
          brand_id: s.brand_id,
          action: "reject",
          message: "(sin respuesta del streamer)",
          ts_ms: Date.now() - startTs,
        });
        s.status = "closed";
        s.closing_action = "reject";
        s.rounds_to_close = round;
        await log.turnLine({
          from: "streamer",
          to: s.brand_id,
          action: "REJECT",
          message: "(sin respuesta del streamer)",
        });
        continue;
      }

      if (reply.override) ac_overrides_fired++;

      s.history.push({
        from: "streamer",
        brand_id: s.brand_id,
        action: reply.action,
        message: reply.message,
        terms: reply.counter_terms,
        ts_ms: Date.now() - startTs,
        curve_target_usdc: reply.curve_target_usdc,
        override: reply.override,
      });
      await log.turnLine({
        from: "streamer",
        to: s.brand_id,
        action: reply.action.toUpperCase(),
        message: reply.message,
        terms: reply.counter_terms ?? lastTermsFromSide(s.history, "brand"),
        tactic: reply.tactic,
        curve_target_usdc: reply.curve_target_usdc,
        override: reply.override,
      });
      if (reply.action === "accept" || reply.action === "reject") {
        s.status = "closed";
        s.closing_action = reply.action;
        s.rounds_to_close = round;
      }
    }

    const stillOpen = sessions.filter((s) => s.status === "open");
    if (stillOpen.length === 0) break;

    const elapsedB = (Date.now() - startTs) / 1000;
    const seconds_remaining_b = Math.max(0, NEGOTIATION_DEADLINE_S - elapsedB);
    log.thinking("streamer", `esperando respuesta de ${stillOpen.length} brands… (⏰ ${seconds_remaining_b.toFixed(1)}s)`);
    await log.phasePause();

    const brandResponses = await Promise.all(
      stillOpen.map(async (s) => {
        const brand = brandById(s.brand_id);
        const resp = await brandRespond({
          brand,
          history: s.history,
          market,
          myValuation: s.valuation,
          round_index: round,
          max_rounds: MAX_TURNS,
          rounds_remaining,
          seconds_remaining: seconds_remaining_b,
        });
        return { session: s, resp };
      }),
    );
    total_llm_calls += brandResponses.length;

    for (const { session: s, resp } of brandResponses) {
      if (resp.override) ac_overrides_fired++;
      if (resp.action === "walk" && resp.message.includes("max_acceptable")) walks_due_to_walk_away++;

      s.history.push({
        from: "brand",
        brand_id: s.brand_id,
        action: resp.action,
        message: resp.message,
        terms: resp.counter_terms ?? lastTermsFromSide(s.history, "streamer"),
        ts_ms: Date.now() - startTs,
        curve_target_usdc: resp.curve_target_usdc,
        override: resp.override,
      });
      await log.turnLine({
        from: s.brand_id,
        to: "streamer",
        action: resp.action.toUpperCase(),
        message: resp.message,
        terms: resp.counter_terms ?? lastTermsFromSide(s.history, "streamer"),
        curve_target_usdc: resp.curve_target_usdc,
        override: resp.override,
      });
      if (resp.action === "accept" || resp.action === "walk") {
        s.status = "closed";
        s.closing_action = resp.action;
        s.rounds_to_close = round;
      }
    }
  }

  for (const s of sessions) {
    if (s.status === "open") {
      s.status = "closed";
      s.closing_action = "timeout";
    }
  }

  const closed = sessions.map((s) => sessionToClosed(s));
  const closedDeals = closed.filter((c) => c.accepted).length;
  const closeRounds = sessions
    .filter((s) => s.rounds_to_close !== undefined)
    .map((s) => s.rounds_to_close!);

  return {
    closed,
    metrics: {
      brands_bid: openings.length,
      closure_rate: openings.length > 0 ? closedDeals / openings.length : 0,
      avg_rounds_to_close: closeRounds.length > 0 ? closeRounds.reduce((a, b) => a + b, 0) / closeRounds.length : 0,
      total_llm_calls,
      ac_overrides_fired,
      walks_due_to_walk_away,
    },
  };
}

function lastBrandBid(history: Turn[]): number | undefined {
  return lastTermsFromSide(history, "brand")?.bid_usdc;
}

function lastTermsFromSide(history: Turn[], side: "brand" | "streamer"): DealTerms | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    if (t.from === side && t.terms) return t.terms;
  }
  return undefined;
}

function sessionToClosed(s: SessionState): ClosedDeal {
  const accepted = s.closing_action === "accept" && s.history.length > 0;
  let finalTerms = undefined;
  if (accepted) {
    const last = s.history[s.history.length - 1]!;
    if (last.from === "streamer" && last.action === "accept") {
      finalTerms = lastTermsFromSide(s.history, "brand");
    } else if (last.from === "brand" && last.action === "accept") {
      finalTerms = lastTermsFromSide(s.history, "streamer") ?? lastTermsFromSide(s.history, "brand");
    }
  }
  return {
    brand_id: s.brand_id,
    accepted: !!accepted && !!finalTerms,
    terms: finalTerms,
    history: s.history,
    closing_action: (s.closing_action ?? "timeout") as ClosedDeal["closing_action"],
  };
}

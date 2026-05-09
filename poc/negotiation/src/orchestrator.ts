import { brandRespond } from "./brandAgent.js";
import { brandById } from "./brands.js";
import * as log from "./log.js";
import { streamerBatchReply } from "./streamerAgent.js";
import type { ClosedDeal, OpeningOffer, Turn, ValuationBreakdown } from "./types.js";
import type { MarketSignals } from "./valuation.js";

const MAX_TURNS = 3;

type SessionState = {
  brand_id: string;
  history: Turn[];
  status: "open" | "closed";
  closing_action?: "accept" | "reject" | "walk" | "timeout";
  /** Brand's hunt-phase valuation, anchors walk-away in subsequent turns. */
  valuation?: ValuationBreakdown;
};

export async function runNegotiationRound(
  openings: OpeningOffer[],
  market: MarketSignals,
): Promise<ClosedDeal[]> {
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

    log.section(`PHASE 2 · NEGOTIATION ROUND ${round}  (streamer-agent batched reply, sees all)`);
    log.thinking("streamer", `evaluando ${open.length} negociaciones en paralelo…`);

    const { replies, round_strategy } = await streamerBatchReply(
      open.map((s) => ({ brand_id: s.brand_id, history: s.history })),
      market,
    );

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
        await log.turnLine({
          from: "streamer",
          to: s.brand_id,
          action: "REJECT",
          message: "(sin respuesta del streamer)",
        });
        continue;
      }
      s.history.push({
        from: "streamer",
        brand_id: s.brand_id,
        action: reply.action,
        message: reply.message,
        terms: reply.counter_terms,
        ts_ms: Date.now() - startTs,
      });
      await log.turnLine({
        from: "streamer",
        to: s.brand_id,
        action: reply.action.toUpperCase(),
        message: reply.message,
        terms: reply.counter_terms ?? lastBrandTerms(s.history),
        tactic: reply.tactic,
      });
      if (reply.action === "accept" || reply.action === "reject") {
        s.status = "closed";
        s.closing_action = reply.action;
      }
    }

    const stillOpen = sessions.filter((s) => s.status === "open");
    if (stillOpen.length === 0) break;

    log.thinking("streamer", `esperando respuesta de ${stillOpen.length} brands…`);
    await log.phasePause();

    const brandResponses = await Promise.all(
      stillOpen.map(async (s) => {
        const brand = brandById(s.brand_id);
        const resp = await brandRespond(brand, s.history, market, s.valuation);
        return { session: s, resp };
      }),
    );

    for (const { session: s, resp } of brandResponses) {
      s.history.push({
        from: "brand",
        brand_id: s.brand_id,
        action: resp.action,
        message: resp.message,
        terms: resp.counter_terms ?? lastStreamerTerms(s.history),
        ts_ms: Date.now() - startTs,
      });
      await log.turnLine({
        from: s.brand_id,
        to: "streamer",
        action: resp.action.toUpperCase(),
        message: resp.message,
        terms: resp.counter_terms ?? lastStreamerTerms(s.history),
      });
      if (resp.action === "accept" || resp.action === "walk") {
        s.status = "closed";
        s.closing_action = resp.action;
      }
    }
  }

  for (const s of sessions) {
    if (s.status === "open") {
      s.status = "closed";
      s.closing_action = "timeout";
    }
  }

  return sessions.map((s) => sessionToClosed(s));
}

function lastBrandTerms(history: Turn[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    if (t.from === "brand" && t.terms) return t.terms;
  }
  return undefined;
}

function lastStreamerTerms(history: Turn[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    if (t.from === "streamer" && t.terms) return t.terms;
  }
  return undefined;
}

function sessionToClosed(s: SessionState): ClosedDeal {
  const accepted = s.closing_action === "accept" && s.history.length > 0;
  let finalTerms = undefined;
  if (accepted) {
    const last = s.history[s.history.length - 1]!;
    if (last.from === "streamer" && last.action === "accept") {
      finalTerms = lastBrandTerms(s.history);
    } else if (last.from === "brand" && last.action === "accept") {
      finalTerms = lastStreamerTerms(s.history) ?? lastBrandTerms(s.history);
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

/**
 * Streamer-agent runner — single-shot at auction deadline T+5s (C-09).
 *
 * Called once by the negotiation orchestrator (C-10) when brand standing
 * offers have settled. Picks one winner with audit-friendly reasoning, or
 * walks if nothing cleared the per-zone dynamic reserve.
 *
 * Mirrors the `pickBrand` pattern (C-08m): Claude evaluator + stub
 * evaluator (no API key), lazy SDK import so harness flows boot fast.
 */

// Type-only import — runtime require deferred so MANAGER_DRY_RUN flows
// (and the harness) can run without @anthropic-ai/sdk installed locally.
import type Anthropic from "@anthropic-ai/sdk";

import type {
  AccountId,
  NegotiationTurn,
  StandingOffer,
  ZoneId,
} from "../types.ts";
import type {
  MarketSignals,
  StreamerDecision,
  StreamerInput,
  ZoneAmounts,
} from "./types.ts";

// ─── Public API ──────────────────────────────────────────────────────

export type StreamerEvaluator = (input: StreamerInput) => Promise<StreamerDecision>;

const TOOL_NAME = "emit_streamer_decision";

export function makeClaudeStreamerEvaluator(
  apiKey: string,
  model = "claude-sonnet-4-6",
): StreamerEvaluator {
  let clientPromise: Promise<Anthropic> | null = null;

  return async function streamerEvaluate(input) {
    const t0 = Date.now();

    const eligible = filterEligibleStandings(input.standing_offers);
    if (eligible.length === 0) {
      return walkNoBidders(input);
    }

    if (!clientPromise) {
      clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey }),
      );
    }
    const client = await clientPromise;

    const systemPrompt = buildSystemPrompt();
    const userPrompt = renderPrompt(input, eligible);
    const tool = buildTool(eligible);

    const response = await client.messages.create({
      model,
      max_tokens: 400,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) throw new Error("Streamer LLM did not call the tool");

    const raw = toolUse.input as RawDecision;
    const decision = applyRpOverrideGate(
      buildDecisionFromRaw(raw, eligible, input),
      input,
    );

    console.log(
      JSON.stringify({
        tag: "streamer:ai_timing",
        model,
        total_ms: Date.now() - t0,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        action: decision.action,
        winner: decision.winner_brand_id ?? null,
        revenue: decision.total_revenue_usdc,
        override_fired: Boolean(decision.override),
      }),
    );

    return decision;
  };
}

/**
 * Stub evaluator — deterministic rules for MANAGER_DRY_RUN flows + tests.
 * Picks max-revenue standing that clears `dynamic_reserve_usdc[zone]`.
 * Tie-break by `creator_mandate.preferred_brands` order, then by zone
 * matching `manager_hint.recommended_zones`.
 */
export function makeStubStreamerEvaluator(): StreamerEvaluator {
  return async function streamerEvaluate(input) {
    const eligible = filterEligibleStandings(input.standing_offers);
    if (eligible.length === 0) {
      return walkNoBidders(input);
    }

    const cleared = eligible.filter(
      (s) => s.terms.bid_usdc >= reserveForZone(input.market_signals, s.terms.zone),
    );
    if (cleared.length === 0) {
      return {
        action: "walk",
        reason: "[DRY_RUN] ninguna oferta superó el reserve dinámico",
        rejected: eligible.map((s) => ({
          brand_id: s.brand_id,
          reason: `bid ${s.terms.bid_usdc} < reserve ${reserveForZone(input.market_signals, s.terms.zone)}`,
        })),
        total_revenue_usdc: 0,
      };
    }

    cleared.sort((a, b) => compareStandings(a, b, input));
    const winner = cleared[0]!;
    const rejected = eligible
      .filter((s) => s.brand_id !== winner.brand_id)
      .map((s) => ({
        brand_id: s.brand_id,
        reason:
          s === winner
            ? "(winner)"
            : s.terms.bid_usdc < reserveForZone(input.market_signals, s.terms.zone)
              ? "bid bajo reserve dinámico"
              : "ofertado por debajo del ganador",
      }));

    return {
      action: "accept",
      winner_brand_id: winner.brand_id,
      terms: winner.terms,
      reason: `[DRY_RUN] gana ${winner.brand_id} con ${winner.terms.bid_usdc} USDC en ${winner.terms.zone}`,
      rejected,
      total_revenue_usdc: winner.terms.bid_usdc,
    };
  };
}

// ─── Helpers exported for the orchestrator (C-10) + demo display ─────

/**
 * Build a /demo-display-ready NegotiationTurn from a streamer decision.
 *
 * On accept the turn is attributed to `winner_brand_id`. On walk, since
 * `NegotiationTurn` requires a `brand_id`, callers pass `fallback_brand_id`
 * (typically the highest bidder that still failed RP) so the chat row has
 * a coherent counterparty.
 */
export function decisionToTurn(
  decision: StreamerDecision,
  ts_ms: number,
  fallback_brand_id: AccountId,
): NegotiationTurn {
  const brand_id =
    decision.action === "accept" ? decision.winner_brand_id! : fallback_brand_id;
  return {
    from: "streamer",
    brand_id,
    action: decision.action === "accept" ? "accept" : "walk",
    message: decision.reason,
    terms: decision.terms,
    ts_ms,
    override: decision.override,
  };
}

// ─── Internals ───────────────────────────────────────────────────────

type RawDecision = {
  action: "accept" | "walk";
  winner_brand_id: string | null;
  reason: string;
  rejected: { brand_id: string; reason: string }[];
};

function filterEligibleStandings(offers: StandingOffer[]): StandingOffer[] {
  return offers.filter((s) => !s.walked);
}

function walkNoBidders(input: StreamerInput): StreamerDecision {
  return {
    action: "walk",
    reason: "Ningún brand mantuvo oferta vigente al deadline.",
    rejected: input.standing_offers
      .filter((s) => s.walked)
      .map((s) => ({ brand_id: s.brand_id, reason: "walked" })),
    total_revenue_usdc: 0,
  };
}

function reserveForZone(market: MarketSignals, zone: ZoneId): number {
  return market.dynamic_reserve_usdc[zone];
}

/**
 * Tie-break order applied AFTER both standings cleared their reserve.
 * Lower return value wins.
 */
function compareStandings(
  a: StandingOffer,
  b: StandingOffer,
  input: StreamerInput,
): number {
  if (a.terms.bid_usdc !== b.terms.bid_usdc) return b.terms.bid_usdc - a.terms.bid_usdc;
  const prefRank = (id: AccountId) => {
    const idx = input.creator_mandate.preferred_brands.indexOf(id);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const rankDiff = prefRank(a.brand_id) - prefRank(b.brand_id);
  if (rankDiff !== 0) return rankDiff;
  const zoneRank = (z: ZoneId) => {
    const idx = input.manager_hint.recommended_zones.indexOf(z);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return zoneRank(a.terms.zone) - zoneRank(b.terms.zone);
}

function buildDecisionFromRaw(
  raw: RawDecision,
  eligible: StandingOffer[],
  input: StreamerInput,
): StreamerDecision {
  const rejected = (raw.rejected ?? []).map((r) => ({
    brand_id: r.brand_id as AccountId,
    reason: String(r.reason ?? "n/a"),
  }));

  if (raw.action === "walk" || !raw.winner_brand_id) {
    return {
      action: "walk",
      reason: String(raw.reason ?? "walk"),
      rejected,
      total_revenue_usdc: 0,
    };
  }

  const winner = eligible.find((s) => s.brand_id === raw.winner_brand_id);
  if (!winner) {
    return {
      action: "walk",
      reason: `LLM nombró ${raw.winner_brand_id}, no está en standing offers`,
      rejected,
      total_revenue_usdc: 0,
      override: {
        from_action: "accept",
        rule: "AC_const",
        reason: "winner_brand_id desconocido",
      },
    };
  }

  return {
    action: "accept",
    winner_brand_id: winner.brand_id,
    terms: winner.terms,
    reason: String(raw.reason ?? "accept"),
    rejected,
    total_revenue_usdc: winner.terms.bid_usdc,
  };
}

/**
 * Reservation-Price gate (Faratin–Sierra–Jennings AC_const). Catches the
 * case where the LLM accepts a standing offer that's actually below the
 * market's dynamic reserve for that zone — overrides to walk + audit row.
 */
function applyRpOverrideGate(
  decision: StreamerDecision,
  input: StreamerInput,
): StreamerDecision {
  if (decision.action !== "accept" || !decision.terms) return decision;
  const reserve = reserveForZone(input.market_signals, decision.terms.zone);
  if (decision.terms.bid_usdc >= reserve) return decision;
  return {
    action: "walk",
    reason: `RP gate: ${decision.terms.bid_usdc} USDC < reserve ${reserve} en ${decision.terms.zone}`,
    rejected: [
      ...decision.rejected,
      {
        brand_id: decision.winner_brand_id!,
        reason: `RP gate fired (was about to accept under reserve)`,
      },
    ],
    total_revenue_usdc: 0,
    override: {
      from_action: "accept",
      rule: "AC_const",
      reason: `LLM tried to accept ${decision.terms.bid_usdc} below dynamic_reserve ${reserve} for ${decision.terms.zone}`,
    },
  };
}

// ─── Prompt rendering ────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `Sos el agent del creator en Addie. Te llaman UNA SOLA vez al cierre de cada subasta (T+5s) con la lista de standing offers de los brands. Tu trabajo: pickear UNA oferta o caminar.

Criterios (en orden):
1. RESERVE — nunca aceptes una oferta cuyo bid esté por debajo del dynamic_reserve_usdc de su zona. Si todas están bajo, walk.
2. REVENUE — entre las que pasan reserve, preferí la de mayor bid_usdc.
3. FIT — ante empates de revenue, preferí brands en preferred_brands del mandate y zonas en recommended_zones del manager hint.
4. CONTEXTO — usá manager_hint.intensity_label + reason para tu mensaje en español.

Reglas duras:
- NO contraofertes. NO modifiques los terms. Solo accept con los terms del brand ganador, o walk.
- reason: español, ≤25 palabras, voz del creator (informal, segunda persona singular). Tono "going once, going twice, sold".
- rejected: lista cada brand_id que NO ganó con una razón corta (1 frase).

Llamá la tool ${TOOL_NAME} con tu output. Recordá: si dudás, walk es seguro — el sistema no se rompe sin placement.`;
}

function buildTool(eligible: StandingOffer[]): Anthropic.Tool {
  const brandIds = eligible.map((s) => s.brand_id).join("/");
  return {
    name: TOOL_NAME,
    description:
      "Emite la decisión final del streamer-agent: accept con un winner brand o walk.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["accept", "walk"],
        },
        winner_brand_id: {
          type: ["string", "null"],
          description: `brand_id del ganador si action=accept. Debe ser uno de: ${brandIds}. null si walk.`,
        },
        reason: {
          type: "string",
          description: "Español, ≤25 palabras, voz del creator. Audit + display.",
        },
        rejected: {
          type: "array",
          items: {
            type: "object",
            properties: {
              brand_id: { type: "string" },
              reason: { type: "string" },
            },
            required: ["brand_id", "reason"],
          },
        },
      },
      required: ["action", "winner_brand_id", "reason", "rejected"],
    },
  };
}

function renderPrompt(input: StreamerInput, eligible: StandingOffer[]): string {
  const m = input.market_signals;
  const cm = input.creator_mandate;
  const mh = input.manager_hint;
  const safetyFlag = mh.brand_safety_pre_flag
    ? `⚠ pre-flag de brand-safety del manager: "${mh.brand_safety_pre_flag}"`
    : "(sin pre-flags de brand-safety)";

  return [
    `## CONTEXTO DEL MOMENTO`,
    `- intensity: ${mh.intensity_label} (multiplier ${m.intensity_multiplier.toFixed(2)})`,
    `- recommended_zones: [${mh.recommended_zones.join(", ")}]`,
    `- recommended_max_duration_s: ${mh.recommended_max_duration_s}`,
    `- manager.reason: ${mh.reason}`,
    `- ${safetyFlag}`,
    "",
    `## MARKET SIGNALS (USDC)`,
    `${formatZoneTable(m)}`,
    "",
    `## CREATOR MANDATE`,
    `- display_name: ${cm.display_name}`,
    `- hard_floor_usdc: ${cm.hard_floor_usdc}`,
    `- preferred_brands: [${cm.preferred_brands.join(", ") || "(none)"}]`,
    `- blocked_keywords: [${cm.blocked_keywords.slice(0, 8).join(", ") || "(none)"}]`,
    "",
    `## STANDING OFFERS AL DEADLINE (${eligible.length})`,
    ...eligible.map(
      (s) =>
        `- ${s.brand_id}: ${s.terms.bid_usdc} USDC · ${s.terms.zone} · ${s.terms.duration_s}s${
          s.terms.exclusivity_s ? ` · excl ${s.terms.exclusivity_s}s` : ""
        }\n  msg: "${s.message}"`,
    ),
    "",
    `Llamá la tool ${TOOL_NAME} ahora. Recordá: bajo dynamic_reserve = walk, sin excepciones.`,
  ].join("\n");
}

function formatZoneTable(m: MarketSignals): string {
  const zones: ZoneId[] = ["lower_third", "bottom_right_corner", "fullscreen_takeover"];
  const rows = zones.map((z) => {
    const fv = (m.fair_value_usdc as ZoneAmounts)[z];
    const dr = (m.dynamic_reserve_usdc as ZoneAmounts)[z];
    const sa = (m.streamer_aspiration_usdc as ZoneAmounts)[z];
    return `- ${z}: fair_value ${fv} · dynamic_reserve ${dr} · aspiration ${sa}`;
  });
  return rows.join("\n");
}

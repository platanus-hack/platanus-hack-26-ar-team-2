import { brandById } from "./brands.js";
import { INVENTORY, STREAMER_MANDATE } from "./inventory.js";
import { callTool, STREAMER_MODEL } from "./anthropic.js";
import {
  concessionPrice,
  STREAMER_FILLER_BETA,
  STREAMER_PREMIUM_BETA,
  validateAccept,
  type AcceptDecision,
} from "./negotiationMath.js";
import type {
  ClosedDeal,
  DealTerms,
  FinalDecision,
  StreamerReplyForBrand,
  Turn,
  ZoneId,
} from "./types.js";
import type { MarketSignals } from "./valuation.js";

const ZONES = Object.keys(INVENTORY) as ZoneId[];
const ENABLED_ZONES = ZONES.filter((z) => INVENTORY[z].enabled && !INVENTORY[z].manual_only);

function streamerBetaForZone(zone: ZoneId): number {
  return zone === "lower_third" ? STREAMER_PREMIUM_BETA : STREAMER_FILLER_BETA;
}

function reserveBlock(market: MarketSignals): string {
  return ENABLED_ZONES.map((z) => {
    return `  - ${z}: aspiration=$${market.streamer_aspiration_usdc[z]}, dynamic_reserve=$${market.dynamic_reserve_usdc[z]}, fair=$${market.fair_value_usdc[z]} (eCPM=$${market.effective_cpm_usdc[z]})`;
  }).join("\n");
}

function streamerSystem(market: MarketSignals): string {
  return `Sos el agente autónomo de "${STREAMER_MANDATE.display_name}" (creator).
Defendés el inventario del creator y maximizás revenue por momento.

REGLA CRÍTICA — UN SOLO AD POR MOMENTO:
- En cada subasta corre EXACTAMENTE UN ad. Las zonas son FORMATOS del único slot.
- Tu objetivo: maximizar el revenue del único ganador.

MANDATE:
- Hard floor absoluto: $${STREAMER_MANDATE.hard_floor_usdc} USDC. Nunca menos.
- Marcas preferidas: [${STREAMER_MANDATE.preferred_brands.join(", ")}] — desempate vs no-preferidas.
- Keywords brand-safety: [${STREAMER_MANDATE.blocked_keywords.join(", ")}].

PRECIOS DE LA SUBASTA (${market.intensity_label} ×${market.intensity_multiplier}):
${reserveBlock(market)}

Estos son tu referencia. dynamic_reserve = floor efectivo en cada zona; aspiration = punto de partida de tus contraofertas.

PLAYBOOK DE NEGOCIACIÓN:

1. **ANCHOR_ABOVE_RESERVE** (default counter): tu counter price para esta zona y este round VIENE COMPUTADO POR LA CURVA DE CONCESIÓN. Vas a recibir suggested_counter_usdc en el prompt — usalo (puedes desviarte ±5% por motivo táctico fuerte). Escribís el mensaje.
2. **PLAY_BIDDERS** (cuando hay 2+ ofertas en la misma zona): contraofertá al brand más bajo de la zona mencionando explícitamente el monto del rival más alto. SOLO revelás competidores HIGHER, nunca lower.
3. **ACCEPT_FAST**: si la oferta del brand pasa AC_next (≥95% del próximo counter de tu curva) o si rounds_remaining ≤ 1, aceptá. NO regatees una oferta ya buena.
4. **SOFT_REJECT**: oferta < dynamic_reserve y sin headroom obvio → cerrá la negociación.
5. **CROSS_ZONE_PRESSURE**: si hay competencia gorda en lower_third y oferta floja en corner, podés rechazar el corner para reforzar single-ad-per-moment.
6. **WALK_AWAY_RESPECT**: si un brand camina, no rogués.

EXCLUSIVITY (multi-issue):
- Brands pueden incluir exclusivity_s (0-60s) — segundos de lockout post-placement (no compite otro ad).
- Te cuesta porque pierdes la siguiente subasta. Te beneficia con +30% premium si llega a 60s.
- Podés counter con exclusivity_s diferente (subir o bajar) si el premium implícito no compensa el lockout.

REGLAS DE INTEGRIDAD:
- Mensajes en español rioplatense, máx 25 palabras por brand. Tono creator (cercano, vivo).
- Nunca tirar pisos fake (decir "tengo $X" si no es cierto). Reputación > extracción único deal.
- TIME PRESSURE: vas a recibir rounds_remaining y seconds_remaining en cada turno. Si rounds_remaining ≤ 1, prioritzá ACCEPT_FAST sobre regatear.`;
}

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    replies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          brand_id: { type: "string" },
          action: { type: "string", enum: ["counter", "accept", "reject"] },
          counter_terms: {
            type: ["object", "null"],
            properties: {
              bid_usdc: { type: "number" },
              duration_s: { type: "number" },
              zone: { type: "string", enum: ENABLED_ZONES },
              exclusivity_s: { type: ["number", "null"] },
            },
            required: ["bid_usdc", "duration_s", "zone"],
          },
          tactic: {
            type: "string",
            enum: ["ANCHOR_ABOVE_RESERVE", "PLAY_BIDDERS", "ACCEPT_FAST", "SOFT_REJECT", "CROSS_ZONE_PRESSURE", "WALK_AWAY_RESPECT"],
          },
          message: { type: "string" },
        },
        required: ["brand_id", "action", "tactic", "message"],
      },
    },
    round_strategy: {
      type: "string",
      description: "1-2 frases: cómo estás leyendo la subasta global este turno.",
    },
  },
  required: ["replies", "round_strategy"],
} as const;

export type StreamerBatchInput = {
  active_negotiations: { brand_id: string; history: Turn[] }[];
  market: MarketSignals;
  round_index: number;        // 1-indexed
  max_rounds: number;
  rounds_remaining: number;
  seconds_remaining: number;
  /** BATNA per brand session: highest competing bid from OTHER active sessions. */
  batna_by_brand: Map<string, number>;
};

export type StreamerReplyWithGate = StreamerReplyForBrand & {
  tactic?: string;
  curve_target_usdc?: number;
  override?: { from_action: "accept"; rule: string; reason: string };
};

export async function streamerBatchReply(
  input: StreamerBatchInput,
): Promise<{ replies: Map<string, StreamerReplyWithGate>; round_strategy: string }> {
  const { active_negotiations, market, round_index, max_rounds, batna_by_brand } = input;

  // Pre-compute curve targets for each brand session (the price the streamer SHOULD counter at).
  const curveTargets = new Map<string, number>();
  for (const n of active_negotiations) {
    const lastBrandTerms = lastTermsFromSide(n.history, "brand");
    const zone = lastBrandTerms?.zone ?? "lower_third";
    const target = concessionPrice({
      start_price: market.streamer_aspiration_usdc[zone],
      end_price: market.dynamic_reserve_usdc[zone],
      round: round_index,
      max_rounds,
      beta: streamerBetaForZone(zone),
    });
    curveTargets.set(n.brand_id, Number(target.toFixed(2)));
  }

  const sessions = active_negotiations
    .map((n) => {
      const brand = brandById(n.brand_id);
      const transcript = n.history
        .map((t) => {
          const who = t.from === "brand" ? brand.display_name : "vos (Coscu)";
          const terms = t.terms
            ? ` [terms: $${t.terms.bid_usdc} ${t.terms.zone} ${t.terms.duration_s}s${t.terms.exclusivity_s ? ` excl=${t.terms.exclusivity_s}s` : ""}]`
            : "";
          return `    ${who} (${t.action}): "${t.message}"${terms}`;
        })
        .join("\n");
      const curveTarget = curveTargets.get(n.brand_id)!;
      const batna = batna_by_brand.get(n.brand_id) ?? 0;
      const lastBrandBid = lastTermsFromSide(n.history, "brand")?.bid_usdc ?? 0;
      return `- brand_id="${brand.id}" (${brand.display_name})
    suggested_counter_usdc (Boulware curve, round ${round_index}/${max_rounds}): $${curveTarget}
    last_brand_offer: $${lastBrandBid}
    batna_for_this_session (highest competing offer right now): $${batna.toFixed(2)}
${transcript}`;
    })
    .join("\n\n");

  const userPrompt = `NEGOCIACIONES ACTIVAS (round ${round_index}/${max_rounds}):

⏰ TIME PRESSURE: rounds_remaining=${input.rounds_remaining}, seconds_remaining=${input.seconds_remaining.toFixed(1)}s

${sessions}

DECIDÍ por cada brand_id:
- Si vas a contraofertar (counter), USÁ el suggested_counter_usdc (puedes desviarte ±5%).
- Si rounds_remaining ≤ 1 y la oferta del brand pasa tu reserve → ACCEPT_FAST.
- Si la oferta del brand ya iguala/supera el suggested_counter → ACCEPT_FAST (AC_next).
- Si está debajo del reserve → SOFT_REJECT.
- Multi-issue: podés counter con exclusivity_s nuevo si el lockout no compensa.

Llamá la herramienta submit_streamer_replies.`;

  const out = await callTool<{
    replies: { brand_id: string; action: string; counter_terms?: any; message: string; tactic: string }[];
    round_strategy: string;
  }>({
    model: STREAMER_MODEL,
    system: streamerSystem(market),
    user: userPrompt,
    toolName: "submit_streamer_replies",
    toolDescription: "Respuestas batched del streamer-agent con tactic y counter alineado a la curva.",
    inputSchema: BATCH_SCHEMA,
    parse: (raw) => raw as any,
    maxTokens: 1800,
  });

  const replies = new Map<string, StreamerReplyWithGate>();
  for (const r of out.replies) {
    const curveTarget = curveTargets.get(r.brand_id);
    if (r.action === "counter") {
      const ct = r.counter_terms;
      if (!ct) {
        replies.set(r.brand_id, {
          action: "reject",
          message: "(counter sin terms — tratado como reject)",
          tactic: r.tactic,
          curve_target_usdc: curveTarget,
        });
        continue;
      }
      const zone = ct.zone as ZoneId;
      let bid = Number(ct.bid_usdc);
      // Clamp counter to ±5% of curve target unless tactic explicitly justifies deviation.
      if (curveTarget && r.tactic === "ANCHOR_ABOVE_RESERVE") {
        const lo = curveTarget * 0.95;
        const hi = curveTarget * 1.05;
        bid = Math.min(hi, Math.max(lo, bid));
      }
      // Hard guarantee: never below dynamic_reserve.
      bid = Math.max(market.dynamic_reserve_usdc[zone], bid);
      replies.set(r.brand_id, {
        action: "counter",
        counter_terms: {
          bid_usdc: Number(bid.toFixed(2)),
          duration_s: Number(ct.duration_s),
          zone,
          exclusivity_s: ct.exclusivity_s != null ? Number(ct.exclusivity_s) : undefined,
        },
        message: r.message,
        tactic: r.tactic,
        curve_target_usdc: curveTarget,
      });
    } else if (r.action === "accept") {
      // Run AC_combi gate. If brand's last offer breaches reserve, override to reject.
      const session = active_negotiations.find((n) => n.brand_id === r.brand_id);
      const lastBrandTerms = session ? lastTermsFromSide(session.history, "brand") : undefined;
      if (!lastBrandTerms) {
        replies.set(r.brand_id, {
          action: "reject",
          message: "(accept sin oferta del brand — tratado como reject)",
          tactic: r.tactic,
          curve_target_usdc: curveTarget,
        });
        continue;
      }
      const decision = validateAccept({
        side: "streamer",
        offer_price_usdc: lastBrandTerms.bid_usdc,
        reservation_usdc: market.dynamic_reserve_usdc[lastBrandTerms.zone],
        next_planned_price_usdc: curveTarget ?? lastBrandTerms.bid_usdc,
        rounds_remaining: input.rounds_remaining,
        seconds_remaining: input.seconds_remaining,
      });
      if (!decision.accept) {
        replies.set(r.brand_id, {
          action: "reject",
          message: `(AC_combi gate: ${decision.reason})`,
          tactic: r.tactic,
          curve_target_usdc: curveTarget,
          override: { from_action: "accept", rule: decision.rule_violated, reason: decision.reason },
        });
        continue;
      }
      replies.set(r.brand_id, {
        action: "accept",
        message: r.message,
        tactic: r.tactic,
        curve_target_usdc: curveTarget,
      });
    } else if (r.action === "reject") {
      replies.set(r.brand_id, {
        action: "reject",
        message: r.message,
        tactic: r.tactic,
        curve_target_usdc: curveTarget,
      });
    }
  }
  return { replies, round_strategy: out.round_strategy };
}

function lastTermsFromSide(history: Turn[], side: "brand" | "streamer"): DealTerms | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    if (t.from === side && t.terms) return t.terms;
  }
  return undefined;
}

const PICKER_SCHEMA = {
  type: "object",
  properties: {
    winner: {
      type: ["object", "null"],
      properties: {
        brand_id: { type: "string" },
        terms: {
          type: "object",
          properties: {
            bid_usdc: { type: "number" },
            duration_s: { type: "number" },
            zone: { type: "string", enum: ENABLED_ZONES },
            exclusivity_s: { type: ["number", "null"] },
          },
          required: ["bid_usdc", "duration_s", "zone"],
        },
        reason: { type: "string" },
      },
      required: ["brand_id", "terms", "reason"],
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
  required: ["winner", "rejected"],
} as const;

export async function pickWinner(closed: ClosedDeal[], market: MarketSignals): Promise<FinalDecision> {
  const accepted = closed.filter((c) => c.accepted && c.terms);
  if (accepted.length === 0) {
    return { winner: null, rejected: [], total_revenue_usdc: 0 };
  }

  const dealsBlock = accepted
    .map((c) => {
      const t = c.terms!;
      const fair = market.fair_value_usdc[t.zone];
      const cpmRatio = ((t.bid_usdc / fair) * 100).toFixed(0);
      const excl = t.exclusivity_s ? ` excl=${t.exclusivity_s}s` : "";
      return `- ${c.brand_id}: $${t.bid_usdc.toFixed(2)} ${t.zone} ${t.duration_s}s${excl} (CPM/s=$${(t.bid_usdc / t.duration_s).toFixed(3)}, ${cpmRatio}% de fair_value $${fair.toFixed(2)})`;
    })
    .join("\n");

  const userPrompt = `Estos son los DEALS CERRADOS de esta ronda:

${dealsBlock}

REGLA: En este momento corre EXACTAMENTE UN ad. Elegí UN único ganador.

CRITERIOS, en orden:
1. Revenue absoluto.
2. CPM/s sobre la duración.
3. % del deal sobre fair_value de su zona.
4. Marca preferida si hay empate ([${STREAMER_MANDATE.preferred_brands.join(", ")}]).
5. Bonus implícito por exclusivity (cuanto más exclusivity_s, más premium real).

Si NINGÚN deal supera el dynamic_reserve de su zona, devolvé winner=null.`;

  const decision = await callTool<FinalDecision>({
    model: STREAMER_MODEL,
    system: streamerSystem(market),
    user: userPrompt,
    toolName: "submit_winner",
    toolDescription: "Selección final del único winner.",
    inputSchema: PICKER_SCHEMA,
    parse: (raw) => {
      const x = raw as any;
      const w = x.winner;
      const winner = w
        ? {
            brand_id: String(w.brand_id),
            terms: {
              bid_usdc: Number(w.terms.bid_usdc),
              duration_s: Number(w.terms.duration_s),
              zone: w.terms.zone as ZoneId,
              exclusivity_s: w.terms.exclusivity_s != null ? Number(w.terms.exclusivity_s) : undefined,
            },
            reason: String(w.reason ?? ""),
          }
        : null;
      const rejected = (x.rejected ?? []).map((r: any) => ({
        brand_id: String(r.brand_id),
        reason: String(r.reason ?? ""),
      }));
      const total = winner ? winner.terms.bid_usdc : 0;
      return { winner, rejected, total_revenue_usdc: total };
    },
    maxTokens: 800,
  });

  return decision;
}

// Re-export for tests / orchestrator's gate trace
export type { AcceptDecision };

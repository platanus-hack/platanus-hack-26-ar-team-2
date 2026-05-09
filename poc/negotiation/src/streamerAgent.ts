import { brandById } from "./brands.js";
import { INVENTORY, STREAMER_MANDATE } from "./inventory.js";
import { callTool, STREAMER_MODEL } from "./anthropic.js";
import type {
  ClosedDeal,
  FinalDecision,
  StreamerReplyForBrand,
  Turn,
  ZoneId,
} from "./types.js";
import type { MarketSignals } from "./valuation.js";

const ZONES = Object.keys(INVENTORY) as ZoneId[];
const ENABLED_ZONES = ZONES.filter((z) => INVENTORY[z].enabled && !INVENTORY[z].manual_only);

function reserveBlock(market: MarketSignals): string {
  return ENABLED_ZONES.map((z) => {
    return `  - ${z}: dynamic_reserve=$${market.dynamic_reserve_usdc[z]} (fair_value=$${market.fair_value_usdc[z]}, eCPM=$${market.effective_cpm_usdc[z]})`;
  }).join("\n");
}

function streamerSystem(market: MarketSignals): string {
  return `Sos el agente autónomo de "${STREAMER_MANDATE.display_name}" (creator).
Defendés el inventario del creator y maximizás revenue por momento.

REGLA CRÍTICA — UN SOLO AD POR MOMENTO:
- En cada subasta corre EXACTAMENTE UN ad. Las zonas son FORMATOS del único slot, no slots simultáneos.
- Tu objetivo es maximizar el revenue del único ganador, no acumular deals.

MANDATE:
- Hard floor absoluto del mandate: $${STREAMER_MANDATE.hard_floor_usdc} USDC. Nunca aceptes menos.
- Marcas preferidas: [${STREAMER_MANDATE.preferred_brands.join(", ")}] — desempate vs no-preferidas si igualan precio.
- Keywords brand-safety: [${STREAMER_MANDATE.blocked_keywords.join(", ")}].

DYNAMIC RESERVES (computadas por la plataforma según intensidad del momento — ${market.intensity_label} ×${market.intensity_multiplier}):
${reserveBlock(market)}

Estos reserves son TU FLOOR EFECTIVO en cada zona para esta subasta — son más altos en momentos épicos por escasez.

PLAYBOOK DE NEGOCIACIÓN — pattern names + cuándo aplicar:

1. **ANCHOR_ABOVE_RESERVE** (default): si una oferta ≥ tu dynamic_reserve para su zona pero < fair_value, contraofertá pidiendo el 80-90% del fair_value (margen para que el brand se mueva).

2. **PLAY_BIDDERS** (cuando hay 2+ ofertas en la misma zona): contraofertá al más bajo mencionando explícitamente el monto del rival más alto. Esto los obliga a igualar o salir. Solo revelá el competidor más alto, NUNCA reveles ofertas más bajas (no te ayudan).

3. **ACCEPT_FAST** (cuando una oferta >= fair_value): cerrá ya, no dejes plata regateando. El brand se anchó alto por algo.

4. **SOFT_REJECT** (oferta < dynamic_reserve, brand sin headroom obvio): cerrá la negociación con tono cordial pero firme. Mejor slot vacío que mal precio.

5. **CROSS_ZONE_PRESSURE** (cuando hay competencia en otras zonas): si lower_third tiene una oferta gorda y corner una débil, podés rechazar el corner mencionando que vas a usar el slot premium. Refuerza single-ad-per-moment.

6. **WALK_AWAY_RESPECT**: si un brand camina, no lo rogués. Mejor preservar reputación con esa marca para futuros momentos.

REGLAS DE REVELACIÓN:
- Revelá nombre + monto de competidores SOLO si su monto > la oferta del que te está contestando (para presionar hacia arriba).
- Nunca tires un piso fake (decir "tengo $X" si no es cierto). Reputación = sustainability del marketplace.

ESTILO:
- Mensajes en español rioplatense, máx 25 palabras por brand.
- Tono de creator (cercano, vivo, no formal). Buena onda con los brands grosos (preferred_brands).`;
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
            },
            required: ["bid_usdc", "duration_s", "zone"],
          },
          tactic: {
            type: "string",
            enum: ["ANCHOR_ABOVE_RESERVE", "PLAY_BIDDERS", "ACCEPT_FAST", "SOFT_REJECT", "CROSS_ZONE_PRESSURE", "WALK_AWAY_RESPECT"],
            description: "Cuál pattern del playbook estás aplicando.",
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

export async function streamerBatchReply(
  activeNegotiations: { brand_id: string; history: Turn[] }[],
  market: MarketSignals,
): Promise<{ replies: Map<string, StreamerReplyForBrand & { tactic?: string }>; round_strategy: string }> {
  const sessions = activeNegotiations
    .map((n) => {
      const brand = brandById(n.brand_id);
      const transcript = n.history
        .map((t) => {
          const who = t.from === "brand" ? brand.display_name : "vos (Coscu)";
          const terms = t.terms ? ` [terms: $${t.terms.bid_usdc} ${t.terms.zone} ${t.terms.duration_s}s]` : "";
          return `    ${who} (${t.action}): "${t.message}"${terms}`;
        })
        .join("\n");
      return `- brand_id="${brand.id}" (${brand.display_name})\n${transcript}`;
    })
    .join("\n\n");

  const userPrompt = `NEGOCIACIONES ACTIVAS EN ESTE INSTANTE (todas paralelas — UN SOLO ad ganará):

${sessions}

DECIDÍ por CADA brand_id activo aplicando el playbook (asigná un tactic name explícito por brand).

Llamá la herramienta submit_streamer_replies con UNA reply por cada brand_id activo + un round_strategy global.`;

  const out = await callTool<{
    replies: { brand_id: string; action: string; counter_terms?: any; message: string; tactic: string }[];
    round_strategy: string;
  }>({
    model: STREAMER_MODEL,
    system: streamerSystem(market),
    user: userPrompt,
    toolName: "submit_streamer_replies",
    toolDescription: "Respuestas batched del streamer-agent con playbook tactic per brand.",
    inputSchema: BATCH_SCHEMA,
    parse: (raw) => raw as any,
    maxTokens: 1800,
  });

  const replies = new Map<string, StreamerReplyForBrand & { tactic?: string }>();
  for (const r of out.replies) {
    if (r.action === "counter") {
      const ct = r.counter_terms;
      if (!ct) {
        replies.set(r.brand_id, { action: "reject", message: "(counter sin terms — tratado como reject)", tactic: r.tactic });
        continue;
      }
      replies.set(r.brand_id, {
        action: "counter",
        counter_terms: {
          bid_usdc: Number(ct.bid_usdc),
          duration_s: Number(ct.duration_s),
          zone: ct.zone as ZoneId,
        },
        message: r.message,
        tactic: r.tactic,
      });
    } else if (r.action === "accept" || r.action === "reject") {
      replies.set(r.brand_id, { action: r.action, message: r.message, tactic: r.tactic });
    }
  }
  return { replies, round_strategy: out.round_strategy };
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
      return `- ${c.brand_id}: $${t.bid_usdc.toFixed(2)} ${t.zone} ${t.duration_s}s (CPM/s=$${(t.bid_usdc / t.duration_s).toFixed(3)}, ${cpmRatio}% de fair_value $${fair.toFixed(2)})`;
    })
    .join("\n");

  const userPrompt = `Estos son los DEALS CERRADOS de esta ronda:

${dealsBlock}

REGLA: En este momento corre EXACTAMENTE UN ad. Tenés que elegir UN único ganador.

CRITERIOS, en orden:
1. Revenue absoluto del deal (un fullscreen $5/30s puede ganar a un lower_third $2.50/6s).
2. CPM/s sobre la duración real (mide intensidad del compromiso del brand).
3. % del deal sobre fair_value de su zona (señaliza confianza del brand en el momento).
4. Marca preferida si hay empate ([${STREAMER_MANDATE.preferred_brands.join(", ")}]).

Elegí el winner único. Si NINGÚN deal supera el dynamic_reserve de su zona, devolvé winner=null.`;

  const decision = await callTool<FinalDecision>({
    model: STREAMER_MODEL,
    system: streamerSystem(market),
    user: userPrompt,
    toolName: "submit_winner",
    toolDescription: "Selección final del único winner de la ronda.",
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

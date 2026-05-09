import { BRAND_MODEL, callTool } from "./anthropic.js";
import { INVENTORY } from "./inventory.js";
import type {
  BrandMandate,
  BrandResponse,
  HuntDecision,
  StreamContext,
  Turn,
  ValuationBreakdown,
  ZoneId,
} from "./types.js";
import type { MarketSignals } from "./valuation.js";

const ZONES = Object.keys(INVENTORY) as ZoneId[];
const BIDDABLE_ZONES = ZONES.filter((z) => INVENTORY[z].enabled && !INVENTORY[z].manual_only);

function inventorySummary(): string {
  return BIDDABLE_ZONES.map((z) => {
    const r = INVENTORY[z];
    return `  - ${z}: min_bid=$${r.min_bid_usdc}, max_dur=${r.max_duration_s}s`;
  }).join("\n");
}

function adsSummary(brand: BrandMandate): string {
  return brand.ads
    .filter((a) => BIDDABLE_ZONES.includes(a.format))
    .map(
      (a) =>
        `  - ad_id="${a.id}" "${a.variant_name}" zone=${a.format} dur=${a.duration_s}s mood=[${a.mood_tags.join(",")}]`,
    )
    .join("\n");
}

function marketSignalsBlock(ms: MarketSignals): string {
  return BIDDABLE_ZONES.map((z) => {
    return `  - ${z}: fair_value=$${ms.fair_value_usdc[z]} (eCPM=$${ms.effective_cpm_usdc[z]}, expected_impressions=${ms.expected_impressions[z]})`;
  }).join("\n");
}

function brandSystemPrompt(brand: BrandMandate): string {
  const remaining = brand.daily_cap_usdc - brand.spent_today_usdc;
  return `Sos el agente autónomo de la marca "${brand.display_name}".
Voz de marca: ${brand.brand_voice}.

MANDATE FIRMADO:
- Daily cap: $${brand.daily_cap_usdc} USDC. Ya gastaste hoy: $${brand.spent_today_usdc.toFixed(2)}.
- Presupuesto restante hoy: $${remaining.toFixed(2)}.
- Bid range absoluto: $${brand.min_bid_usdc} - $${brand.max_bid_usdc} USDC por placement.
- Targeting games: [${brand.targeting.games.join(", ")}].
- Targeting moods: [${brand.targeting.moods.join(", ")}].

REGLAS DEL JUEGO:
- UN SOLO AD POR MOMENTO: vas a competir contra otros brands por el ÚNICO slot del momento. Solo uno gana por subasta.
- Solo podés ofrecer ads de tu biblioteca y bidear en zonas habilitadas.
- Las terms del JSON son contractuales — no mientas.
- Mensajes en español rioplatense, máx 25 palabras, voz de marca.

PLAYBOOK DE VALUACIÓN (te lo aplicás SIEMPRE antes de fijar tu opening_bid):

1. Recibís MarketSignals computado por la plataforma — son baseline objetivo (CPM × impressions).
2. Computás brand_fit_multiplier (0.4 a 2.0) sumando estos factores:
   - +0.4 si el game del stream está en tu targeting
   - +0.4 si el mood actual matchea alguno de tus moods de targeting
   - +0.2 si la audiencia (viewers) supera 5000 (escala que te interesa)
   - +0.2 si la voz/tema del momento alinea con tu brand_voice
   - +0.2 si tenés un ad en tu biblioteca con mood_tags que matchean directo
   - Base 0.6 (un brand sin ningún factor casi no debería bidear).
   - Si total < 0.8: deberías hacer SKIP (ROI negativo esperado).

3. perceived_value = fair_value_market × brand_fit_multiplier
   ⚠️ El fair_value real del momento puede ser MUY ALTO ($25-200 USDC). Eso NO significa que vos puedas pagar eso. Tu max_bid del mandate es el techo absoluto.
4. max_acceptable = MIN(
     perceived_value × 0.85,        // dejá 15% de margen sobre tu propia valoración
     daily_remaining × 0.30,        // nunca más del 30% del budget restante en un slot
     max_bid_usdc                    // ⚠️ HARD CAP del mandate por placement — NUNCA, JAMÁS lo superes
   )
   En la práctica para esta marca, max_acceptable casi siempre va a estar limitado por max_bid_usdc o por daily_remaining × 0.30, NO por perceived_value (que es teórico).
5. opening_factor — tu apertura como % de max_acceptable:
   - 0.55 si pensás que hay competencia FUERTE (3+ brands con buen fit) → escalación esperada
   - 0.65 default (competencia moderada)
   - 0.75 si pensás que sos el único con buen fit (cerrá rápido, no inflés)
6. opening_bid = MAX(min_bid_usdc, max_acceptable × opening_factor), redondeado a 2 decimales.

REGLAS DE INTEGRIDAD:
- Si max_acceptable < min_bid_usdc del zone elegido → SKIP, no podés cubrir ni el floor.
- Si fair_value_market es bajo (calm chat, audiencia chica), aceptá el SKIP. No inflés.
- En el opening_message podés mencionar tu brand_fit (por qué este momento es tuyo) sin tirar el número de max_acceptable.`;
}

const HUNT_SCHEMA = {
  type: "object",
  properties: {
    should_bid: { type: "boolean" },
    reason: { type: "string", description: "1-2 frases en español, decisión + justificación corta." },
    brand_fit_multiplier: {
      type: "number",
      description: "0.4-2.0. Si <0.8 deberías skipear.",
    },
    ad_id: { type: ["string", "null"] },
    zone: {
      type: ["string", "null"],
      enum: [...BIDDABLE_ZONES, null],
    },
    fit_reasons: {
      type: "array",
      items: { type: "string" },
      description: "Bullets cortos: qué factores de fit hicieron sumar puntos (max 4).",
    },
    perceived_value_usdc: {
      type: ["number", "null"],
      description: "fair_value_market × brand_fit_multiplier",
    },
    max_acceptable_usdc: {
      type: ["number", "null"],
      description: "Walk-away ceiling. min(perceived_value × 0.85, daily_remaining × 0.3, max_bid).",
    },
    opening_factor: {
      type: ["number", "null"],
      description: "0.55-0.75",
    },
    competitive_assumption: {
      type: ["string", "null"],
      description: "Cómo evaluaste la competencia (drives opening_factor).",
    },
    bid_usdc: {
      type: ["number", "null"],
      description: "Opening bid final = max(min_bid_zone, max_acceptable × opening_factor).",
    },
    duration_s: { type: ["number", "null"] },
    opening_message: {
      type: ["string", "null"],
      description: "Tu primer mensaje al agente del streamer. Español, máx 25 palabras, voz de marca.",
    },
  },
  required: ["should_bid", "reason", "brand_fit_multiplier"],
} as const;

export async function huntForBrand(
  brand: BrandMandate,
  context: StreamContext,
  market: MarketSignals,
): Promise<HuntDecision> {
  const userPrompt = `CONTEXTO DEL STREAM (último tick):
- Audio últimos 30s: "${context.audio_30s}"
- Frame: ${context.frame_description}
- Game: ${context.game}
- Chat velocity: ${context.chat_velocity_msgs} msg/s (baseline ${context.chat_baseline_msgs}, ${(context.chat_velocity_msgs / context.chat_baseline_msgs).toFixed(1)}× spike)
- Sentiment: ${context.sentiment.toFixed(2)}
- Viewers: ${context.viewers}
- Mood label: ${context.mood ?? "n/a"}

MARKET SIGNALS (baseline objetivo, mismo que ven los demás agents):
- Intensity del momento: ${market.intensity_label} (${market.moment_intensity}, multiplier ×${market.intensity_multiplier})
- Fair values por zona (sin tu brand-fit aplicado todavía):
${marketSignalsBlock(market)}

TUS ADS DISPONIBLES en zonas bidables:
${adsSummary(brand)}

INVENTARIO BIDABLE DEL CREATOR:
${inventorySummary()}

DECISIÓN: corré el playbook de valuación PASO POR PASO en tu cabeza, después llamá la herramienta submit_hunt_decision con TODOS los campos del breakdown (brand_fit_multiplier, fit_reasons, perceived_value_usdc, max_acceptable_usdc, opening_factor, competitive_assumption, bid_usdc, duration_s, ad_id, zone, opening_message).

Si decidís skip, igual mandá brand_fit_multiplier (para auditoría) y reason explicando por qué no llega.`;

  return await callTool<HuntDecision>({
    model: BRAND_MODEL,
    system: brandSystemPrompt(brand),
    user: userPrompt,
    toolName: "submit_hunt_decision",
    toolDescription: "Decisión del brand-agent con valuation breakdown explícito.",
    inputSchema: HUNT_SCHEMA,
    parse: (raw) => parseHuntDecision(raw, brand),
    maxTokens: 1000,
  });
}

function parseHuntDecision(raw: unknown, brand: BrandMandate): HuntDecision {
  const x = raw as Record<string, unknown>;
  const fit = Number(x.brand_fit_multiplier ?? 0);

  if (!x.should_bid) {
    return {
      should_bid: false,
      reason: String(x.reason ?? "skip"),
      brand_fit_multiplier: fit,
    };
  }
  const ad_id = String(x.ad_id ?? "");
  const ad = brand.ads.find((a) => a.id === ad_id);
  if (!ad) {
    return {
      should_bid: false,
      reason: `intentó bidear con ad_id=${ad_id} que no existe en su biblioteca`,
      brand_fit_multiplier: fit,
    };
  }
  const zone = x.zone as ZoneId;
  if (!BIDDABLE_ZONES.includes(zone)) {
    return {
      should_bid: false,
      reason: `zona no bidable: ${String(zone)}`,
      brand_fit_multiplier: fit,
    };
  }
  let bid_usdc = Number(x.bid_usdc);
  const duration_s = Number(x.duration_s ?? ad.duration_s);
  if (!Number.isFinite(bid_usdc) || bid_usdc <= 0) {
    return { should_bid: false, reason: "bid inválido", brand_fit_multiplier: fit };
  }
  if (bid_usdc < INVENTORY[zone].min_bid_usdc) {
    return {
      should_bid: false,
      reason: `bid $${bid_usdc} debajo del floor de ${zone} ($${INVENTORY[zone].min_bid_usdc})`,
      brand_fit_multiplier: fit,
    };
  }
  // Hard-clamp to mandate max_bid_usdc — protects against LLM ignoring the cap.
  if (bid_usdc > brand.max_bid_usdc) {
    bid_usdc = brand.max_bid_usdc;
  }
  // Also clamp max_acceptable for downstream walk-away discipline.
  const claimed_max = Number(x.max_acceptable_usdc ?? bid_usdc);
  const max_acceptable_usdc = Math.min(
    claimed_max,
    brand.max_bid_usdc,
    (brand.daily_cap_usdc - brand.spent_today_usdc) * 0.30,
  );

  const valuation: ValuationBreakdown = {
    brand_fit_multiplier: fit,
    fit_reasons: Array.isArray(x.fit_reasons) ? (x.fit_reasons as string[]) : [],
    perceived_value_usdc: Number(x.perceived_value_usdc ?? 0),
    max_acceptable_usdc,
    opening_factor: Number(x.opening_factor ?? 0.65),
    opening_bid_usdc: bid_usdc,
    competitive_assumption: String(x.competitive_assumption ?? ""),
  };

  return {
    should_bid: true,
    offer: {
      brand_id: brand.id,
      ad_id: ad.id,
      message: String(x.opening_message ?? ""),
      terms: { bid_usdc, duration_s, zone },
      valuation,
    },
    reason: String(x.reason ?? ""),
  };
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["counter", "accept", "walk"] },
    counter_terms: {
      type: ["object", "null"],
      properties: {
        bid_usdc: { type: "number" },
        duration_s: { type: "number" },
        zone: { type: "string", enum: BIDDABLE_ZONES },
      },
      required: ["bid_usdc", "duration_s", "zone"],
    },
    message: { type: "string", description: "Español, máx 25 palabras, voz de marca." },
    walk_reason: {
      type: ["string", "null"],
      description: "Si action=walk, qué constraint te limitó (max_acceptable, daily_cap, ROI).",
    },
  },
  required: ["action", "message"],
} as const;

export async function brandRespond(
  brand: BrandMandate,
  history: Turn[],
  market: MarketSignals,
  /** The valuation the brand committed to during hunt — anchors walk-away. */
  myValuation: ValuationBreakdown | undefined,
): Promise<BrandResponse> {
  const transcript = history
    .map((t) => {
      const who = t.from === "brand" ? brand.display_name : "Coscu";
      const terms = t.terms ? ` [terms: $${t.terms.bid_usdc} ${t.terms.zone} ${t.terms.duration_s}s]` : "";
      return `${who} (${t.action}): "${t.message}"${terms}`;
    })
    .join("\n");

  const remaining = brand.daily_cap_usdc - brand.spent_today_usdc;
  const myMaxBlock = myValuation
    ? `TU PROPIA VALUACIÓN DE ESTE SLOT (de la fase de hunt — anclá tu walk-away acá):
- brand_fit_multiplier: ${myValuation.brand_fit_multiplier}
- perceived_value: $${myValuation.perceived_value_usdc.toFixed(2)}
- max_acceptable: $${myValuation.max_acceptable_usdc.toFixed(2)}  ← ⚠️ NUNCA aceptes ni contraofertes por encima de esto
- opening_bid fue: $${myValuation.opening_bid_usdc.toFixed(2)}`
    : "(sin valuation previa — usá el rango del mandate)";

  const userPrompt = `HISTORIAL DE LA NEGOCIACIÓN:
${transcript}

CONTEXTO ECONÓMICO:
- Presupuesto restante hoy: $${remaining.toFixed(2)} USDC
- Tu rango absoluto: $${brand.min_bid_usdc} - $${brand.max_bid_usdc} USDC

${myMaxBlock}

MARKET SIGNALS para esta zona: fair_value_market = $${myValuation ? market.fair_value_usdc[history[0]?.terms?.zone as ZoneId] ?? "n/a" : "n/a"}

DECISIÓN — playbook de respuesta:
1. Si la última propuesta del streamer ≤ tu max_acceptable → ACCEPT (cerrá, no dejes plata sobre la mesa).
2. Si la última propuesta del streamer > tu max_acceptable:
   - Podés ofrecer un counter cerca de max_acceptable para señalizar techo (1 chance más).
   - Si ya contraofertaste cerca del techo y el streamer sigue subiendo → WALK con dignidad. Mejor perder este slot que romper mandate.
3. Si querés counter, NUNCA propongas más de tu max_acceptable. Mejor walk que sobrepujarte.

Llamá la herramienta submit_brand_response con action + message + (counter_terms si counter) + walk_reason si walk.`;

  return await callTool<BrandResponse>({
    model: BRAND_MODEL,
    system: brandSystemPrompt(brand),
    user: userPrompt,
    toolName: "submit_brand_response",
    toolDescription: "Respuesta del brand-agent con disciplina de walk-away.",
    inputSchema: RESPONSE_SCHEMA,
    parse: (raw) => {
      const x = raw as Record<string, unknown>;
      const action = x.action as BrandResponse["action"];
      const message = String(x.message ?? "");
      if (action === "counter") {
        const ct = x.counter_terms as Record<string, unknown> | null;
        if (!ct) {
          return { action: "walk", message: "(counter sin terms — tratado como walk)" };
        }
        const counterBid = Number(ct.bid_usdc);
        // Defensive: enforce walk-away ceiling
        if (myValuation && counterBid > myValuation.max_acceptable_usdc + 0.01) {
          return {
            action: "walk",
            message: `(intentó counter $${counterBid} > max_acceptable $${myValuation.max_acceptable_usdc.toFixed(2)} — defensive walk)`,
          };
        }
        return {
          action: "counter",
          counter_terms: {
            bid_usdc: counterBid,
            duration_s: Number(ct.duration_s),
            zone: ct.zone as ZoneId,
          },
          message,
        };
      }
      return { action, message };
    },
    maxTokens: 500,
  });
}

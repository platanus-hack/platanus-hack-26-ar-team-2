import { BRAND_MODEL, callTool } from "./anthropic.js";
import { INVENTORY } from "./inventory.js";
import {
  BRAND_DEFAULT_BETA,
  concessionPrice,
  validateAccept,
  type AcceptDecision,
} from "./negotiationMath.js";
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
- UN SOLO AD POR MOMENTO: vas a competir contra otros brands por el ÚNICO slot. Solo uno gana.
- Solo podés ofrecer ads de tu biblioteca y bidear en zonas habilitadas.
- Las terms del JSON son contractuales. NUNCA superes max_bid_usdc del mandate.
- Mensajes en español rioplatense, máx 25 palabras, voz de marca.

PLAYBOOK DE VALUACIÓN (hunt phase):

1. Recibís MarketSignals (CPM × impressions baseline objetivo).
2. brand_fit_multiplier ∈ [0.4, 2.0]:
   - +0.4 game en targeting · +0.4 mood matchea · +0.2 audience > 5K
   - +0.2 voz alinea con momento · +0.2 ad library mood matchea
   - Base 0.6. Si total < 0.8 → SKIP (ROI negativo).
3. perceived_value = fair_value_market × brand_fit_multiplier
   ⚠️ fair_value teórico puede ser muy alto. Tu max_bid del mandate es el techo absoluto.
4. max_acceptable = MIN(perceived_value × 0.85, daily_remaining × 0.30, max_bid_usdc).
   En la práctica casi siempre va a estar limitado por max_bid_usdc — eso está bien.
5. opening_factor 0.55-0.75:
   - 0.55 si esperás competencia FUERTE (3+ con buen fit) → escalación esperada
   - 0.65 default
   - 0.75 si sos único con buen fit (cerrá rápido)
6. opening_bid = MAX(min_bid_zone, max_acceptable × opening_factor).

EXCLUSIVITY (multi-issue, opcional en hunt):
- Podés incluir exclusivity_s ∈ [0, 60] en tu opening: segundos donde NO corre otro ad después del tuyo.
- Te cuesta más al streamer (premium implícito hasta +30% en tu bid). Útil si tu ad es premium y querés evitar contaminación.
- Si no te interesa, dejá exclusivity_s = 0 (default).

PLAYBOOK DE RESPONSE (counter / accept / walk):
- Vas a recibir suggested_counter_usdc (curva de concesión hacia tu max_acceptable, round-aware) — usalo si vas a counter (puedes ±5%).
- Si la oferta del streamer ≤ tu max_acceptable → ACCEPT (no dejes plata sobre la mesa, vas a perder el slot al rival).
- Si la oferta del streamer > tu max_acceptable → WALK con dignidad. Mejor perder el slot que romper mandate.
- Si rounds_remaining ≤ 1: priorizá ACCEPT si la oferta cumple max_acceptable; sino WALK (no hay espacio para más rondas).`;
}

const HUNT_SCHEMA = {
  type: "object",
  properties: {
    should_bid: { type: "boolean" },
    reason: { type: "string" },
    brand_fit_multiplier: { type: "number" },
    ad_id: { type: ["string", "null"] },
    zone: { type: ["string", "null"], enum: [...BIDDABLE_ZONES, null] },
    fit_reasons: { type: "array", items: { type: "string" } },
    perceived_value_usdc: { type: ["number", "null"] },
    max_acceptable_usdc: { type: ["number", "null"] },
    opening_factor: { type: ["number", "null"] },
    competitive_assumption: { type: ["string", "null"] },
    bid_usdc: { type: ["number", "null"] },
    duration_s: { type: ["number", "null"] },
    exclusivity_s: {
      type: ["number", "null"],
      description: "0-60 seconds of post-placement competitor lockout. 0 = no exclusivity.",
    },
    opening_message: { type: ["string", "null"] },
  },
  required: ["should_bid", "reason", "brand_fit_multiplier"],
} as const;

export async function huntForBrand(
  brand: BrandMandate,
  context: StreamContext,
  market: MarketSignals,
): Promise<HuntDecision> {
  const userPrompt = `CONTEXTO DEL STREAM:
- Audio últimos 30s: "${context.audio_30s}"
- Frame: ${context.frame_description}
- Game: ${context.game}
- Chat velocity: ${context.chat_velocity_msgs} msg/s (baseline ${context.chat_baseline_msgs}, ${(context.chat_velocity_msgs / context.chat_baseline_msgs).toFixed(1)}× spike)
- Sentiment: ${context.sentiment.toFixed(2)}
- Viewers: ${context.viewers}
- Mood: ${context.mood ?? "n/a"}

MARKET SIGNALS (baseline objetivo, mismo que ven todos):
- Intensity: ${market.intensity_label} (${market.moment_intensity}, multiplier ×${market.intensity_multiplier})
- Fair values:
${marketSignalsBlock(market)}

TUS ADS DISPONIBLES en zonas bidables:
${adsSummary(brand)}

INVENTARIO BIDABLE:
${inventorySummary()}

DECISIÓN: corré el playbook PASO POR PASO, después llamá submit_hunt_decision con el breakdown completo.`;

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
    return { should_bid: false, reason: String(x.reason ?? "skip"), brand_fit_multiplier: fit };
  }
  const ad_id = String(x.ad_id ?? "");
  const ad = brand.ads.find((a) => a.id === ad_id);
  if (!ad) {
    return {
      should_bid: false,
      reason: `intentó bidear con ad_id=${ad_id} que no existe`,
      brand_fit_multiplier: fit,
    };
  }
  const zone = x.zone as ZoneId;
  if (!BIDDABLE_ZONES.includes(zone)) {
    return { should_bid: false, reason: `zona no bidable: ${String(zone)}`, brand_fit_multiplier: fit };
  }
  let bid_usdc = Number(x.bid_usdc);
  const duration_s = Number(x.duration_s ?? ad.duration_s);
  if (!Number.isFinite(bid_usdc) || bid_usdc <= 0) {
    return { should_bid: false, reason: "bid inválido", brand_fit_multiplier: fit };
  }
  if (bid_usdc < INVENTORY[zone].min_bid_usdc) {
    return {
      should_bid: false,
      reason: `bid $${bid_usdc} < floor de ${zone} ($${INVENTORY[zone].min_bid_usdc})`,
      brand_fit_multiplier: fit,
    };
  }
  // Hard-clamp to mandate max_bid_usdc.
  if (bid_usdc > brand.max_bid_usdc) bid_usdc = brand.max_bid_usdc;

  const claimed_max = Number(x.max_acceptable_usdc ?? bid_usdc);
  const max_acceptable_usdc = Math.min(
    claimed_max,
    brand.max_bid_usdc,
    (brand.daily_cap_usdc - brand.spent_today_usdc) * 0.30,
  );

  let exclusivity_s: number | undefined = undefined;
  if (x.exclusivity_s != null) {
    const e = Number(x.exclusivity_s);
    if (Number.isFinite(e) && e > 0) exclusivity_s = Math.max(0, Math.min(60, Math.round(e)));
  }

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
      terms: { bid_usdc, duration_s, zone, exclusivity_s },
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
        exclusivity_s: { type: ["number", "null"] },
      },
      required: ["bid_usdc", "duration_s", "zone"],
    },
    message: { type: "string" },
    walk_reason: { type: ["string", "null"] },
  },
  required: ["action", "message"],
} as const;

export type BrandResponseInput = {
  brand: BrandMandate;
  history: Turn[];
  market: MarketSignals;
  /** Brand's hunt-phase valuation — anchors walk-away. */
  myValuation: ValuationBreakdown | undefined;
  round_index: number;
  max_rounds: number;
  rounds_remaining: number;
  seconds_remaining: number;
};

export type BrandResponseWithGate = BrandResponse & {
  curve_target_usdc?: number;
  override?: { from_action: "accept"; rule: string; reason: string };
};

export async function brandRespond(input: BrandResponseInput): Promise<BrandResponseWithGate> {
  const { brand, history, market, myValuation, round_index, max_rounds } = input;

  const transcript = history
    .map((t) => {
      const who = t.from === "brand" ? brand.display_name : "Coscu";
      const terms = t.terms
        ? ` [terms: $${t.terms.bid_usdc} ${t.terms.zone} ${t.terms.duration_s}s${t.terms.exclusivity_s ? ` excl=${t.terms.exclusivity_s}s` : ""}]`
        : "";
      return `${who} (${t.action}): "${t.message}"${terms}`;
    })
    .join("\n");

  const remaining = brand.daily_cap_usdc - brand.spent_today_usdc;
  const opening = history[0]?.terms;
  const myMaxAcc = myValuation?.max_acceptable_usdc ?? brand.max_bid_usdc;
  const myOpening = myValuation?.opening_bid_usdc ?? opening?.bid_usdc ?? brand.min_bid_usdc;

  // Brand concession curve: opening (low) → max_acceptable (high) as deadline nears.
  const curveTarget = concessionPrice({
    start_price: myOpening,
    end_price: myMaxAcc,
    round: round_index,
    max_rounds,
    beta: BRAND_DEFAULT_BETA,
  });
  const curveTargetClamped = Number(Math.min(myMaxAcc, Math.max(myOpening, curveTarget)).toFixed(2));

  const lastStreamerOffer = lastTermsFromSide(history, "streamer");

  const myMaxBlock = myValuation
    ? `TU VALUACIÓN (de hunt — anchor de walk-away):
- brand_fit_multiplier: ${myValuation.brand_fit_multiplier}
- perceived_value: $${myValuation.perceived_value_usdc.toFixed(2)}
- max_acceptable (HARD CEILING): $${myValuation.max_acceptable_usdc.toFixed(2)}
- opening_bid fue: $${myValuation.opening_bid_usdc.toFixed(2)}`
    : "(sin valuation previa)";

  const userPrompt = `HISTORIAL:
${transcript}

⏰ TIME PRESSURE: round ${round_index}/${max_rounds}, rounds_remaining=${input.rounds_remaining}, seconds_remaining=${input.seconds_remaining.toFixed(1)}s

CONTEXTO ECONÓMICO:
- Presupuesto restante: $${remaining.toFixed(2)}
- Rango absoluto: $${brand.min_bid_usdc} - $${brand.max_bid_usdc}

${myMaxBlock}

CURVA DE CONCESIÓN (Boulware moderada, β=${BRAND_DEFAULT_BETA}):
- suggested_counter_usdc para round ${round_index}: $${curveTargetClamped}
  (subiendo de tu opening $${myOpening.toFixed(2)} hacia tu max $${myMaxAcc.toFixed(2)} a medida que se acaba el tiempo)

DECISIÓN:
1. Si offer del streamer ≤ tu max_acceptable → ACCEPT.
2. Si pensás counter, USÁ suggested_counter_usdc (puedes ±5%). NUNCA superes tu max_acceptable.
3. Si offer del streamer > tu max_acceptable y vos tampoco podés counter dentro de tu rango → WALK.
4. rounds_remaining ≤ 1: ACCEPT si en rango, sino WALK. No hay próxima ronda.

Llamá submit_brand_response.`;

  const out = await callTool<BrandResponse>({
    model: BRAND_MODEL,
    system: brandSystemPrompt(brand),
    user: userPrompt,
    toolName: "submit_brand_response",
    toolDescription: "Respuesta del brand con disciplina de walk-away + curva.",
    inputSchema: RESPONSE_SCHEMA,
    parse: (raw) => raw as BrandResponse,
    maxTokens: 500,
  });

  // Apply gates / clamps before returning to orchestrator.
  if (out.action === "counter") {
    const ct = out.counter_terms;
    if (!ct) {
      return { action: "walk", message: "(counter sin terms — tratado como walk)", curve_target_usdc: curveTargetClamped };
    }
    let counterBid = Number(ct.bid_usdc);
    // Clamp counter to ±5% of curve target.
    const lo = curveTargetClamped * 0.95;
    const hi = curveTargetClamped * 1.05;
    counterBid = Math.min(hi, Math.max(lo, counterBid));
    // Hard ceiling: never above max_acceptable.
    if (counterBid > myMaxAcc + 0.01) {
      return {
        action: "walk",
        message: `(counter $${counterBid.toFixed(2)} > max_acceptable $${myMaxAcc.toFixed(2)} — defensive walk)`,
        curve_target_usdc: curveTargetClamped,
        override: { from_action: "accept", rule: "AC_const", reason: "counter would breach max_acceptable" },
      };
    }
    return {
      action: "counter",
      counter_terms: {
        bid_usdc: Number(counterBid.toFixed(2)),
        duration_s: Number(ct.duration_s),
        zone: ct.zone as ZoneId,
        exclusivity_s: ct.exclusivity_s != null ? Number(ct.exclusivity_s) : undefined,
      },
      message: out.message,
      curve_target_usdc: curveTargetClamped,
    };
  }

  if (out.action === "accept") {
    // AC_combi gate against max_acceptable.
    if (!lastStreamerOffer) {
      return { action: "walk", message: "(accept sin oferta del streamer)", curve_target_usdc: curveTargetClamped };
    }
    const decision = validateAccept({
      side: "brand",
      offer_price_usdc: lastStreamerOffer.bid_usdc,
      reservation_usdc: myMaxAcc,
      next_planned_price_usdc: curveTargetClamped,
      rounds_remaining: input.rounds_remaining,
      seconds_remaining: input.seconds_remaining,
    });
    if (!decision.accept) {
      return {
        action: "walk",
        message: `(AC_combi gate: ${decision.reason})`,
        curve_target_usdc: curveTargetClamped,
        override: { from_action: "accept", rule: decision.rule_violated, reason: decision.reason },
      };
    }
    return { action: "accept", message: out.message, curve_target_usdc: curveTargetClamped };
  }

  // walk
  return { action: "walk", message: out.message, curve_target_usdc: curveTargetClamped };
}

function lastTermsFromSide(history: Turn[], side: "brand" | "streamer") {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    if (t.from === side && t.terms) return t.terms;
  }
  return undefined;
}

export type { AcceptDecision };

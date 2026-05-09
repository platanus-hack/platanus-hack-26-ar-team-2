/**
 * Per-brand brand-agent runner — C-08 + C-08d.
 *
 * Runs the gate ladder (gate1 → gate3 → gate4 Sonnet decision) for ONE brand
 * against ONE context chunk and emits a typed `BrandAgentDecision`. This is
 * the unit C-14 (`POST /api/auctions/run`) calls in parallel for all brands
 * when the auction flow lands. Today it's reachable via `pnpm smoke:hunt`.
 *
 * Ladder semantics (docs/GATES.md §2):
 *   gate1 (deterministic) → SKIP fast, $0, ~0ms
 *   gate3 (Haiku triage)  → SKIP if voice/persona mismatch survives gate1.
 *                           Bypassed for `always_bid_floor: true` brands —
 *                           default bidder must always reach gate4.
 *   gate4 (Sonnet)        → only here we spend ~1.5–2s + Sonnet tokens.
 *                           Receives gate1_pass + gate3_reasoning + market
 *                           signals + manager_decision + ads + balance.
 *
 * The `agent_reasoning` audit field captured per call is the full
 * `gate_path[]` — every gate evaluation with its reason. C-16 persists
 * this on `placements.agent_reasoning` for the WINNING bid.
 *
 * Lazy import of `@anthropic-ai/sdk` so dry-run + harness paths don't need
 * the SDK installed locally — same pattern as gate3Haiku + manager/pickBrand.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { LoadedBrand } from "@/lib/agents/brands/loader";

import type {
  BrandAgentDecision,
  BrandValuation,
  Gate1Context,
  GateSkipReason,
  StreamMetadata,
  ZoneId,
} from "../types";

import { evaluateGate1 } from "./gates/gate1Mandate";
import { evaluateGate3 } from "./gates/gate3Haiku";

// ─── Public types ────────────────────────────────────────────────────

/**
 * Inventory + competitive snapshot the orchestrator computes once per
 * tick and feeds to every brand-agent. Drives `perceived_value_usdc` in
 * the Sonnet prompt.
 */
export type MarketSignals = {
  /** Recommended zone for this moment (lower_third / fullscreen / corner). */
  zone: ZoneId;
  /** Floor for the recommended zone, USDC. */
  zone_floor_usdc: number;
  /** Manager-estimated fair value for this moment in this zone, USDC. */
  fair_value_usdc: number;
  /** How many other brands the orchestrator expects to bid. Drives `competitive_assumption`. */
  competitor_count: number;
  /** Optional: avg of recent clearing prices for this zone (USDC). */
  recent_clearing_avg_usdc?: number;
  /** Suggested duration for the placement, seconds. */
  suggested_duration_s: number;
};

/**
 * What the manager (Stage 2) already decided. The brand-agent uses this
 * as a calibrating signal — `moment_quality` informs how aggressive the
 * opening should be; `brand_match` tells the brand "the manager thinks
 * you fit", which lifts confidence on the fit_multiplier.
 */
export type ManagerDecisionSummary = {
  should_emit: boolean;
  moment_quality: number;
  brand_match: number;
  reason: string;
};

/** Per-call audit entry. Aggregated into `agent_reasoning` for the winner. */
export type GatePathEntry =
  | { gate: 1; pass: true; latency_ms: number }
  | { gate: 1; pass: false; skip: GateSkipReason; latency_ms: number }
  | {
      gate: 3;
      pass: true;
      confidence: number;
      ad_id_candidate: string | null;
      latency_ms: number;
    }
  | { gate: 3; pass: false; skip: GateSkipReason; latency_ms: number }
  | { gate: 3; bypassed: "always_bid_floor"; latency_ms: 0 }
  | {
      gate: 4;
      pass: true;
      bid_usdc: number;
      ad_id: string;
      reason: string;
      latency_ms: number;
    }
  | { gate: 4; pass: false; reason: string; latency_ms: number };

export type HuntForBrandArgs = {
  brand: LoadedBrand;
  /** Compatible with both `ContextChunk` (manager) and synthetic harness ticks. */
  context: Gate1Context;
  /** Optional — gate1 reads `preferred_categories` from here when present. */
  stream?: StreamMetadata | null;
  market_signals: MarketSignals;
  manager_decision: ManagerDecisionSummary;
  /**
   * Off-chain available balance after holds (DESIGN.md §4 soft-hold ledger).
   * The Sonnet prompt clamps `max_acceptable_usdc` against this.
   */
  available_balance_usdc: number;
  /** Anthropic key. Required unless `dryRun: true`. */
  apiKey?: string;
  /** Sonnet model id for gate4. Default `claude-sonnet-4-6`. */
  model?: string;
  /** Haiku model id for gate3. Default `claude-haiku-4-5`. */
  gate3Model?: string;
  /** Defaults to `new Date()` — injectable for daypart determinism. */
  now?: Date;
  /**
   * Stub mode: skips the Sonnet call and synthesises a deterministic
   * decision. Used by the harness + by orchestrators when
   * `MANAGER_DRY_RUN=true`.
   */
  dryRun?: boolean;
};

export type HuntResult = {
  decision: BrandAgentDecision;
  /** Every gate evaluation, in order. The last entry's gate matches the verdict. */
  gate_path: GatePathEntry[];
  latency_ms: number;
};

// ─── Implementation ──────────────────────────────────────────────────

const TOOL_NAME = "emit_brand_agent_decision";

export async function huntForBrand(args: HuntForBrandArgs): Promise<HuntResult> {
  const t0 = Date.now();
  const gatePath: GatePathEntry[] = [];

  // ── Gate 1 — deterministic mandate filter ───────────────────────
  const tGate1Start = Date.now();
  const gate1 = evaluateGate1({
    brandId: args.brand.slug,
    brandDisplayName: args.brand.payload.display_name,
    mandate: args.brand.payload,
    ext: args.brand.ext,
    context: args.context,
    stream: args.stream ?? null,
    now: args.now,
  });
  const gate1Latency = Date.now() - tGate1Start;

  if (!gate1.pass) {
    gatePath.push({
      gate: 1,
      pass: false,
      skip: gate1.skip,
      latency_ms: gate1Latency,
    });
    logHunt(args, gatePath, "skip:gate1");
    return {
      decision: {
        should_bid: false,
        reason: gate1.skip.human_message,
      },
      gate_path: gatePath,
      latency_ms: Date.now() - t0,
    };
  }
  gatePath.push({ gate: 1, pass: true, latency_ms: gate1Latency });

  // ── Gate 3 — Haiku triage (skip for default bidder) ─────────────
  // GATES.md §2.1: brands with `always_bid_floor: true` (TermoFlex) bypass
  // gate3 — the default bidder must always reach gate4 to emit a floor offer.
  let gate3AdCandidate: string | null = null;
  let gate3Reason: string | null = null;

  if (args.brand.payload.always_bid_floor) {
    gatePath.push({ gate: 3, bypassed: "always_bid_floor", latency_ms: 0 });
  } else {
    if (!args.dryRun && !args.apiKey) {
      throw new Error(
        "huntForBrand: apiKey required for gate3 unless dryRun=true",
      );
    }
    if (args.dryRun) {
      // Stub: echo the brand's match_keywords vs audio. Mirrors makeStubPicker.
      const text = (args.context.audio_text ?? "").toLowerCase();
      const hit = args.brand.match_keywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
      const t = Date.now() - t0;
      if (hit) {
        gate3AdCandidate = args.brand.ad_variants[0]?.name ?? null;
        gate3Reason = `[DRY_RUN] keyword match en audio_text → ${args.brand.slug}`;
        gatePath.push({
          gate: 3,
          pass: true,
          confidence: 0.85,
          ad_id_candidate: gate3AdCandidate,
          latency_ms: 0,
        });
      } else {
        const skip: GateSkipReason = {
          brand_id: args.brand.slug,
          brand_display_name: args.brand.payload.display_name,
          gate: 3,
          code: "triage_should_not_bid",
          detail: "[DRY_RUN] sin keyword match",
          human_message: `${args.brand.payload.display_name} → SKIP gate3: [DRY_RUN] sin keyword match`,
        };
        gatePath.push({ gate: 3, pass: false, skip, latency_ms: 0 });
        logHunt(args, gatePath, "skip:gate3", t);
        return {
          decision: { should_bid: false, reason: skip.human_message },
          gate_path: gatePath,
          latency_ms: Date.now() - t0,
        };
      }
    } else {
      const tGate3Start = Date.now();
      const gate3 = await evaluateGate3({
        brandId: args.brand.slug,
        brandDisplayName: args.brand.payload.display_name,
        mandate: args.brand.payload,
        prompt: args.brand.prompt,
        context: args.context,
        ad_variant_names: args.brand.ad_variants.map((v) => v.name),
        apiKey: args.apiKey!,
        model: args.gate3Model,
      });
      const gate3Latency = Date.now() - tGate3Start;
      if (!gate3.pass) {
        gatePath.push({
          gate: 3,
          pass: false,
          skip: gate3.skip,
          latency_ms: gate3Latency,
        });
        logHunt(args, gatePath, "skip:gate3");
        return {
          decision: { should_bid: false, reason: gate3.skip.human_message },
          gate_path: gatePath,
          latency_ms: Date.now() - t0,
        };
      }
      gate3AdCandidate = gate3.ad_id_candidate;
      gate3Reason = `Haiku triage OK · confidence=${gate3.confidence.toFixed(2)} · ad=${gate3.ad_id_candidate ?? "(any)"}`;
      gatePath.push({
        gate: 3,
        pass: true,
        confidence: gate3.confidence,
        ad_id_candidate: gate3.ad_id_candidate,
        latency_ms: gate3Latency,
      });
    }
  }

  // ── Gate 4 — Sonnet decision ────────────────────────────────────
  const tGate4Start = Date.now();
  const gate4 = await runGate4({
    args,
    gate3AdCandidate,
    gate3Reason,
  });
  const gate4Latency = Date.now() - tGate4Start;

  if (!gate4.success) {
    gatePath.push({
      gate: 4,
      pass: false,
      reason: gate4.reason,
      latency_ms: gate4Latency,
    });
    logHunt(args, gatePath, "skip:gate4");
    return {
      decision: { should_bid: false, reason: gate4.reason },
      gate_path: gatePath,
      latency_ms: Date.now() - t0,
    };
  }
  gatePath.push({
    gate: 4,
    pass: true,
    bid_usdc: gate4.decision.bid_usdc,
    ad_id: gate4.decision.ad_id,
    reason: gate4.decision.reasoning.fit_reasons[0] ?? "",
    latency_ms: gate4Latency,
  });

  logHunt(args, gatePath, "bid", Date.now() - t0);
  return {
    decision: gate4.decision,
    gate_path: gatePath,
    latency_ms: Date.now() - t0,
  };
}

// ─── Gate 4 implementation ───────────────────────────────────────────

type Gate4Out =
  | { success: true; decision: Extract<BrandAgentDecision, { should_bid: true }> }
  | { success: false; reason: string };

async function runGate4(opts: {
  args: HuntForBrandArgs;
  gate3AdCandidate: string | null;
  gate3Reason: string | null;
}): Promise<Gate4Out> {
  const { args, gate3AdCandidate, gate3Reason } = opts;

  if (args.dryRun) {
    return stubGate4(args, gate3AdCandidate, gate3Reason);
  }
  if (!args.apiKey) {
    return { success: false, reason: "ANTHROPIC_API_KEY missing for gate4" };
  }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: args.apiKey });

  const adVariantNames = args.brand.ad_variants.map((v) => v.name);
  const tool = buildGate4Tool(adVariantNames);
  const userPrompt = renderGate4Prompt(args, gate3AdCandidate, gate3Reason);
  const systemPrompt = renderGate4System(args.brand);

  console.log(
    JSON.stringify({
      tag: "gate4:call_start",
      brand_id: args.brand.slug,
      model: args.model ?? "claude-sonnet-4-6",
      ad_variant_count: adVariantNames.length,
      always_bid_floor: !!args.brand.payload.always_bid_floor,
    }),
  );

  let toolUse: Anthropic.ToolUseBlock | undefined;
  try {
    const response = await client.messages.create({
      model: args.model ?? "claude-sonnet-4-6",
      max_tokens: 800,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });
    toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({ tag: "gate4:error", brand_id: args.brand.slug, error: msg }),
    );
    return { success: false, reason: `gate4 LLM error: ${msg}` };
  }

  if (!toolUse) {
    return { success: false, reason: "Sonnet no llamó la tool de decisión" };
  }

  const out = toolUse.input as RawGate4ToolInput;
  console.log(
    JSON.stringify({
      tag: "gate4:decision",
      brand_id: args.brand.slug,
      should_bid: out.should_bid,
      bid_usdc: out.bid_usdc,
      ad_id: out.ad_id,
    }),
  );

  return shapeGate4Decision(args, out);
}

type RawGate4ToolInput = {
  should_bid?: boolean;
  ad_id?: string | null;
  zone?: ZoneId;
  bid_usdc?: number;
  duration_s?: number;
  exclusivity_s?: number;
  opening_message?: string;
  reasoning?: Partial<BrandValuation>;
  skip_reason?: string;
};

function shapeGate4Decision(
  args: HuntForBrandArgs,
  out: RawGate4ToolInput,
): Gate4Out {
  if (!out.should_bid) {
    return {
      success: false,
      reason: out.skip_reason || "Sonnet decidió no pujar (sin razón explícita)",
    };
  }

  const ms = args.market_signals;
  const adId = pickAdId(args, out.ad_id);
  const zone = (out.zone ?? ms.zone) as ZoneId;
  const minBid = args.brand.payload.min_bid_usdc;
  const maxBid = args.brand.payload.max_bid_usdc;
  const balanceCap = Math.max(0, args.available_balance_usdc);
  const ceiling = Math.min(maxBid, balanceCap);
  const floorEffective = Math.max(ms.zone_floor_usdc, minBid);
  const rawBid = Number(out.bid_usdc ?? 0);
  const bid = Number.isFinite(rawBid)
    ? Math.max(floorEffective, Math.min(ceiling, rawBid))
    : floorEffective;

  const reasoning: BrandValuation = {
    brand_fit_multiplier: clamp01x2(out.reasoning?.brand_fit_multiplier ?? 1.0),
    fit_reasons:
      Array.isArray(out.reasoning?.fit_reasons) && out.reasoning!.fit_reasons!.length > 0
        ? out.reasoning!.fit_reasons!
        : ["sin razones explícitas — fallback"],
    perceived_value_usdc: numOr(out.reasoning?.perceived_value_usdc, ms.fair_value_usdc),
    max_acceptable_usdc: numOr(out.reasoning?.max_acceptable_usdc, ceiling),
    opening_factor: clamp(out.reasoning?.opening_factor, 0.55, 0.95, 0.7),
    opening_bid_usdc: bid,
    competitive_assumption:
      out.reasoning?.competitive_assumption ??
      `${ms.competitor_count} competidor(es) esperados en ${zone}`,
  };

  if (bid < floorEffective) {
    return {
      success: false,
      reason: `bid ${bid.toFixed(2)} < floor efectivo ${floorEffective.toFixed(2)}`,
    };
  }

  return {
    success: true,
    decision: {
      should_bid: true,
      ad_id: adId,
      zone,
      bid_usdc: bid,
      duration_s: clamp(out.duration_s, 5, 60, ms.suggested_duration_s),
      exclusivity_s: out.exclusivity_s != null ? clamp(out.exclusivity_s, 0, 60, 0) : undefined,
      opening_message: trimMessage(out.opening_message ?? args.brand.payload.display_name),
      reasoning,
    },
  };
}

function pickAdId(args: HuntForBrandArgs, requested: string | null | undefined): string {
  const variantNames = args.brand.ad_variants.map((v) => v.name);
  if (requested && variantNames.includes(requested)) return requested;
  if (variantNames.length > 0) return variantNames[0]!;
  // No catalog: fall back to the brand slug. Auction layer accepts ad_id as
  // a string, the rendered overlay reads from `brand.ad.asset_url` separately.
  return args.brand.slug;
}

function stubGate4(
  args: HuntForBrandArgs,
  gate3AdCandidate: string | null,
  gate3Reason: string | null,
): Gate4Out {
  const ms = args.market_signals;
  const minBid = args.brand.payload.min_bid_usdc;
  const maxBid = args.brand.payload.max_bid_usdc;
  const balanceCap = Math.max(0, args.available_balance_usdc);
  const ceiling = Math.min(maxBid, balanceCap);
  const fairValue = ms.fair_value_usdc;

  // Default bidder always emits at the floor.
  if (args.brand.payload.always_bid_floor) {
    const bid = Math.max(minBid, ms.zone_floor_usdc);
    return {
      success: true,
      decision: {
        should_bid: true,
        ad_id: pickAdId(args, gate3AdCandidate),
        zone: ms.zone,
        bid_usdc: bid,
        duration_s: ms.suggested_duration_s,
        opening_message: `${args.brand.payload.display_name}: tu setup, siempre frío.`,
        reasoning: {
          brand_fit_multiplier: 1.0,
          fit_reasons: ["[DRY_RUN] always_bid_floor — emite al floor"],
          perceived_value_usdc: fairValue,
          max_acceptable_usdc: ceiling,
          opening_factor: 0.6,
          opening_bid_usdc: bid,
          competitive_assumption: `${ms.competitor_count} competidor(es) — default bidder`,
        },
      },
    };
  }

  // Premium episodic: open at fair_value × 0.7, capped to ceiling.
  const opening = Math.min(ceiling, Math.max(minBid, fairValue * 0.7));
  return {
    success: true,
    decision: {
      should_bid: true,
      ad_id: pickAdId(args, gate3AdCandidate),
      zone: ms.zone,
      bid_usdc: opening,
      duration_s: ms.suggested_duration_s,
      opening_message: `${args.brand.payload.display_name}: este momento es nuestro.`,
      reasoning: {
        brand_fit_multiplier: 1.2,
        fit_reasons: [
          gate3Reason ?? "[DRY_RUN] gate3 bypassed",
          "[DRY_RUN] stub gate4 — opening = fair_value × 0.7",
        ],
        perceived_value_usdc: fairValue,
        max_acceptable_usdc: ceiling,
        opening_factor: 0.7,
        opening_bid_usdc: opening,
        competitive_assumption: `${ms.competitor_count} competidor(es) — episodic`,
      },
    },
  };
}

// ─── Sonnet prompting ────────────────────────────────────────────────

function renderGate4System(brand: LoadedBrand): string {
  const persona = brand.prompt?.system_persona?.trim() || brand.payload.brand_voice || "(sin persona)";
  const dontSay =
    brand.prompt?.dont_say && brand.prompt.dont_say.length > 0
      ? `\nNUNCA digas: ${brand.prompt.dont_say.join(", ")}`
      : "";
  const dontDo =
    brand.prompt?.dont_do && brand.prompt.dont_do.length > 0
      ? `\nEvitá: ${brand.prompt.dont_do.join(", ")}`
      : "";
  return `Sos el brand-agent de ${brand.payload.display_name}. Acabás de pasar gate1 (mandate determinístico) y gate3 (Haiku triage). Te toca decidir si pujar y a qué precio.

Tu persona:
${persona}${dontSay}${dontDo}

Reglas:
- should_bid=true si la perceived_value_usdc ≥ min_bid_usdc del mandate.
- bid_usdc inicial = max_acceptable × opening_factor (0.55–0.95). NUNCA arriba de max_acceptable.
- max_acceptable = min(perceived_value × 0.85, max_bid_usdc, available_balance × 0.30).
- ad_id: elegí del catálogo provisto. Si no calza ninguno, mejor should_bid=false.
- opening_message: español rioplatense, ≤25 palabras, en voz de la brand. Es el primer turno de la negociación.
- reasoning: rellená TODOS los campos. Es el audit que firma esta puja.`;
}

function renderGate4Prompt(
  args: HuntForBrandArgs,
  gate3AdCandidate: string | null,
  gate3Reason: string | null,
): string {
  const m = args.brand.payload;
  const ms = args.market_signals;
  const md = args.manager_decision;
  const ctx = args.context;
  const lines: string[] = [];

  lines.push(`## MANDATE`);
  lines.push(`- min_bid_usdc: ${m.min_bid_usdc}`);
  lines.push(`- max_bid_usdc: ${m.max_bid_usdc}`);
  lines.push(`- daily_cap_usdc: ${m.daily_cap_usdc}`);
  lines.push(`- spent_today_usdc: ${m.spent_today_usdc ?? 0}`);
  lines.push(`- always_bid_floor: ${m.always_bid_floor ?? false}`);
  lines.push(`- target_moods: [${m.targeting.moods.join(", ")}]`);
  lines.push(``);

  lines.push(`## BALANCE`);
  lines.push(`- available_balance_usdc: ${args.available_balance_usdc.toFixed(2)} (post-holds)`);
  lines.push(``);

  lines.push(`## AD CATALOG`);
  if (args.brand.ad_variants.length === 0) {
    lines.push(`- (vacío) — usar slug "${args.brand.slug}" como ad_id fallback`);
  } else {
    for (const v of args.brand.ad_variants) {
      lines.push(`- ${v.name} · zone=${v.zone} · ${v.duration_ms}ms · moods=[${v.mood_tags.join(", ")}]`);
    }
  }
  if (gate3AdCandidate) lines.push(`- gate3 sugiere: ${gate3AdCandidate}`);
  lines.push(``);

  lines.push(`## MARKET SIGNALS`);
  lines.push(`- recommended_zone: ${ms.zone} (floor=$${ms.zone_floor_usdc})`);
  lines.push(`- fair_value_usdc: $${ms.fair_value_usdc.toFixed(2)}`);
  lines.push(`- suggested_duration_s: ${ms.suggested_duration_s}`);
  lines.push(`- competitor_count: ${ms.competitor_count}`);
  if (ms.recent_clearing_avg_usdc != null) {
    lines.push(`- recent_clearing_avg_usdc: $${ms.recent_clearing_avg_usdc.toFixed(2)}`);
  }
  lines.push(``);

  lines.push(`## MANAGER DECISION (gate1+stage2)`);
  lines.push(`- moment_quality: ${md.moment_quality.toFixed(2)}`);
  lines.push(`- brand_match: ${md.brand_match.toFixed(2)}`);
  lines.push(`- reason: ${md.reason}`);
  lines.push(``);

  lines.push(`## GATES PRIOR`);
  lines.push(`- gate1: PASS (mandate determinístico OK)`);
  if (m.always_bid_floor) {
    lines.push(`- gate3: BYPASS (always_bid_floor)`);
  } else {
    lines.push(`- gate3: PASS — ${gate3Reason ?? "(sin nota)"}`);
  }
  lines.push(``);

  lines.push(`## CHUNK CONTEXT`);
  lines.push(`- audio_text: ${truncate(ctx.audio_text ?? "", 400) || "(vacío)"}`);
  lines.push(`- audio_mentions: [${(ctx.audio_mentions ?? []).slice(0, 8).join(", ")}]`);
  lines.push(`- audio_topics: [${(ctx.audio_topics ?? []).slice(0, 8).join(", ")}]`);
  lines.push(`- mood_tags: [${(ctx.mood_tags ?? []).slice(0, 6).join(", ")}]`);
  lines.push(`- viewers: ${ctx.viewers ?? "?"}`);
  lines.push(``);

  lines.push(`Decidí ahora — llamá la tool ${TOOL_NAME}.`);
  return lines.join("\n");
}

function buildGate4Tool(adVariantNames: string[]): Anthropic.Tool {
  const adIdSchema =
    adVariantNames.length > 0
      ? { type: ["string", "null"], enum: [...adVariantNames, null] }
      : { type: ["string", "null"] };
  return {
    name: TOOL_NAME,
    description:
      "Emite la decisión final del brand-agent: si pujar (con bid + opening_message + reasoning) o no.",
    input_schema: {
      type: "object",
      properties: {
        should_bid: { type: "boolean" },
        ad_id: {
          ...adIdSchema,
          description:
            "Nombre del ad variant del catálogo. Null si no calza ninguno (en cuyo caso should_bid=false).",
        },
        zone: {
          type: "string",
          enum: ["lower_third", "bottom_right_corner", "fullscreen_takeover"],
          description: "Zona donde se renderiza. Default = market_signals.recommended_zone.",
        },
        bid_usdc: {
          type: "number",
          description: "Opening bid USDC. Debe estar entre floor efectivo y max_acceptable.",
        },
        duration_s: {
          type: "number",
          description: "Segundos del placement (5–60).",
        },
        exclusivity_s: {
          type: "number",
          description: "Lockout post-placement (0–60). 0 = sin exclusividad.",
        },
        opening_message: {
          type: "string",
          description: "Primer turno de negociación. Español rioplatense, ≤25 palabras, en voz del brand.",
        },
        reasoning: {
          type: "object",
          properties: {
            brand_fit_multiplier: { type: "number", description: "0.4–2.0" },
            fit_reasons: {
              type: "array",
              items: { type: "string" },
              description: "Bullets cortos del por qué calza.",
            },
            perceived_value_usdc: { type: "number" },
            max_acceptable_usdc: { type: "number" },
            opening_factor: { type: "number", description: "0.55–0.95" },
            opening_bid_usdc: { type: "number" },
            competitive_assumption: {
              type: "string",
              description: "Una oración: qué competencia asumiste para el opening.",
            },
          },
          required: [
            "brand_fit_multiplier",
            "fit_reasons",
            "perceived_value_usdc",
            "max_acceptable_usdc",
            "opening_factor",
            "opening_bid_usdc",
            "competitive_assumption",
          ],
        },
        skip_reason: {
          type: "string",
          description: "Solo si should_bid=false. Español, 1 oración.",
        },
      },
      required: ["should_bid"],
    },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function clamp01x2(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0.4, Math.min(2.0, n));
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function trimMessage(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  // Soft cap at ~25 words; the prompt requests it but we don't hard-truncate
  // mid-word — just collapse runaway whitespace.
  return flat.length > 240 ? flat.slice(0, 240) : flat;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function logHunt(
  args: HuntForBrandArgs,
  gatePath: GatePathEntry[],
  outcome: string,
  totalMs?: number,
): void {
  console.log(
    JSON.stringify({
      tag: "hunt:result",
      brand_id: args.brand.slug,
      outcome,
      gate_path: gatePath.map((e) => ({
        gate: e.gate,
        ...("pass" in e ? { pass: e.pass } : {}),
        ...("bypassed" in e ? { bypassed: e.bypassed } : {}),
        ...("skip" in e ? { code: e.skip.code } : {}),
        ...("bid_usdc" in e ? { bid_usdc: e.bid_usdc } : {}),
        latency_ms: e.latency_ms,
      })),
      total_ms: totalMs,
    }),
  );
}

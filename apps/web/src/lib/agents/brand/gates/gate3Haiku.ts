/**
 * Gate3 — cheap-LLM triage with Claude Haiku 4.5 (C-08c).
 *
 * Per-brand binary "should this brand even spend Sonnet tokens evaluating
 * this moment?". Catches voice/persona mismatches that survive gate1's
 * mandate booleans (e.g. CafetITO premium clutch but chat is toxic).
 *
 * Spec: docs/GATES.md §2 + §8.3. ~150 tokens IN, ~50 tokens OUT,
 * ~$0.0008 per call, ~200ms p95.
 *
 * NOT yet wired into the cron flow (manager picker is a single Haiku call
 * across all surviving brands). Wires in via C-08d when the runner moves
 * to per-brand brand-agents. For now the function is callable + smoke-
 * tested standalone (`apps/web/scripts/smoke-gate3.mts`).
 *
 * Lazy import of `@anthropic-ai/sdk` so dry-run consumers (harness, unit
 * tests) don't need the SDK installed locally — same pattern as
 * `manager/pickBrand.ts`.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type {
  BrandMandate,
  BrandPrompt,
  Gate1Context,
  Gate3ReasonCode,
  GateSkipReason,
} from "../../types";

export type Gate3Result =
  | { pass: true; ad_id_candidate: string | null; confidence: number; latency_ms: number }
  | { pass: false; skip: GateSkipReason; latency_ms: number };

export type Gate3Args = {
  brandId: string;
  brandDisplayName: string;
  mandate: BrandMandate;
  prompt: BrandPrompt | null;
  context: Gate1Context;
  /** Available ad library variant names (e.g. ["epic_goal_lower","clutch_lower"]). */
  ad_variant_names?: string[];
  apiKey: string;
  /** Defaults to `claude-haiku-4-5`. */
  model?: string;
  /** Defaults to 0.5 (per docs/GATES.md §8.3). */
  confidence_floor?: number;
};

const TOOL_NAME = "emit_gate3_decision";

/**
 * Defines the Haiku tool_use schema. Kept narrow — Haiku is cheaper +
 * more consistent when forced to a tool call than free-form JSON.
 */
function buildTool(adVariantNames: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description:
      "Decide si esta brand debería seguir negociando este momento. Binario should_proceed + confidence + ad_id_candidate (uno del catálogo).",
    input_schema: {
      type: "object",
      properties: {
        should_proceed: {
          type: "boolean",
          description:
            "true si el momento calza con la voice/persona del brand y vale gastar tokens de Sonnet para negociar; false si no.",
        },
        confidence: {
          type: "number",
          description: "0..1 — qué tan seguro estás del veredicto.",
        },
        ad_id_candidate: adVariantNames.length
          ? {
              type: ["string", "null"],
              enum: [...adVariantNames, null],
              description: "Nombre del ad variant del catálogo que mejor calza, o null si ninguno.",
            }
          : { type: ["string", "null"], description: "Null si el brand no tiene catálogo." },
        reason: {
          type: "string",
          description:
            "Español, 1 oración corta. Audit-friendly: por qué calza o no la voice/persona.",
        },
      },
      required: ["should_proceed", "confidence", "ad_id_candidate", "reason"],
    },
  };
}

const SYSTEM_PROMPT = `Sos el triage agent de una brand específica. Tu trabajo: decidir, en una sola pasada barata, si vale la pena que el brand-agent principal (Claude Sonnet, caro) se gaste tokens evaluando este momento.

Reglas:
- Mirá la voice/persona del brand (system_persona, voice_examples, target_moods, blocked_keywords).
- Mirá el contexto del momento (audio_text + audio_mentions + audio_topics + mood_tags).
- Decidí should_proceed: true si la voice/persona calza con el momento, false si no.
- confidence < 0.5 cuando no estás seguro → el caller te marca como triage_low_confidence (rechaza igual).
- Si hay ad_variants disponibles, elegí el que mejor calce con el momento (puede ser null si ninguno aplica claro).
- reason: español, 1 oración. Audit, no marketing.`;

/**
 * Single-shot evaluator. Builds the Anthropic client lazily and caches it
 * on the closure scope so repeated calls in the same process amortize the
 * import cost.
 */
let cachedClient: { key: string; client: Promise<Anthropic> } | null = null;

export async function evaluateGate3(args: Gate3Args): Promise<Gate3Result> {
  const startedAt = Date.now();
  const model = args.model ?? "claude-haiku-4-5";
  const confidenceFloor = args.confidence_floor ?? 0.5;
  const adVariantNames = args.ad_variant_names ?? [];

  if (cachedClient?.key !== args.apiKey) {
    cachedClient = {
      key: args.apiKey,
      client: import("@anthropic-ai/sdk").then((m) => new m.default({ apiKey: args.apiKey })),
    };
  }
  const client = await cachedClient.client;

  const userPrompt = renderUserPrompt(args);
  console.log(
    JSON.stringify({
      tag: "gate3:call_start",
      brand_id: args.brandId,
      model,
      ad_variant_count: adVariantNames.length,
    }),
  );

  let toolUse: Anthropic.ToolUseBlock | undefined;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      tools: [buildTool(adVariantNames)],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });
    toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
  } catch (err) {
    const latency = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        tag: "gate3:error",
        brand_id: args.brandId,
        latency_ms: latency,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Fail-closed: error → skip with low_confidence.
    return failClosed(args, latency, "error contacting Haiku");
  }

  const latency = Date.now() - startedAt;

  if (!toolUse) {
    console.log(
      JSON.stringify({
        tag: "gate3:no_tool_use",
        brand_id: args.brandId,
        latency_ms: latency,
      }),
    );
    return failClosed(args, latency, "Haiku no llamó la tool");
  }

  const out = toolUse.input as {
    should_proceed?: boolean;
    confidence?: number;
    ad_id_candidate?: string | null;
    reason?: string;
  };
  const should = Boolean(out.should_proceed);
  const confidence = Math.max(0, Math.min(1, Number(out.confidence ?? 0)));
  const adId = out.ad_id_candidate ?? null;
  const reason = String(out.reason ?? "").trim();

  console.log(
    JSON.stringify({
      tag: "gate3:decision",
      brand_id: args.brandId,
      should_proceed: should,
      confidence,
      ad_id_candidate: adId,
      latency_ms: latency,
      reason,
    }),
  );

  if (!should) {
    return {
      pass: false,
      skip: skipReason(args, "triage_should_not_bid", reason || "Haiku rechaza el momento"),
      latency_ms: latency,
    };
  }
  if (confidence < confidenceFloor) {
    return {
      pass: false,
      skip: skipReason(
        args,
        "triage_low_confidence",
        reason || `confidence ${confidence.toFixed(2)} < ${confidenceFloor}`,
      ),
      latency_ms: latency,
    };
  }
  return { pass: true, ad_id_candidate: adId, confidence, latency_ms: latency };
}

// ─── helpers ─────────────────────────────────────────────────────────

function failClosed(args: Gate3Args, latency_ms: number, reason: string): Gate3Result {
  return {
    pass: false,
    skip: skipReason(args, "triage_low_confidence", reason),
    latency_ms,
  };
}

function skipReason(
  args: Gate3Args,
  code: Gate3ReasonCode,
  detail: string,
): GateSkipReason {
  return {
    brand_id: args.brandId,
    brand_display_name: args.brandDisplayName,
    gate: 3,
    code,
    detail,
    human_message: `${args.brandDisplayName} → SKIP gate3: ${detail}`,
  };
}

function renderUserPrompt(args: Gate3Args): string {
  const c = args.context;
  const lines: string[] = [];
  lines.push(`## BRAND`);
  lines.push(`- brand_id: ${args.brandId} (${args.brandDisplayName})`);
  lines.push(`- voice: ${args.mandate.brand_voice || "(sin tono explícito)"}`);
  lines.push(`- target_moods: [${args.mandate.targeting.moods.join(", ")}]`);
  if (args.prompt) {
    lines.push(`- system_persona: ${truncate(args.prompt.system_persona, 280)}`);
    if (args.prompt.voice_examples.length) {
      lines.push(`- voice_examples: ${args.prompt.voice_examples.slice(0, 3).join(" / ")}`);
    }
    if (args.prompt.dont_say.length) {
      lines.push(`- dont_say: [${args.prompt.dont_say.slice(0, 6).join(", ")}]`);
    }
  }
  if (args.ad_variant_names && args.ad_variant_names.length) {
    lines.push(`- ad_variants: [${args.ad_variant_names.join(", ")}]`);
  }
  lines.push("");
  lines.push(`## CONTEXTO DEL MOMENTO`);
  lines.push(`- audio_text: ${truncate(c.audio_text ?? "", 320) || "(vacío)"}`);
  lines.push(`- audio_mentions: [${(c.audio_mentions ?? []).slice(0, 8).join(", ")}]`);
  lines.push(`- audio_topics: [${(c.audio_topics ?? []).slice(0, 8).join(", ")}]`);
  lines.push(`- mood_tags: [${(c.mood_tags ?? []).slice(0, 6).join(", ")}]`);
  lines.push(`- scene_type: ${c.scene_type ?? "(none)"}`);
  lines.push(`- viewers: ${c.viewers ?? "?"}`);
  lines.push("");
  lines.push("Decidí ahora — llamá la tool emit_gate3_decision.");
  return lines.join("\n");
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

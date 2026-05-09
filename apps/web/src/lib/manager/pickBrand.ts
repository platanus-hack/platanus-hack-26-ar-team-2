/**
 * Stage 2 — Claude Haiku picks (or skips) a brand for the chunk.
 *
 * Brands are loaded dynamically from YAML files in
 * `apps/web/src/lib/agents/brands/*.yaml`. Each YAML has a `description`
 * field that Claude uses to decide if the audio matches the brand.
 *
 * Stub picker available for `MANAGER_DRY_RUN=true` (no API key needed).
 */

// Type-only import — runtime require() is deferred to makeClaudePicker so
// dry-run flows (stub picker) and harnesses (C-08test) work without the SDK
// installed locally.
import type Anthropic from "@anthropic-ai/sdk";

import {
  loadBrandMandates,
  type LoadedBrand,
} from "@/lib/agents/brands/loader";

import type { BrandPick, ContextChunk } from "./types";

// ─── Cached brand list (loaded once from YAMLs per process) ──────────

let _brandsCache: LoadedBrand[] | null = null;

export function getLoadedBrands(): LoadedBrand[] {
  if (!_brandsCache) {
    _brandsCache = loadBrandMandates();
  }
  return _brandsCache;
}

// ─── System prompt ───────────────────────────────────────────────────

function buildSystemPrompt(brands: LoadedBrand[]): string {
  const brandIds = brands.map((b) => b.slug).join("/");
  return `Sos el manager de placements de Addie. Recibís un resumen semántico del audio de un stream en vivo (ventana rolling de ~30s) y la lista de brands disponibles con su descripción de cuándo mostrar el ad.

Tu ÚNICO trabajo: decidir si el momento actual matchea alguna brand del registry. Usá la descripción de cada brand como guía principal para decidir.

Tres signals semánticos del chunk, en orden de confianza:
1. **audio_mentions[]** — entidades concretas que el speaker nombró. Match directo con match_keywords de una brand → señal fuerte.
2. **audio_intent** (enum: discussion|recommendation|complaint|question|reaction|silence) — qué está haciendo el speaker.
3. **audio_summary + audio_topics[]** — contexto temático para inferir match cuando no hay mention literal.

Reglas:
- Compará la descripción de cada brand contra el audio del chunk. Si calza → should_emit=true.
- Si el chunk tiene una mention que matchea match_keywords → señal fuerte, brand_match≥0.8.
- Si no hay mention pero la descripción calza con el contexto → should_emit=true, brand_match 0.5-0.75.
- Si no hay match razonable → should_emit=false, brand_id=null, message="...".
- moment_quality refleja qué tan auctionable es el momento (energía, intent, engagement). Independiente de qué brand calce.
- reason: español, 1 oración, audit-friendly.
- message: SIEMPRE exactamente el display_name de la brand elegida o "..." si no hay match.
- brand_id DEBE ser uno de: ${brandIds} (o null si no hay match).`;
}

// ─── Tool schema ─────────────────────────────────────────────────────

function buildTool(brands: LoadedBrand[]): Anthropic.Tool {
  const brandIds = brands.map((b) => b.slug).join("/");
  return {
    name: TOOL_NAME,
    description:
      "Emite la decisión final del manager: si pautar, qué brand elegir, y los scores de calidad/match.",
    input_schema: {
      type: "object",
      properties: {
        should_emit: {
          type: "boolean",
          description: "true si el audio se relaciona con alguna brand, false si no.",
        },
        brand_id: {
          type: ["string", "null"],
          description: `El brand_id exacto del registry (${brandIds}), o null si no hay match.`,
        },
        moment_quality: {
          type: "number",
          description: "0..1 — qué tan auctionable es el momento por sí solo.",
        },
        brand_match: {
          type: "number",
          description: "0..1 — qué tan bien la brand elegida calza con este momento.",
        },
        reason: {
          type: "string",
          description: "Español, ≤2 oraciones. Explica el call (audit).",
        },
        message: {
          type: ["string", "null"],
          description:
            "Exactamente el display_name de la brand elegida o '...' si no hay match.",
        },
      },
      required: [
        "should_emit",
        "brand_id",
        "moment_quality",
        "brand_match",
        "reason",
        "message",
      ],
    },
  };
}

const TOOL_NAME = "emit_decision";

/**
 * Picker signature. `brands` is OPTIONAL — if omitted, the picker reads
 * the full cached YAML registry via `getLoadedBrands()`. If provided,
 * the picker only considers that list. This is the integration point
 * for the gate ladder (C-08a `applyGateLadder`) which pre-filters
 * brands before LLM evaluation.
 */
export type Picker = (
  chunk: ContextChunk,
  brands?: LoadedBrand[],
) => Promise<BrandPick>;

export function makeClaudePicker(apiKey: string, model: string): Picker {
  let clientPromise: Promise<Anthropic> | null = null;

  return async function pickBrand(chunk, brandsOverride) {
    const t0 = Date.now();

    const brands = brandsOverride ?? getLoadedBrands();
    if (brands.length === 0) {
      return {
        should_emit: false,
        brand_id: null,
        moment_quality: 0,
        brand_match: 0,
        reason: "gate1 filtró todos los brands — no hay candidatos",
        message: "...",
      };
    }

    if (!clientPromise) {
      clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey }),
      );
    }
    const client = await clientPromise;
    const tSdkInit = Date.now() - t0;

    const userPrompt = renderPrompt(chunk, brands);
    const systemPrompt = buildSystemPrompt(brands);
    const tool = buildTool(brands);
    const tPromptBuild = Date.now() - t0;

    const response = await client.messages.create({
      model,
      max_tokens: 600,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });
    const tApiCall = Date.now() - t0;

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) throw new Error("Claude did not call the tool");

    const out = toolUse.input as BrandPick;
    const result = {
      should_emit: Boolean(out.should_emit),
      brand_id: out.brand_id ?? null,
      moment_quality: Number(out.moment_quality ?? 0),
      brand_match: Number(out.brand_match ?? 0),
      reason: String(out.reason ?? ""),
      message: out.message ?? null,
    };
    const tTotal = Date.now() - t0;

    console.log(
      JSON.stringify({
        tag: "picker:ai_timing",
        model,
        chunk_id: chunk.id,
        stream_key: chunk.stream_key,
        sdk_init_ms: tSdkInit,
        prompt_build_ms: tPromptBuild - tSdkInit,
        api_call_ms: tApiCall - tPromptBuild,
        parse_ms: tTotal - tApiCall,
        total_ms: tTotal,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        brand_id: result.brand_id,
        should_emit: result.should_emit,
        brand_match: result.brand_match,
        reason: result.reason,
      }),
    );

    return result;
  };
}

/**
 * Heuristic stub picker — no API key needed.
 * Checks audio_text against each brand's match_keywords (case-insensitive).
 * Returns brand display_name if match found, "..." otherwise.
 */
export function makeStubPicker(): Picker {
  return async function pickBrand(chunk, brandsOverride) {
    const brands = brandsOverride ?? getLoadedBrands();
    if (brands.length === 0) {
      return {
        should_emit: false,
        brand_id: null,
        moment_quality: 0,
        brand_match: 0,
        reason: "[DRY_RUN] gate1 filtró todos los brands — no hay candidatos",
        message: "...",
      };
    }
    const text = (chunk.audio_text ?? "").toLowerCase();
    if (!text) {
      return {
        should_emit: true,
        brand_id: null,
        moment_quality: 0.1,
        brand_match: 0,
        reason: "[DRY_RUN] sin audio",
        message: "...",
      };
    }
    const match = brands.find((b) =>
      b.match_keywords.some((kw) => text.includes(kw.toLowerCase())),
    );
    if (!match) {
      return {
        should_emit: true,
        brand_id: null,
        moment_quality: 0.3,
        brand_match: 0,
        reason: "[DRY_RUN] ningún keyword de brand encontrado en audio_text",
        message: "...",
      };
    }
    return {
      should_emit: true,
      brand_id: match.slug,
      moment_quality: 0.7,
      brand_match: 0.8,
      reason: `[DRY_RUN] keyword match en audio_text → ${match.slug}`,
      message: match.payload.display_name,
    };
  };
}

// ─── Prompt rendering ────────────────────────────────────────────────

function renderPrompt(chunk: ContextChunk, brands: LoadedBrand[]): string {
  return [
    `## CHUNK SEMÁNTICO (ventana ${chunk.duration_s}s, stream "${chunk.stream_key}")`,
    "",
    `- audio_summary: ${truncate(chunk.audio_summary, 400) || "(sin resumen)"}`,
    `- audio_intent: ${chunk.audio_intent ?? "(null)"}`,
    `- audio_mentions: ${fmtArray(chunk.audio_mentions)}`,
    `- audio_topics: ${fmtArray(chunk.audio_topics)}`,
    `- viewers_delta_30s: ${chunk.viewers_delta_30s ?? 0}`,
    `- transcript bruto (referencia): ${truncate(chunk.audio_text, 400) || "(sin audio)"}`,
    "",
    `## BRANDS DISPONIBLES (${brands.length})`,
    "",
    ...brands.map(
      (b) =>
        `### ${b.slug} — ${b.payload.display_name}\n` +
        `- descripción: ${truncate(b.description, 400)}\n` +
        `- match_keywords: ${fmtArray(b.match_keywords)}`,
    ),
    "",
    "Decidí ahora. Compará la descripción de cada brand contra el audio. Priorizá audio_mentions (señal fuerte) sobre audio_summary (señal contextual). Llamá la tool `emit_decision` con tu output. Recordá: message = display_name exacto si matchea, o \"...\" si no.",
  ].join("\n");
}

function fmtArray(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "[]";
  return `[${arr.slice(0, 8).join(", ")}]`;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "(vacío)";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

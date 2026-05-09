/**
 * Stage 2 — Claude Haiku picks (or skips) a brand for the chunk.
 *
 * Returns explicit `moment_quality` + `brand_match` scores; the caller
 * thresholds on both. Two-score split lets the LLM say "epic moment but no
 * brand fits" honestly — instead of being forced to pick a poor match.
 *
 * Stub picker available for `MANAGER_DRY_RUN=true` (no API key needed).
 */

// Type-only import — runtime require() is deferred to makeClaudePicker so
// dry-run flows (stub picker) and harnesses (C-08test) work without the SDK
// installed locally.
import type Anthropic from "@anthropic-ai/sdk";

import { BRANDS, type Brand } from "@/lib/brands";

import type { BrandPick, ContextChunk } from "./types";

const SYSTEM_PROMPT = `Sos el manager de placements de Addie. Recibís un resumen semántico del audio de un stream en vivo (ventana rolling de ~30s) y la lista de brands disponibles con sus keywords + personas.

Tu ÚNICO trabajo: decidir si el momento actual matchea alguna brand del registry. Tres signals semánticos del chunk, en orden de confianza:
1. **audio_mentions[]** — entidades concretas que el speaker nombró (ej: "café", "mate"). Match directo con match_keywords de una brand → señal fuerte.
2. **audio_intent** (enum: discussion|recommendation|complaint|question|reaction|silence) — qué está haciendo el speaker. \`reaction\` y \`recommendation\` son los más auctionables; \`silence\` o \`complaint\` casi nunca.
3. **audio_summary + audio_topics[]** — contexto temático para inferir match cuando no hay mention literal (ej: "habla de cerrar una tx en pocos segundos" → analogía deportiva → CafetITO calza por persona).

Reglas:
- Si el chunk tiene una mention que matchea match_keywords de UNA brand → should_emit=true, brand_id=<el id>, brand_match≥0.8.
- Si no hay mention pero el contexto/intent calza la persona de UNA brand → should_emit=true, brand_match 0.5-0.75.
- Si no hay match razonable → should_emit=false, brand_id=null, message="...".
- moment_quality refleja qué tan auctionable es el momento por sí solo (energía, intent, viewer engagement). Independiente de qué brand calce.
- reason: español, 1 oración, audit-friendly.
- message: SIEMPRE exactamente el display_name de la brand elegida (ej: "☕ CafetITO", "🧉 MateBros") o "..." si no hay match.`;

const TOOL_NAME = "emit_decision";
const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Emite la decisión final del manager: si pautar, qué brand elegir, y los scores de calidad/match.",
  input_schema: {
    type: "object",
    properties: {
      should_emit: { type: "boolean", description: "true si el audio se relaciona con alguna brand, false si no." },
      brand_id: {
        type: ["string", "null"],
        description: "El brand_id exacto del registry (cafetito/termoflex/pancho-rex/matebros/platanus), o null si no hay match.",
      },
      moment_quality: { type: "number", description: "0..1 — qué tan auctionable es el momento por sí solo." },
      brand_match: { type: "number", description: "0..1 — qué tan bien la brand elegida calza con este momento." },
      reason: { type: "string", description: "Español, ≤2 oraciones. Explica el call (audit)." },
      message: {
        type: ["string", "null"],
        description: "Exactamente el display_name de la brand (ej: '☕ CafetITO', '🧉 MateBros') o '...' si no hay match.",
      },
    },
    required: ["should_emit", "brand_id", "moment_quality", "brand_match", "reason", "message"],
  },
};

export type Picker = (chunk: ContextChunk) => Promise<BrandPick>;

export function makeClaudePicker(apiKey: string, model: string): Picker {
  let clientPromise: Promise<Anthropic> | null = null;

  return async function pickBrand(chunk) {
    if (!clientPromise) {
      clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey }),
      );
    }
    const client = await clientPromise;
    const userPrompt = renderPrompt(chunk, BRANDS);

    const response = await client.messages.create({
      model,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) throw new Error("Claude did not call the tool");

    const out = toolUse.input as BrandPick;
    return {
      should_emit: Boolean(out.should_emit),
      brand_id: out.brand_id ?? null,
      moment_quality: Number(out.moment_quality ?? 0),
      brand_match: Number(out.brand_match ?? 0),
      reason: String(out.reason ?? ""),
      message: out.message ?? null,
    };
  };
}

/**
 * Heuristic stub picker — no API key needed.
 * Checks audio_text against each brand's match_keywords (case-insensitive).
 * Returns brand display_name if match found, "..." otherwise.
 */
export function makeStubPicker(): Picker {
  return async function pickBrand(chunk) {
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
    const match = BRANDS.find((b) =>
      b.match_keywords.some((kw) => text.includes(kw)),
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
      brand_id: match.id,
      moment_quality: 0.7,
      brand_match: 0.8,
      reason: `[DRY_RUN] keyword match en audio_text → ${match.id}`,
      message: match.display_name,
    };
  };
}

function renderPrompt(chunk: ContextChunk, brands: readonly Brand[]): string {
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
        `### ${b.id} — ${b.display_name}\n` +
        `- match_keywords: ${fmtArray(b.match_keywords)}\n` +
        `- persona: ${truncate(b.default_persona, 240)}`,
    ),
    "",
    "Decidí ahora. Priorizá audio_mentions (señal fuerte) sobre audio_summary (señal contextual). Llamá la tool `emit_decision` con tu output. Recordá: message = display_name exacto si matchea, o \"...\" si no.",
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

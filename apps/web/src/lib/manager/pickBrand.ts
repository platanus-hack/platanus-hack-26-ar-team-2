/**
 * Stage 2 — Claude Haiku picks (or skips) a brand for the chunk.
 *
 * Returns explicit `moment_quality` + `brand_match` scores; the caller
 * thresholds on both. Two-score split lets the LLM say "epic moment but no
 * brand fits" honestly — instead of being forced to pick a poor match.
 *
 * Stub picker available for `MANAGER_DRY_RUN=true` (no API key needed).
 */

import Anthropic from "@anthropic-ai/sdk";

import { BRANDS, type Brand } from "@/lib/brands";

import type { BrandPick, ContextChunk } from "./types";

const SYSTEM_PROMPT = `Sos el manager de placements de Addie. Recibís el texto transcripto del audio de un stream en vivo (últimos ~15-30 segundos) y la lista de brands disponibles con sus keywords de referencia.

Tu ÚNICO trabajo: decidir si el streamer mencionó algo relacionado con alguna de las brands. No tiene que ser una mención literal — si el contexto es claramente sobre el tema de una brand (ej: hablan de tomar algo y una brand es de bebidas), eso cuenta.

Reglas:
- Si el audio menciona o habla sobre algo relacionado con UNA de las brands → should_emit=true, brand_id=<el id>, message=<display_name de la brand>.
- Si el audio NO tiene nada que ver con ninguna brand → should_emit=false, brand_id=null, message="...".
- moment_quality y brand_match: poné valores razonables (0.8+ si es mención directa, 0.5-0.7 si es indirecta).
- reason: explicá brevemente por qué matcheó o no (español, 1 oración).
- El campo "message" SIEMPRE debe ser exactamente el display_name de la brand elegida (ej: "Yerba Mate", "Ropa Adidas", "Fernet Branca") o "..." si no hay match.`;

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
        description: "El brand_id exacto del registry (yerba_mate/adidas/fernet_branca), o null si no hay match.",
      },
      moment_quality: { type: "number", description: "0..1 — qué tan auctionable es el momento por sí solo." },
      brand_match: { type: "number", description: "0..1 — qué tan bien la brand elegida calza con este momento." },
      reason: { type: "string", description: "Español, ≤2 oraciones. Explica el call (audit)." },
      message: {
        type: ["string", "null"],
        description: "Exactamente el display_name de la brand (ej: 'Yerba Mate') o '...' si no hay match.",
      },
    },
    required: ["should_emit", "brand_id", "moment_quality", "brand_match", "reason", "message"],
  },
};

export type Picker = (chunk: ContextChunk) => Promise<BrandPick>;

export function makeClaudePicker(apiKey: string, model: string): Picker {
  const client = new Anthropic({ apiKey });

  return async function pickBrand(chunk) {
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
    `## AUDIO TRANSCRIPTO (ventana ${chunk.duration_s}s, stream "${chunk.stream_key}")`,
    "",
    `Texto del audio: ${truncate(chunk.audio_text, 600) || "(sin audio)"}`,
    "",
    `## BRANDS DISPONIBLES (${brands.length})`,
    "",
    ...brands.map(
      (b) =>
        `### ${b.id} — ${b.display_name}\n` +
        `- keywords de referencia: ${fmtArray(b.match_keywords)}\n` +
        `- persona: ${truncate(b.default_persona, 240)}`,
    ),
    "",
    "Decidí ahora. Llamá la tool `emit_decision` con tu output. Recordá: message = display_name exacto de la brand si matchea, o \"...\" si no.",
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

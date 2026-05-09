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

const SYSTEM_PROMPT = `Sos el manager de placements de Addie. Recibís el contexto actual de un stream en vivo (últimos 30 segundos) y la biblioteca de brands disponibles. Tu trabajo es decidir si este momento amerita pautar y, si sí, qué brand encaja mejor.

Sos crítico: SKIP es la opción default. Solo emití un placement si:
1. el momento es genuinamente interesante (reacción fuerte, mención explícita de marca/producto, recomendación clara, surge de viewers, energía épica) — NO talking heads neutro, NO transición, NO dead air;
2. hay una brand cuya persona y target_moods calzan con el contexto sin forzarlo.

Si dudás, SKIP. Devolvé moment_quality y brand_match honestos — un 0.5 es una señal válida de "no estoy seguro". Si encontrás una mención explícita de la marca (audio_mentions o audio_text) eso eleva fuerte el brand_match.

El message tiene que estar en español rioplatense (vos), ≤25 palabras, en la voz/persona de la brand elegida. Nunca menciones competidores. Nunca hables de precios o descuentos.`;

const TOOL_NAME = "emit_decision";
const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Emite la decisión final del manager: si pautar, qué brand elegir, y los scores de calidad/match.",
  input_schema: {
    type: "object",
    properties: {
      should_emit: { type: "boolean", description: "true solo si moment_quality y brand_match son altos." },
      brand_id: {
        type: ["string", "null"],
        description: "El brand_id exacto del registry (adidas/nike/quilmes/mp/steam/rappi/globant/cocacola), o null si SKIP.",
      },
      moment_quality: { type: "number", description: "0..1 — qué tan auctionable es el momento por sí solo." },
      brand_match: { type: "number", description: "0..1 — qué tan bien la brand elegida calza con este momento." },
      reason: { type: "string", description: "Español, ≤2 oraciones. Explica el call (audit)." },
      message: {
        type: ["string", "null"],
        description: "Español rioplatense, ≤25 palabras, en voz de la brand. Null si SKIP.",
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
 * Heuristic stub picker — no API key needed. Mirrors the worker's stub:
 * picks the first brand whose target_moods overlaps the chunk's mood_tags
 * (or `any`-tagged brand as fallback) and emits a synthetic message.
 */
export function makeStubPicker(): Picker {
  return async function pickBrand(chunk) {
    const moodTags = chunk.mood_tags ?? [];
    const match = BRANDS.find(
      (b) => b.target_moods.includes("any") || b.target_moods.some((m) => moodTags.includes(m)),
    );
    if (!match) {
      return {
        should_emit: false,
        brand_id: null,
        moment_quality: 0.6,
        brand_match: 0.2,
        reason: "[DRY_RUN] ningún brand tiene target_moods que matcheen los mood_tags del chunk",
        message: null,
      };
    }
    return {
      should_emit: true,
      brand_id: match.id,
      moment_quality: 0.7,
      brand_match: 0.7,
      reason: `[DRY_RUN] match heurístico por mood_tags=${moodTags.join(",") || "<vacío>"} → ${match.id}`,
      message: `[DRY_RUN ${match.display_name}] ${chunk.audio_summary ?? "momento detectado"}`.slice(0, 200),
    };
  };
}

function renderPrompt(chunk: ContextChunk, brands: readonly Brand[]): string {
  return [
    `## CONTEXTO ACTUAL (ventana ${chunk.duration_s}s, stream "${chunk.stream_key}")`,
    "",
    `- Audio summary: ${chunk.audio_summary ?? "(sin resumen)"}`,
    `- Audio intent: ${chunk.audio_intent ?? "?"}`,
    `- Audio mentions: ${fmtArray(chunk.audio_mentions)}`,
    `- Audio topics: ${fmtArray(chunk.audio_topics)}`,
    `- Audio (transcript bruto, último 30s): ${truncate(chunk.audio_text, 400)}`,
    `- Escena: ${chunk.scene_type ?? "?"} | energy=${chunk.energy_level ?? "?"} | mood=${fmtArray(chunk.mood_tags)}`,
    `- On-screen text: ${truncate(chunk.on_screen_text, 120)}`,
    `- Chat: vel_avg=${chunk.chat_velocity_avg ?? "?"} peak=${chunk.chat_velocity_peak ?? "?"} sentiment=${chunk.sentiment_avg ?? "?"} keywords=${fmtArray(chunk.chat_recent_keywords)}`,
    `- Audiencia: viewers=${chunk.viewers ?? "?"} (Δ30s=${chunk.viewers_delta_30s ?? "?"}) game="${chunk.game_category ?? "?"}" title="${chunk.stream_title ?? "?"}"`,
    "",
    `## BRANDS DISPONIBLES (${brands.length})`,
    "",
    ...brands.map(
      (b) =>
        `### ${b.id} — ${b.display_name}\n` +
        `- target_moods: ${fmtArray(b.target_moods)}\n` +
        `- safety_keywords (auto-skip si suenan): ${fmtArray(b.safety_keywords)}\n` +
        (b.always_bid_floor ? `- default_bidder: true (acepta cualquier contexto no-unsafe)\n` : "") +
        `- persona: ${truncate(b.default_persona, 240)}`,
    ),
    "",
    "Decidí ahora. Llamá la tool `emit_decision` con tu output.",
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

/**
 * Stage 2 — multi-agent parallel picker (C-08m-multiagent).
 *
 * Reemplaza la única Haiku call de pickBrand.ts por N Haikus paralelas, una
 * por brand sobreviviente al gate1. Cada brand-agent actúa EN PRIMERA PERSONA
 * como esa marca y devuelve {interested, score, bid_usdc, pitch, reasoning}.
 *
 * Por qué esto en vez de el picker único:
 *   - Visibilidad: cada brand_thought se persiste como render_event y se
 *     emite por SSE → el dashboard ve la deliberación en cascada.
 *   - Auditabilidad: queda rastro de POR QUÉ cada brand pasó/no pasó, no
 *     solo del ganador.
 *   - "Más agentic": N agentes opinan independientemente; el ganador es
 *     determinista por max-score. No hay un single-cerebro decidiendo todo.
 *
 * Wall-time: bounded por la peor Haiku del batch (~2-3s). Mismo budget que
 * el picker single-shot porque corren en paralelo.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { LoadedBrand } from "@/lib/agents/brands/loader";

import type { BrandPick, ContextChunk } from "./types";

// ─── Public types ────────────────────────────────────────────────────

export type BrandThought = {
  brand_slug: string;
  brand_label: string;
  brand_color?: string;
  /** El brand-agent decidió que SI le interesa este momento. */
  interested: boolean;
  /** 0..1 — qué tan perfecto es este momento PARA ESTA brand específicamente. */
  score: number;
  /** USDC decimal dentro del rango del brand, o null si interested=false. */
  bid_usdc: number | null;
  /** 1-line pitch en voz del brand (vacío si no interesado). */
  pitch: string;
  /** 1-line ES audit reasoning. */
  reasoning: string;
  /** Cuánto tardó la Haiku call de este brand-agent. */
  latency_ms: number;
  /** Si el brand-agent erroreó, queda registrado acá; interested=false. */
  error?: string;
};

export type MultiAgentResult = {
  thoughts: BrandThought[];
  winner: BrandPick;
  total_ms: number;
};

export type MultiAgentPicker = (
  chunk: ContextChunk,
  brands: LoadedBrand[],
) => Promise<MultiAgentResult>;

// ─── Tool schema (per-brand) ─────────────────────────────────────────

const TOOL_NAME = "emit_brand_decision";

function buildTool(brand: LoadedBrand): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: `Como agente de ${brand.payload.display_name}, decidí si querés pautar AHORA en este momento.`,
    input_schema: {
      type: "object",
      properties: {
        interested: {
          type: "boolean",
          description: "true si querés que tu ad salga ahora; false si paso.",
        },
        score: {
          type: "number",
          description:
            "0..1 — qué tan perfecto es este momento PARA VOS (no genérico). 1 = match ideal, 0 = totalmente off-topic.",
        },
        bid_usdc: {
          type: ["number", "null"],
          description: `USDC decimal dentro de [${brand.payload.min_bid_usdc}, ${brand.payload.max_bid_usdc}]. Null si interested=false.`,
        },
        pitch: {
          type: "string",
          description:
            "1 frase corta en TU voz como brand. Ej. \"este momento es mío, ponéme ahora\". Vacío si interested=false.",
        },
        reasoning: {
          type: "string",
          description: "ES, 1 oración, audit-friendly. Por qué entrás o pasás.",
        },
      },
      required: ["interested", "score", "bid_usdc", "pitch", "reasoning"],
    },
  };
}

function buildSystemPrompt(brand: LoadedBrand): string {
  const voice = brand.payload.brand_voice ?? "neutra";
  return `Sos el brand-agent autónomo de **${brand.payload.display_name}** (slug \`${brand.slug}\`). Hablás en primera persona como la marca, con voz ${voice}.

Cuándo te interesa pautar (descripción de tu mandate):
${brand.description}

Match keywords (señal fuerte si el speaker los menciona): ${brand.match_keywords.join(", ") || "(ninguno)"}
Tu bid range USDC: [${brand.payload.min_bid_usdc}, ${brand.payload.max_bid_usdc}]

Recibís un resumen semántico del audio de un stream en vivo (ventana ~30s) y decidís EN PRIMERA PERSONA si querés que tu ad salga ahora.

Reglas:
- score 0..1 = qué tan perfecto es este momento PARA VOS específicamente. Un momento alto-engagement pero off-topic → score bajo. Un momento moderado pero on-topic → score alto.
- bid_usdc: dentro de tu rango. Match fuerte (mention literal) + momento alto → cerca del max. Match contextual moderado → mid. Apenas pasa → cerca del min. Si interested=false → null.
- pitch: 1 frase corta en TU voz, como si le hablaras al streamer ("este clutch es mío", "yo me prendo cuando hay fogón"). Vacío si paso.
- reasoning: ES, 1 oración, audit-friendly. POR QUÉ entrás o pasás.
- Sé honesto: si el momento no es tuyo, decí interested=false. Mejor ceder este chunk que pautar mal.`;
}

function renderPrompt(chunk: ContextChunk): string {
  return [
    `## CHUNK SEMÁNTICO (ventana ${chunk.duration_s}s, stream "${chunk.stream_key}")`,
    "",
    `- audio_summary: ${truncate(chunk.audio_summary, 400) || "(sin resumen)"}`,
    `- audio_intent: ${chunk.audio_intent ?? "(null)"}`,
    `- audio_mentions: ${fmtArray(chunk.audio_mentions)}`,
    `- audio_topics: ${fmtArray(chunk.audio_topics)}`,
    `- mood_tags: ${fmtArray(chunk.mood_tags)}`,
    `- viewers: ${chunk.viewers ?? "?"} (Δ30s: ${chunk.viewers_delta_30s ?? 0})`,
    `- transcript bruto: ${truncate(chunk.audio_text, 400) || "(sin audio)"}`,
    "",
    `Decidí ahora. Llamá la tool \`${TOOL_NAME}\` con tu output.`,
  ].join("\n");
}

// ─── Live picker (Haiku per brand, paralelo) ─────────────────────────

export function makeMultiAgentClaudePicker(
  apiKey: string,
  model: string,
): MultiAgentPicker {
  let clientPromise: Promise<Anthropic> | null = null;

  return async function multiAgentPick(chunk, brands) {
    const tStart = Date.now();

    if (brands.length === 0) {
      return {
        thoughts: [],
        winner: noBrandsWinner("gate1 filtró todos los brands — no hay candidatos"),
        total_ms: Date.now() - tStart,
      };
    }

    if (!clientPromise) {
      clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey }),
      );
    }
    const client = await clientPromise;

    const thoughts = await Promise.all(
      brands.map((brand) => callBrandAgent(client, model, brand, chunk)),
    );

    const winner = pickWinnerDeterministic(thoughts, brands);
    const total_ms = Date.now() - tStart;

    console.log(
      JSON.stringify({
        tag: "multiagent:picker_done",
        chunk_id: chunk.id,
        stream_key: chunk.stream_key,
        n_brands: brands.length,
        n_interested: thoughts.filter((t) => t.interested).length,
        n_errors: thoughts.filter((t) => t.error).length,
        winner_brand_id: winner.brand_id,
        winner_score: winner.brand_match,
        winner_bid_usdc: winner.bid_usdc,
        total_ms,
      }),
    );

    return { thoughts, winner, total_ms };
  };
}

async function callBrandAgent(
  client: Anthropic,
  model: string,
  brand: LoadedBrand,
  chunk: ContextChunk,
): Promise<BrandThought> {
  const t0 = Date.now();
  try {
    const tool = buildTool(brand);
    const response = await client.messages.create({
      model,
      max_tokens: 400,
      system: buildSystemPrompt(brand),
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: renderPrompt(chunk) }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) throw new Error("brand-agent did not call the tool");

    const out = toolUse.input as {
      interested: boolean;
      score: number;
      bid_usdc: number | null;
      pitch: string;
      reasoning: string;
    };

    // Server-side clamp del bid al rango del brand.
    let bidUsdc: number | null = null;
    if (out.interested && out.bid_usdc != null) {
      const min = brand.payload.min_bid_usdc;
      const max = brand.payload.max_bid_usdc;
      bidUsdc = Math.max(min, Math.min(max, Number(out.bid_usdc)));
    }

    const score = clamp01(Number(out.score ?? 0));

    return {
      brand_slug: brand.slug,
      brand_label: brand.payload.display_name,
      brand_color: brand.display.color ?? brand.payload.color,
      interested: Boolean(out.interested),
      score,
      bid_usdc: bidUsdc,
      pitch: String(out.pitch ?? ""),
      reasoning: String(out.reasoning ?? ""),
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        tag: "multiagent:brand_agent_error",
        brand_slug: brand.slug,
        chunk_id: chunk.id,
        error: message,
        latency_ms: Date.now() - t0,
      }),
    );
    return {
      brand_slug: brand.slug,
      brand_label: brand.payload.display_name,
      brand_color: brand.display.color ?? brand.payload.color,
      interested: false,
      score: 0,
      bid_usdc: null,
      pitch: "",
      reasoning: `error en brand-agent: ${message}`,
      latency_ms: Date.now() - t0,
      error: message,
    };
  }
}

// ─── Stub picker (no API key, deterministic keyword match) ───────────

export function makeMultiAgentStubPicker(): MultiAgentPicker {
  return async function multiAgentPick(chunk, brands) {
    const tStart = Date.now();

    if (brands.length === 0) {
      return {
        thoughts: [],
        winner: noBrandsWinner(
          "[DRY_RUN] gate1 filtró todos los brands — no hay candidatos",
        ),
        total_ms: Date.now() - tStart,
      };
    }

    const text = (chunk.audio_text ?? "").toLowerCase();
    const thoughts: BrandThought[] = brands.map((brand) => {
      const matchedKw = brand.match_keywords.find((kw) =>
        text.includes(kw.toLowerCase()),
      );
      const interested = !!matchedKw;
      const score = interested ? 0.8 : 0.1;
      const midBid =
        (brand.payload.min_bid_usdc + brand.payload.max_bid_usdc) / 2;
      return {
        brand_slug: brand.slug,
        brand_label: brand.payload.display_name,
        brand_color: brand.display.color ?? brand.payload.color,
        interested,
        score,
        bid_usdc: interested ? Number(midBid.toFixed(2)) : null,
        pitch: interested
          ? `[DRY_RUN] ${brand.payload.display_name} listo, hay match en "${matchedKw}"`
          : "",
        reasoning: interested
          ? `[DRY_RUN] keyword match "${matchedKw}" en audio_text`
          : `[DRY_RUN] ningún match_keyword en audio_text`,
        latency_ms: 0,
      };
    });

    const winner = pickWinnerDeterministic(thoughts, brands);
    return { thoughts, winner, total_ms: Date.now() - tStart };
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────

function pickWinnerDeterministic(
  thoughts: BrandThought[],
  brands: LoadedBrand[],
): BrandPick {
  const interested = thoughts
    .filter((t) => t.interested && t.bid_usdc != null)
    .sort((a, b) => b.score - a.score);

  if (interested.length === 0) {
    return {
      should_emit: false,
      brand_id: null,
      moment_quality: maxOr0(thoughts.map((t) => t.score)),
      brand_match: 0,
      bid_usdc: null,
      reason:
        thoughts.length === 0
          ? "no hubo brand-agents que respondieran"
          : "ningún brand-agent quiso pautar este momento",
      message: "...",
    };
  }

  const winner = interested[0]!;
  const winnerBrand = brands.find((b) => b.slug === winner.brand_slug);
  return {
    should_emit: true,
    brand_id: winner.brand_slug,
    // moment_quality = max score (cuán bueno fue el momento para alguien) —
    // brand_match = score del ganador (cuán bueno fue PARA EL GANADOR).
    moment_quality: maxOr0(thoughts.map((t) => t.score)),
    brand_match: winner.score,
    bid_usdc: winner.bid_usdc,
    reason: winner.reasoning,
    message: winnerBrand?.payload.display_name ?? winner.brand_label,
  };
}

function noBrandsWinner(reason: string): BrandPick {
  return {
    should_emit: false,
    brand_id: null,
    moment_quality: 0,
    brand_match: 0,
    bid_usdc: null,
    reason,
    message: "...",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function maxOr0(arr: number[]): number {
  return arr.length === 0 ? 0 : Math.max(...arr);
}

function fmtArray(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "[]";
  return `[${arr.slice(0, 8).join(", ")}]`;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "(vacío)";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

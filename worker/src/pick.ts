/**
 * Claude brand picker — standalone for the Fly.io worker.
 * Calls Claude Haiku with the chunk context and brand descriptions.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BrandPick, BrandThought, ContextChunk, LoadedBrand } from "./types.js";

const TOOL_NAME = "emit_decision";

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

function buildTool(brands: LoadedBrand[]): Anthropic.Tool {
  const brandIds = brands.map((b) => b.slug).join("/");
  return {
    name: TOOL_NAME,
    description:
      "Emite la decisión final del manager: si pautar, qué brand elegir, y los scores de calidad/match.",
    input_schema: {
      type: "object" as const,
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

function renderPrompt(chunk: ContextChunk, brands: LoadedBrand[]): string {
  const fmtArray = (arr: string[] | null | undefined): string => {
    if (!arr || arr.length === 0) return "[]";
    return `[${arr.slice(0, 8).join(", ")}]`;
  };
  const truncate = (s: string | null | undefined, n: number): string => {
    if (!s) return "(vacío)";
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

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
        `### ${b.slug} — ${b.display_name}\n` +
        `- descripción: ${truncate(b.description, 400)}\n` +
        `- match_keywords: ${fmtArray(b.match_keywords)}`,
    ),
    "",
    'Decidí ahora. Compará la descripción de cada brand contra el audio. Priorizá audio_mentions (señal fuerte) sobre audio_summary (señal contextual). Llamá la tool `emit_decision` con tu output. Recordá: message = display_name exacto si matchea, o "..." si no.',
  ].join("\n");
}

// ─── Exported pickers ───────────────────────────────────────────────

export type Picker = (chunk: ContextChunk, brands: LoadedBrand[]) => Promise<BrandPick>;

export function makeClaudePicker(apiKey: string, model: string): Picker {
  const client = new Anthropic({ apiKey });

  return async function pickBrand(chunk, brands) {
    if (brands.length === 0) {
      return {
        should_emit: false,
        brand_id: null,
        moment_quality: 0,
        brand_match: 0,
        reason: "no hay brands candidatos",
        message: "...",
      };
    }

    const t0 = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 600,
      system: buildSystemPrompt(brands),
      tools: [buildTool(brands)],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: renderPrompt(chunk, brands) }],
    });
    const apiMs = Date.now() - t0;

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) throw new Error("Claude did not call the tool");

    const out = toolUse.input as BrandPick;
    const result: BrandPick = {
      should_emit: Boolean(out.should_emit),
      brand_id: out.brand_id ?? null,
      moment_quality: Number(out.moment_quality ?? 0),
      brand_match: Number(out.brand_match ?? 0),
      reason: String(out.reason ?? ""),
      message: out.message ?? null,
    };

    console.log(
      JSON.stringify({
        tag: "picker:ai_timing",
        model,
        chunk_id: chunk.id,
        api_call_ms: apiMs,
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
 * Normalize: lowercase + strip diacríticos. Sin esto, "platanús" no matchea
 * "platanus" — Scribe v2 a veces agrega tildes espurios en brand names
 * inventados, y términos reales como "plátano" no matchearían "platano".
 * Aplicamos a ambos lados (text + kw) para no acoplar el match a la
 * representación Unicode exacta.
 */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function makeStubPicker(): Picker {
  return async function pickBrand(chunk, brands) {
    const text = normalize(chunk.audio_text ?? "");
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
      b.match_keywords.some((kw) => text.includes(normalize(kw))),
    );
    if (!match) {
      return {
        should_emit: true,
        brand_id: null,
        moment_quality: 0.3,
        brand_match: 0,
        reason: "[DRY_RUN] ningún keyword encontrado",
        message: "...",
      };
    }
    return {
      should_emit: true,
      brand_id: match.slug,
      moment_quality: 0.7,
      brand_match: 0.8,
      reason: `[DRY_RUN] keyword match → ${match.slug}`,
      message: match.display_name,
    };
  };
}

// ─── Multi-agent picker (worker-multiagent) ─────────────────────────
// Port de apps/web/src/lib/manager/multiAgentPicker.ts adaptado a la shape
// flat del LoadedBrand del worker (`brand.X` en vez de `brand.payload.X`).
//
// Reemplaza la única Haiku call de makeClaudePicker por N Haikus paralelas,
// una por brand. Cada brand-agent actúa EN PRIMERA PERSONA y devuelve
// {interested, score, bid_usdc, pitch, reasoning}. tick.ts persiste cada
// thought como render_event kind='brand_thought' con un deliberation_id
// común — el dashboard ve la deliberación en cascada.
//
// Wall-time ≈ peor Haiku del batch (~2-3s) porque corren en paralelo.

export type MultiAgentResult = {
  thoughts: BrandThought[];
  winner: BrandPick;
  total_ms: number;
};

export type MultiAgentPicker = (
  chunk: ContextChunk,
  brands: LoadedBrand[],
) => Promise<MultiAgentResult>;

const MULTI_TOOL_NAME = "emit_brand_decision";

function brandBidFloor(brand: LoadedBrand): number {
  return brand.min_bid_usdc ?? 0.10;
}
function brandBidCeil(brand: LoadedBrand): number {
  return brand.max_bid_usdc ?? 1.00;
}

function buildMultiTool(brand: LoadedBrand): Anthropic.Tool {
  const min = brandBidFloor(brand);
  const max = brandBidCeil(brand);
  return {
    name: MULTI_TOOL_NAME,
    description: `Como agente de ${brand.display_name}, decidí si querés pautar AHORA en este momento.`,
    input_schema: {
      type: "object" as const,
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
          description: `USDC decimal dentro de [${min}, ${max}]. Null si interested=false.`,
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

function buildMultiSystemPrompt(brand: LoadedBrand): string {
  const voice = brand.brand_voice ?? "neutra";
  const min = brandBidFloor(brand);
  const max = brandBidCeil(brand);
  return `Sos el brand-agent autónomo de **${brand.display_name}** (slug \`${brand.slug}\`). Hablás en primera persona como la marca, con voz ${voice}.

Cuándo te interesa pautar (descripción de tu mandate):
${brand.description}

Match keywords (señal fuerte si el speaker los menciona): ${brand.match_keywords.join(", ") || "(ninguno)"}
Tu bid range USDC: [${min}, ${max}]

Recibís un resumen semántico del audio de un stream en vivo (ventana ~30s) y decidís EN PRIMERA PERSONA si querés que tu ad salga ahora.

Reglas:
- score 0..1 = qué tan perfecto es este momento PARA VOS específicamente. Un momento alto-engagement pero off-topic → score bajo. Un momento moderado pero on-topic → score alto.
- bid_usdc: dentro de tu rango. Match fuerte (mention literal) + momento alto → cerca del max. Match contextual moderado → mid. Apenas pasa → cerca del min. Si interested=false → null.
- pitch: 1 frase corta en TU voz, como si le hablaras al streamer ("este clutch es mío", "yo me prendo cuando hay fogón"). Vacío si paso.
- reasoning: ES, 1 oración, audit-friendly. POR QUÉ entrás o pasás.
- Sé honesto: si el momento no es tuyo, decí interested=false. Mejor ceder este chunk que pautar mal.`;
}

function renderMultiPrompt(chunk: ContextChunk): string {
  const fmtArray = (arr: string[] | null | undefined): string => {
    if (!arr || arr.length === 0) return "[]";
    return `[${arr.slice(0, 8).join(", ")}]`;
  };
  const truncate = (s: string | null | undefined, n: number): string => {
    if (!s) return "(vacío)";
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

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
    `Decidí ahora. Llamá la tool \`${MULTI_TOOL_NAME}\` con tu output.`,
  ].join("\n");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function maxOr0(arr: number[]): number {
  return arr.length === 0 ? 0 : Math.max(...arr);
}

async function callBrandAgent(
  client: Anthropic,
  model: string,
  brand: LoadedBrand,
  chunk: ContextChunk,
): Promise<BrandThought> {
  const t0 = Date.now();
  try {
    const tool = buildMultiTool(brand);
    const response = await client.messages.create({
      model,
      max_tokens: 400,
      system: buildMultiSystemPrompt(brand),
      tools: [tool],
      tool_choice: { type: "tool", name: MULTI_TOOL_NAME },
      messages: [{ role: "user", content: renderMultiPrompt(chunk) }],
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

    // Server-side clamp del bid al rango del brand. El LLM puede devolver
    // fuera de rango aún con la spec en el tool description.
    let bidUsdc: number | null = null;
    if (out.interested && out.bid_usdc != null) {
      const min = brandBidFloor(brand);
      const max = brandBidCeil(brand);
      bidUsdc = Math.max(min, Math.min(max, Number(out.bid_usdc)));
    }

    const score = clamp01(Number(out.score ?? 0));

    return {
      brand_slug: brand.slug,
      brand_label: brand.display_name,
      brand_color: brand.color,
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
      brand_label: brand.display_name,
      brand_color: brand.color,
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
    message: winnerBrand?.display_name ?? winner.brand_label,
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

export function makeMultiAgentClaudePicker(
  apiKey: string,
  model: string,
): MultiAgentPicker {
  const client = new Anthropic({ apiKey });

  return async function multiAgentPick(chunk, brands) {
    const tStart = Date.now();

    if (brands.length === 0) {
      return {
        thoughts: [],
        winner: noBrandsWinner("no hay brands cargadas — no hay candidatos"),
        total_ms: Date.now() - tStart,
      };
    }

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

export function makeMultiAgentStubPicker(): MultiAgentPicker {
  return async function multiAgentPick(chunk, brands) {
    const tStart = Date.now();

    if (brands.length === 0) {
      return {
        thoughts: [],
        winner: noBrandsWinner(
          "[DRY_RUN] no hay brands cargadas — no hay candidatos",
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
      const min = brandBidFloor(brand);
      const max = brandBidCeil(brand);
      const midBid = (min + max) / 2;
      return {
        brand_slug: brand.slug,
        brand_label: brand.display_name,
        brand_color: brand.color,
        interested,
        score,
        bid_usdc: interested ? Number(midBid.toFixed(2)) : null,
        pitch: interested
          ? `[DRY_RUN] ${brand.display_name} listo, hay match en "${matchedKw}"`
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

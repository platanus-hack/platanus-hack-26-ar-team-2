// apps/web/scripts/fixtures/orchestrator-cases.ts — C-08test fixtures.
//
// Casos sintéticos para el harness del orquestador. El runner
// (sim-orchestrator.ts) INSERTa la fila, dispara managerTick(), lee
// render_events y compara contra expect.
//
// Calibrado al PITCH Bloque 3 (docs/PITCH.md):
//   F-01 cafetito-match     ← speaker menciona "café"
//   F-02 pancho-rex-daypart ← skip por daypart      (necesita C-08a)
//   F-03 matebros-viewers   ← skip por max_viewers  (necesita C-08a)
//   F-04 termoflex-mention  ← speaker menciona "termo"
//   F-05 brand-safety-skip  ← keyword bloqueada     (necesita C-08a)
//   F-06 cafetito-vs-termo  ← negociación           (necesita C-10/C-12/C-14)
//
// Hoy F-01 + F-04 enabled (matchean por keyword vía stub picker / Claude).
// Cuando C-08a..d landeen → habilitar F-02/F-03/F-05 y enriquecer expect.gate_skips.
// Cuando C-14 lande → habilitar F-06, agregar expect.bid_usdc_min/escrow_lock_tx,
// y switchear el trigger del runner de import directo a fetch POST /api/auctions/run.

import type { ContextChunk } from "../../src/lib/manager/types.ts";

export type ChunkOverrides = Partial<
  Omit<
    ContextChunk,
    | "id"
    | "stream_key"
    | "stream_id"
    | "ts_start"
    | "created_at"
    | "ticks_aggregated"
    | "frame_analyses_aggregated"
  >
>;

export type GateSkipExpect = {
  brand: string;
  gate: 1 | 2 | 3 | 4;
  reason_substring: string;
};

export type OrchestratorCase = {
  id: string;
  title: string;
  enabled: boolean;
  /** Si enabled=false, el runner imprime PENDING + esta razón. */
  pending_reason?: string;
  /** Qué simula este case respecto al PITCH (audit-friendly). */
  pitch_ref: string;
  chunk: ChunkOverrides & {
    audio_text: string;
    duration_s?: number;
  };
  expect: {
    /** Hoy solo "emit". Cuando C-08a..d landeen, agregar variantes skip:gateN. */
    decision?: "emit";
    /** brand_id del registry (cafetito/termoflex/pancho-rex/matebros) o null si "..." */
    brand_id: string | null;
    /** Substring del display_name esperado en render_events.message. */
    message_contains?: string;
    /** TODO C-08d: bid mínimo cuando BrandPick exponga bid_usdc. */
    bid_usdc_min?: number;
    /**
     * TODO C-08a..d: skips esperados de cada brand. El runner los va a chequear
     * contra render_events.payload.gate_skip_reasons[] cuando ese shape exista.
     */
    gate_skips?: GateSkipExpect[];
  };
};

export const CASES: OrchestratorCase[] = [
  {
    id: "F-01",
    title: "cafetito-match",
    enabled: true,
    pitch_ref:
      'PITCH Bloque 3: "yo ya voy por el cuarto CafetITO". Mention directa → brand=cafetito.',
    chunk: {
      audio_text:
        "Llevamos como 18 horas codeando esto. Yo ya voy por el cuarto CafetITO bien cargadísimo, los pibes del fondo están dándole.",
      audio_summary:
        "El speaker menciona que va por el cuarto café CafetITO mientras el equipo charla.",
      audio_topics: ["café", "trabajo"],
      audio_mentions: ["CafetITO", "café"],
      audio_intent: "reaction",
      scene_type: "talking_head",
      energy_level: "high",
      mood_tags: ["high_energy", "celebration"],
      viewers: 5,
      viewers_delta_30s: 1,
      chat_velocity_avg: 1.2,
      chat_velocity_peak: 2.5,
      sentiment_avg: "positive",
      stream_title: "Addie Demo",
    },
    expect: {
      decision: "emit",
      brand_id: "cafetito",
      message_contains: "CafetITO",
    },
  },

  {
    id: "F-02",
    title: "pancho-rex-daypart",
    enabled: false,
    pending_reason:
      "Necesita C-08a (gate1 daypart). Hoy managerTick no chequea dayparts; el stub matchea pancho-rex por keyword aunque sea fuera del lunch.",
    pitch_ref:
      'PITCH Bloque 3: "Pancho Rex porque no es lunch". chunk con mention "pancho" pero ts_start fuera del daypart 13-15.',
    chunk: {
      audio_text:
        "Buena, los panchos del almuerzo ya son historia, ahora vamos por el café.",
      audio_summary:
        "El speaker hace pasar la frase de los panchos como anécdota previa al café.",
      audio_topics: ["comida", "café"],
      audio_mentions: ["panchos", "café"],
      audio_intent: "discussion",
      scene_type: "talking_head",
      energy_level: "medium",
      mood_tags: ["calm"],
      viewers: 5,
    },
    expect: {
      // Stub picker matchea "pancho" → pancho-rex. Cuando C-08a chequee daypart,
      // pancho-rex SKIP gate1 → cafetito gana por mention "café".
      brand_id: "cafetito",
      gate_skips: [{ brand: "pancho-rex", gate: 1, reason_substring: "daypart" }],
    },
  },

  {
    id: "F-03",
    title: "matebros-viewers",
    enabled: false,
    pending_reason:
      "Necesita C-08a (gate1 max_viewers). matebros mandate ya tiene max_viewers:2 desde C-02d, pero managerTick no lee ese filtro hoy.",
    pitch_ref:
      'PITCH Bloque 3 primer trigger: "MateBros porque la audiencia es muy grande". chunk con mention "mate" + viewers > max_viewers=2.',
    chunk: {
      audio_text: "Los pibes del fondo están con mate, fogón de hackathon dale.",
      audio_summary: "El speaker señala que el equipo está tomando mate.",
      audio_topics: ["mate", "comunidad"],
      audio_mentions: ["mate"],
      audio_intent: "discussion",
      scene_type: "talking_head",
      energy_level: "high",
      mood_tags: ["high_energy"],
      viewers: 20,
      viewers_delta_30s: 5,
    },
    expect: {
      brand_id: null,
      gate_skips: [{ brand: "matebros", gate: 1, reason_substring: "viewers" }],
    },
  },

  {
    id: "F-04",
    title: "termoflex-mention",
    enabled: true,
    pitch_ref:
      'PITCH Bloque 3: "el termo TermoFlex al lado". Mention directa → brand=termoflex.\n' +
      "Post-C-13: agregar F-04b 'termoflex-floor-fill' con chunk neutro (sin mention) para validar always_bid_floor.",
    chunk: {
      audio_text:
        "Tengo el termo TermoFlex al lado lleno de agua caliente para el mate de los pibes.",
      audio_summary: "El speaker señala el termo TermoFlex como parte del setup del demo.",
      audio_topics: ["bebida", "setup"],
      audio_mentions: ["TermoFlex", "termo"],
      audio_intent: "discussion",
      scene_type: "talking_head",
      energy_level: "medium",
      mood_tags: ["calm"],
      viewers: 5,
      sentiment_avg: "neutral",
    },
    expect: {
      decision: "emit",
      brand_id: "termoflex",
      message_contains: "TermoFlex",
    },
  },

  {
    id: "F-05",
    title: "brand-safety-skip",
    enabled: false,
    pending_reason:
      "Necesita C-08a (brand_safety.blocked_keywords). Hoy el stub no chequea bloqueos; matchea cualquier keyword presente.",
    pitch_ref:
      "Caso defensivo: si el chunk menciona 'café' pero también una keyword bloqueada (ej. 'droga'), las 4 brands deben skipear.",
    chunk: {
      audio_text: "Che el café este es una droga, te despierta de una.",
      audio_summary:
        "Mención de droga (en sentido coloquial) en el mismo chunk que la mención del café.",
      audio_topics: ["café"],
      audio_mentions: ["café"],
      audio_intent: "reaction",
      scene_type: "talking_head",
      energy_level: "high",
      mood_tags: ["high_energy"],
      viewers: 5,
      chat_recent_keywords: ["droga"],
    },
    expect: {
      brand_id: null,
      gate_skips: [
        { brand: "cafetito", gate: 1, reason_substring: "brand_safety" },
        { brand: "termoflex", gate: 1, reason_substring: "brand_safety" },
        { brand: "pancho-rex", gate: 1, reason_substring: "brand_safety" },
        { brand: "matebros", gate: 1, reason_substring: "brand_safety" },
      ],
    },
  },

  {
    id: "F-06",
    title: "cafetito-vs-termoflex",
    enabled: false,
    pending_reason:
      "Necesita C-10 + C-12 + C-14 (orquestador multi-turno + settlement + endpoint). managerTick devuelve un único brand pick, no una subasta.",
    pitch_ref:
      "Subasta: chunk matchea cafetito (mention 'café') Y termoflex (always_bid_floor). Esperamos winner=cafetito por bid > floor.",
    chunk: {
      audio_text:
        "Cuarto CafetITO de la noche, este sí es el cargado que destrabó el deploy.",
      audio_summary: "El speaker celebra que el café destrabó el deploy.",
      audio_topics: ["café", "deploy"],
      audio_mentions: ["CafetITO", "café"],
      audio_intent: "reaction",
      scene_type: "talking_head",
      energy_level: "epic",
      mood_tags: ["high_energy", "celebration", "victory"],
      viewers: 8,
      viewers_delta_30s: 3,
      sentiment_avg: "hype",
    },
    expect: {
      decision: "emit",
      brand_id: "cafetito",
      message_contains: "CafetITO",
      bid_usdc_min: 0.5,
    },
  },
];

export const ENABLED_CASES = CASES.filter((c) => c.enabled);

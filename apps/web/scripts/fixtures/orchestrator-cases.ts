// apps/web/scripts/fixtures/orchestrator-cases.ts — C-08test fixtures.
//
// Casos sintéticos para el harness del orquestador. El runner
// (sim-orchestrator.ts) INSERTa la fila, dispara managerTick(), lee
// render_events y compara contra expect.
//
// Calibrado al PITCH Bloque 3 (docs/PITCH.md):
//   F-01 cafetito-match     ← speaker menciona "café"
//   F-02 pancho-rex-daypart ← skip por daypart (necesita C-08a) ✅ enabled
//   F-03 matebros-viewers   ← skip por max_viewers (necesita C-08a) ✅ enabled
//   F-04 termoflex-mention  ← speaker menciona "termo"
//   F-05 brand-safety-skip  ← keyword bloqueada (necesita C-08a) ✅ enabled
//   F-06 cafetito-vs-termo  ← negociación (necesita C-10/C-12/C-14)
//
// Post-C-08a: F-02/F-03/F-05 enabled. El harness verifica gate_skips contra
// `render_events.payload.gate_skips[]` con subset match (los expected entries
// deben aparecer en actual; actual puede tener extras).
//
// CAVEAT TIME-DEPENDENCE: F-02 (pancho-rex daypart) depende del wall-clock
// real cuando corre el harness. Pancho-rex daypart activo: 13:00-15:00 + 20:00-02:00 ART.
// Fuera de esas ventanas (~16h del día), el SKIP fires con code='outside_daypart'.
// Dentro, el SKIP cae a 'missing_required_tag' (el chunk no tiene los moods de
// pancho-rex). El expect usa brand+gate sin reason_substring → robusto a la hora.
//
// F-06 sigue disabled (necesita C-10 + C-12 + C-14).

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
  /**
   * Optional substring to match against `code` OR `human_message` of the
   * actual skip. If omitted, the expectation is satisfied as soon as
   * `brand`+`gate` match — útil para SKIPs cuya razón depende del runtime
   * (e.g. wall-clock hour para daypart cases).
   */
  reason_substring?: string;
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
    /** Hoy "emit". Cuando C-10/C-12/C-14 landeen, agregar variantes skip:gateN. */
    decision?: "emit";
    /**
     * brand_id del registry (cafetito/termoflex/...) o null si "...".
     * Si el resultado puede legítimamente diferir entre stub picker y Claude
     * real (ej. always_bid_floor reasoning), usar `brand_id_any_of` en su
     * lugar — la check pasa si el actual matchea cualquiera del array.
     */
    brand_id?: string | null;
    brand_id_any_of?: (string | null)[];
    /** Substring del display_name esperado en render_events.message. */
    message_contains?: string;
    /**
     * Bid mínimo del ganador. Hoy el harness `sim:orch` corre por
     * `managerTick()` que NO devuelve bid (eso es responsabilidad de la
     * subasta — C-14). Este campo lo consume `pnpm smoke:hunt` (C-08 +
     * C-08d) que ejecuta `huntForBrand()` per-brand y devuelve
     * `BrandAgentDecision.bid_usdc`. Cuando C-14 wire `POST /api/auctions/run`
     * el harness lo pasa a usar acá también.
     */
    bid_usdc_min?: number;
    /**
     * Substrings que deben aparecer en el `agent_reasoning` del ganador
     * (gate path resumido + fit_reasons del `BrandValuation`). Mismo status
     * que `bid_usdc_min`: dormant en `sim:orch`, vivo en `smoke:hunt` y
     * en el flow post-C-14.
     */
    agent_reasoning_contains?: string[];
    /**
     * Subset match contra `render_events.payload.gate_skips[]`. Cada expected
     * entry debe encontrar un actual entry con mismo `brand_id` + `gate` (y
     * `reason_substring` si está). Actual puede tener skips extras.
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
      'PITCH Bloque 3 trigger 1: "yo ya voy por el cuarto CafetITO". Mention directa → brand=cafetito. Audiencia 5 viewers (matebros skipea max_viewers).',
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
      // C-08d: contracts cumplidos por `pnpm smoke:hunt` (huntForBrand).
      // sim:orch los ignora hasta C-14.
      bid_usdc_min: 0.5,
      agent_reasoning_contains: ["gate1", "gate4"],
      gate_skips: [
        // matebros: viewers=5 > max_viewers=2 → time-invariant skip.
        { brand: "matebros", gate: 1, reason_substring: "viewers_above_max" },
      ],
    },
  },

  {
    id: "F-02",
    title: "pancho-rex-daypart",
    enabled: true,
    pitch_ref:
      'PITCH Bloque 3 trigger 1: "Pancho Rex porque no es lunch". Chunk con mention "panchos" + "café" pero pancho-rex skipea por daypart (12:00 demo time fuera de 13-15 / 20-02). Cafetito gana por mention "café".',
    chunk: {
      // mood_tags incluye high_energy para que cafetito pase gate1
      // (required_any_tag includes high_energy). Sin esto cafetito skipea
      // por missing_required_tag y no quedaría brand para que el picker
      // matchee "café".
      audio_text:
        "Buena, los panchos del almuerzo ya son historia, ahora vamos por el café que está cargadísimo.",
      audio_summary:
        "El speaker hace pasar la frase de los panchos como anécdota previa al café.",
      audio_topics: ["comida", "café"],
      audio_mentions: ["panchos", "café"],
      audio_intent: "discussion",
      scene_type: "talking_head",
      energy_level: "high",
      mood_tags: ["high_energy"],
      viewers: 5,
      stream_title: "Addie Demo",
    },
    expect: {
      decision: "emit",
      brand_id: "cafetito",
      message_contains: "CafetITO",
      gate_skips: [
        // brand+gate sin reason_substring → robusto a la hora del runtime.
        // Demo (12:00) y la mayoría del día caen en outside_daypart;
        // 13-15/20-02 ART caen en missing_required_tag (calm/idle/late_night
        // no están en mood_tags=[high_energy]).
        { brand: "pancho-rex", gate: 1 },
        { brand: "matebros", gate: 1, reason_substring: "viewers_above_max" },
      ],
    },
  },

  {
    id: "F-03",
    title: "matebros-viewers",
    enabled: true,
    pitch_ref:
      'PITCH Bloque 3 trigger 1: "MateBros porque la audiencia es muy grande". Chunk con mention "mate" pero viewers=20 (>max_viewers=2). MateBros SKIP gate1 viewers_above_max. Sin otra brand matchea "mate" → brand_id=null. (Cuando C-13 wirea always_bid_floor en el picker, esto switchea a brand_id=termoflex.)',
    chunk: {
      // Sin "hackathon" para no triggerear el match_keyword de platanus
      // (platanus es la única brand que matcheaba el word, y arruinaba la
      // expectativa brand_id=null).
      audio_text: "Los pibes del fondo están con mate, fogón de equipo dale.",
      audio_summary: "El speaker señala que el equipo está tomando mate.",
      audio_topics: ["mate", "comunidad"],
      audio_mentions: ["mate"],
      audio_intent: "discussion",
      scene_type: "talking_head",
      energy_level: "medium",
      mood_tags: ["casual_chat"],
      viewers: 20,
      viewers_delta_30s: 5,
      stream_title: "Addie Demo",
    },
    expect: {
      // Stub picker (sin LLM): surviving=[termoflex, platanus] post-gate1,
      //   ningún match_keyword incluye "mate" → null.
      // Claude picker (real LLM): reconoce termoflex.always_bid_floor en su
      //   persona y emite termoflex como default bidder. Ambos válidos.
      brand_id_any_of: [null, "termoflex"],
      gate_skips: [
        { brand: "matebros", gate: 1, reason_substring: "viewers_above_max" },
      ],
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
      // calm satisface required_any_tag de pancho-rex pero pancho-rex
      // igual skipea por daypart fuera de 13-15/20-02. matebros skipea
      // por viewers > 2.
      mood_tags: ["calm"],
      viewers: 5,
      sentiment_avg: "neutral",
      stream_title: "Addie Demo",
    },
    expect: {
      decision: "emit",
      brand_id: "termoflex",
      message_contains: "TermoFlex",
      gate_skips: [
        { brand: "matebros", gate: 1, reason_substring: "viewers_above_max" },
      ],
    },
  },

  {
    id: "F-05",
    title: "brand-safety-skip",
    enabled: true,
    pitch_ref:
      'Caso defensivo: si el chunk menciona "café" pero también una keyword bloqueada (ej. "droga"), TODOS los brands deben skipear (los 5 tienen "droga" en blocked_keywords). brand_id=null.',
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
      stream_title: "Addie Demo",
    },
    expect: {
      // Todos los brands SKIPean gate1 brand_safety → surviving=[] →
      // picker devuelve brand_id=null sin tocar el LLM.
      brand_id: null,
      gate_skips: [
        { brand: "cafetito", gate: 1, reason_substring: "blocked_keyword" },
        { brand: "termoflex", gate: 1, reason_substring: "blocked_keyword" },
        { brand: "pancho-rex", gate: 1, reason_substring: "blocked_keyword" },
        { brand: "matebros", gate: 1, reason_substring: "blocked_keyword" },
        { brand: "platanus", gate: 1, reason_substring: "blocked_keyword" },
      ],
    },
  },

  {
    id: "F-06",
    title: "cafetito-vs-termoflex",
    enabled: false,
    pending_reason:
      "C-10 ✅ disponible (`pnpm smoke:negotiation` lo cubre standalone). F-06 sigue dormant porque sim:orch corre `managerTick()` directo (1 brand pick), no la subasta multi-brand. Habilitar cuando C-14 wire el trigger a `POST /api/auctions/run` + sumar C-12 settlement.",
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
      // C-08d: harness vive en `pnpm smoke:hunt` hasta que C-14 lande.
      bid_usdc_min: 0.5,
      agent_reasoning_contains: ["gate1", "gate4", "fit"],
    },
  },
];

export const ENABLED_CASES = CASES.filter((c) => c.enabled);

export type ContextChunk = {
  id: string;
  stream_key: string;
  stream_id: string | null;
  ts_start: string;
  duration_s: number;
  audio_text: string | null;
  audio_partial_at_end: string | null;
  audio_summary: string | null;
  audio_topics: string[] | null;
  audio_mentions: string[] | null;
  audio_intent:
    | "discussion"
    | "recommendation"
    | "complaint"
    | "question"
    | "reaction"
    | "silence"
    | null;
  scene_type: string | null;
  energy_level: "calm" | "medium" | "high" | "epic" | null;
  mood_tags: string[] | null;
  on_screen_text: string | null;
  chat_velocity_avg: number | null;
  chat_velocity_peak: number | null;
  chat_recent_keywords: string[] | null;
  sentiment_avg: "positive" | "neutral" | "negative" | "hype" | null;
  viewers: number | null;
  viewers_delta_30s: number | null;
  game_category: string | null;
  stream_title: string | null;
  ticks_aggregated: number;
  frame_analyses_aggregated: number;
  created_at: string;
};

export type BrandPick = {
  should_emit: boolean;
  brand_id: string | null;
  moment_quality: number;
  brand_match: number;
  /** USDC decimal del bid del winner (null si nadie quiso pautar). El single-agent
   *  picker no setea esto; el multi-agent sí lo emite por brand-agent. */
  bid_usdc?: number | null;
  reason: string;
  message: string | null;
};

/** Output de cada brand-agent en la deliberación multi-agente.
 *  Se persiste como render_event kind='brand_thought' con deliberation_id
 *  común por tick — para auditar POR QUÉ cada brand entró/pasó, no solo
 *  el ganador. */
export type BrandThought = {
  brand_slug: string;
  brand_label: string;
  brand_color?: string;
  interested: boolean;
  score: number;
  bid_usdc: number | null;
  pitch: string;
  reasoning: string;
  latency_ms: number;
  error?: string;
};

export type LoadedBrand = {
  slug: string;
  display_name: string;
  description: string;
  match_keywords: string[];
  /** Tono que cada brand-agent usa para hablar en primera persona en su pitch
   *  (worker-multiagent). Opcional — si falta el system prompt cae en "neutra". */
  brand_voice?: string;
  /** Hex color para el dock UI / brand_thought events. */
  color?: string;
  /** Floor de bid en USDC. El single-agent picker del worker no negocia bid;
   *  tick.ts usa este valor como bid efectivo del offer (lo persiste en
   *  bid_usdc_cents para que el settlement loop lo firme). El multi-agent
   *  picker permite al brand-agent decidir bid dentro de [min, max]. */
  min_bid_usdc: number | null;
  max_bid_usdc: number | null;
  ad: {
    asset_url?: string;
    asset_type?: "video" | "image";
    zone?: string;
    duration_ms?: number;
    position?: "top" | "center" | "bottom";
  };
};

export type TickResult = {
  decision: string;
  stream_key: string;
  chunk_id?: string;
  brand_id?: string | null;
  message?: string;
  pick?: BrandPick;
  event_id?: string;
  timing?: Record<string, number>;
};

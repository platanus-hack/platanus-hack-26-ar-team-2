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
  reason: string;
  message: string | null;
};

export type LoadedBrand = {
  slug: string;
  display_name: string;
  description: string;
  match_keywords: string[];
  ad: {
    asset_url?: string;
    asset_type?: "video" | "image";
    zone?: string;
    duration_ms?: number;
  };
  // Bid bounds del YAML (min_bid_usdc / max_bid_usdc del BrandMandate).
  // El tick los usa para proponer un bid lerpeado contra brand_match — el
  // creator ve este número en el Dock al decidir approve/deny.
  min_bid_usdc?: number;
  max_bid_usdc?: number;
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

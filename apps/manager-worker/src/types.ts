/**
 * Shape of a `context_chunks` row as Supabase Realtime delivers it on INSERT.
 * Fields populated by B-07b (`poc/pipeline/src/chunkWriter.ts`) + B-07c
 * (audio summary IA via Gemini, see migration 0008_audio_summary.sql).
 */
export type ContextChunk = {
  id: string;
  stream_key: string;
  stream_id: string | null;
  ts_start: string;
  duration_s: number;

  // Audio (raw transcript + Gemini-derived summary fields)
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

  // Frame analysis (Gemini Flash)
  scene_type: string | null;
  energy_level: "calm" | "medium" | "high" | "epic" | null;
  mood_tags: string[] | null;
  on_screen_text: string | null;

  // Chat (tmi.js)
  chat_velocity_avg: number | null;
  chat_velocity_peak: number | null;
  chat_recent_keywords: string[] | null;
  sentiment_avg: "positive" | "neutral" | "negative" | "hype" | null;

  // Twitch Helix
  viewers: number | null;
  viewers_delta_30s: number | null;
  game_category: string | null;
  stream_title: string | null;

  ticks_aggregated: number;
  frame_analyses_aggregated: number;
  created_at: string;
};

/** A brand mandate as parsed from `apps/web/src/lib/agents/brands/<slug>.yaml`. */
export type Brand = {
  brand_id: string;
  display_name: string;
  target_moods: string[];
  avoid_moods: string[];
  safety_keywords_avoid: string[];
  persona: string;
  always_bid_floor?: boolean;
};

/** Output of Stage 2 (Claude Haiku). */
export type BrandPick = {
  /** Final gate — true only if both moment_quality and brand_match clear thresholds. */
  should_emit: boolean;
  /** YAML brand_id of the chosen brand, or null if SKIP. */
  brand_id: string | null;
  /** 0..1 — how interesting/auctionable the moment is on its own merits. */
  moment_quality: number;
  /** 0..1 — how well the picked brand fits THIS moment specifically. */
  brand_match: number;
  /** Spanish, ≤2 sentences, audit-friendly. */
  reason: string;
  /** Spanish, ≤25 words, in brand voice. Null if SKIP. */
  message: string | null;
};

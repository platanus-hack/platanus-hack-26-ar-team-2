/**
 * Types shared by the Vercel-cron variant of the manager (C-08m-cron).
 *
 * The standalone push-based worker lives at apps/manager-worker/. Both share
 * the SAME Stage1+Stage2 logic shape; only the trigger differs (Realtime
 * subscribe vs cron pull). Schema mirrors the rows produced by B-07b/c.
 */

import type { GateSkipReason } from "@/lib/agents/types";

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

/** Output of Stage 2 (Claude or stub picker). */
export type BrandPick = {
  /** Final gate — true only if both moment_quality and brand_match clear thresholds. */
  should_emit: boolean;
  /** Slug of the chosen brand (matches `Brand.id` in @/lib/brands), or null if SKIP. */
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

/**
 * Compact chunk fingerprint included in every TickResult that touched a chunk.
 * Lets curl callers see which DB row drove the decision without opening the DB.
 */
export type ChunkMeta = {
  id: string;
  ts_start: string;
  age_s: number;
  audio_intent: ContextChunk["audio_intent"];
  audio_summary_preview: string;
  audio_mentions: string[];
  viewers_delta_30s: number | null;
};

/** Discriminated union the cron route returns as JSON for observability. */
export type TickResult =
  | { decision: "no_chunks"; stream_key: string }
  | { decision: "skip:already_processed"; stream_key: string; chunk_id: string }
  | {
      decision: "cooldown";
      stream_key: string;
      ms_remaining: number;
      chunk: ChunkMeta;
    }
  | {
      decision: "skip:stage1";
      stream_key: string;
      chunk: ChunkMeta;
      reason: string;
    }
  | {
      decision: "skip:llm_no_match" | "skip:moment_quality" | "skip:brand_match" | "skip:empty_message";
      stream_key: string;
      chunk: ChunkMeta;
      pick: BrandPick;
    }
  | {
      decision: "emit";
      stream_key: string;
      chunk: ChunkMeta;
      pick: BrandPick;
      event_id: string;
      /**
       * Gate1 (C-08a) skips that landed on this tick. Mirrored to
       * `render_events.payload.gate_skips`. Empty array if all brands
       * passed gate1.
       */
      gate_skips: GateSkipReason[];
    }
  | { decision: "error"; stream_key: string; error: string };

/**
 * managerTick — single cron tick worth of work.
 *
 * 1. Fetch latest context_chunks row for stream_key.
 * 2. Emit raw firehose event.
 * 3. Claude (or stub) picker analyses audio_text against 3 brands.
 * 4. ALWAYS emit to SSE: brand display_name if match, "..." if not.
 *
 * No HTTP roundtrip — we hit the DB directly via the shared pg pool.
 */

import { pool } from "@/lib/pg";

import { getLoadedBrands, makeClaudePicker, makeStubPicker, type Picker } from "./pickBrand";
import type { ChunkMeta, ContextChunk, TickResult } from "./types";

function toChunkMeta(chunk: ContextChunk): ChunkMeta {
  return {
    id: chunk.id,
    ts_start: chunk.ts_start,
    age_s: Math.round((Date.now() - new Date(chunk.ts_start).getTime()) / 1000),
    audio_intent: chunk.audio_intent,
    audio_summary_preview: (chunk.audio_summary ?? "").slice(0, 140),
    audio_mentions: chunk.audio_mentions ?? [],
    viewers_delta_30s: chunk.viewers_delta_30s,
  };
}

export type ManagerConfig = {
  streamKey: string;
  creatorId: string;
  cooldownMs: number;
  momentQualityMin: number;
  brandMatchMin: number;
  dryRun: boolean;
  anthropicKey: string;
  anthropicModel: string;
};

export function configFromEnv(streamKey: string): ManagerConfig {
  const num = (k: string, fallback: number) => {
    const v = process.env[k];
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (k: string, fallback: boolean) => {
    const v = process.env[k];
    if (v == null) return fallback;
    return v === "true" || v === "1";
  };
  return {
    streamKey,
    creatorId: streamKey, // today, stream_key === creator_id slug
    cooldownMs: num("MANAGER_COOLDOWN_S", 30) * 1000,
    momentQualityMin: num("MANAGER_MOMENT_QUALITY_MIN", 0.5),
    brandMatchMin: num("MANAGER_BRAND_MATCH_MIN", 0.55),
    dryRun: bool("MANAGER_DRY_RUN", false),
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  };
}

export async function managerTick(config: ManagerConfig): Promise<TickResult> {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  const client = await pool().connect();
  const tPool = elapsed();
  try {
    // 1. Latest chunk
    const chunkRes = await client.query<ContextChunk>(
      `select * from context_chunks
        where stream_key = $1
        order by ts_start desc
        limit 1`,
      [config.streamKey],
    );
    const tChunkQuery = elapsed();
    const chunk = chunkRes.rows[0];
    if (!chunk) {
      console.log(
        JSON.stringify({
          tag: "manager:no_chunks",
          stream_key: config.streamKey,
          hint: "verify pipeline is writing context_chunks for this stream_key",
          timing_ms: { pool: tPool, chunk_query: tChunkQuery - tPool, total: elapsed() },
        }),
      );
      return { decision: "no_chunks", stream_key: config.streamKey };
    }

    // 1b. Skip if we already processed this exact chunk
    const alreadyProcessed = await client.query<{ id: string }>(
      `select id from render_events
        where creator_id = $1 and kind = 'raw'
          and message::jsonb -> 'chunk' ->> 'id' = $2
        limit 1`,
      [config.creatorId, String(chunk.id)],
    );
    const tDedupQuery = elapsed();
    if (alreadyProcessed.rows.length > 0) {
      console.log(
        JSON.stringify({
          tag: "manager:skip_already_processed",
          stream_key: config.streamKey,
          chunk_id: chunk.id,
          timing_ms: { pool: tPool, chunk_query: tChunkQuery - tPool, dedup_query: tDedupQuery - tChunkQuery, total: elapsed() },
        }),
      );
      return {
        decision: "skip:already_processed",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
      };
    }

    const ageS = Math.round((Date.now() - new Date(chunk.ts_start).getTime()) / 1000);
    console.log(
      JSON.stringify({
        tag: "manager:chunk_loaded",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        chunk_ts_start: chunk.ts_start,
        chunk_age_s: ageS,
        audio_intent: chunk.audio_intent,
        audio_mentions: chunk.audio_mentions ?? [],
        audio_summary_preview: (chunk.audio_summary ?? "").slice(0, 140),
        viewers_delta_30s: chunk.viewers_delta_30s,
        mood_tags: chunk.mood_tags ?? [],
      }),
    );

    // Emit raw firehose event
    const rawPayload = {
      type: "raw_chunk",
      tick_at: new Date().toISOString(),
      chunk: {
        id: chunk.id,
        ts_start: chunk.ts_start,
        age_s: ageS,
        duration_s: chunk.duration_s,
        audio_text: chunk.audio_text,
        audio_summary: chunk.audio_summary,
        audio_intent: chunk.audio_intent,
        audio_mentions: chunk.audio_mentions,
        audio_topics: chunk.audio_topics,
        scene_type: chunk.scene_type,
        energy_level: chunk.energy_level,
        mood_tags: chunk.mood_tags,
        on_screen_text: chunk.on_screen_text,
        chat_velocity_avg: chunk.chat_velocity_avg,
        chat_velocity_peak: chunk.chat_velocity_peak,
        chat_recent_keywords: chunk.chat_recent_keywords,
        sentiment_avg: chunk.sentiment_avg,
        viewers: chunk.viewers,
        viewers_delta_30s: chunk.viewers_delta_30s,
        game_category: chunk.game_category,
        stream_title: chunk.stream_title,
      },
    };
    const rawInsert = await client.query<{ id: string }>(
      `insert into render_events (creator_id, message, kind)
       values ($1, $2, 'raw')
       returning id`,
      [config.creatorId, JSON.stringify(rawPayload)],
    );
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${rawInsert.rows[0]!.id}`,
    ]);
    const tRawEmit = elapsed();

    const meta = toChunkMeta(chunk);

    // 2. Claude (or stub) picker decides: brand display_name or "..."
    const picker: Picker = config.dryRun
      ? makeStubPicker()
      : (() => {
          if (!config.anthropicKey) {
            throw new Error(
              "ANTHROPIC_API_KEY missing — set it on Vercel or set MANAGER_DRY_RUN=true",
            );
          }
          return makeClaudePicker(config.anthropicKey, config.anthropicModel);
        })();

    const pick = await picker(chunk);
    const tPicker = elapsed();

    // Always emit: brand display_name if Claude matched, "..." otherwise.
    const message = pick.message ?? "...";

    // If the matched brand has a pre-uploaded ad asset, emit a full placement
    // payload so the overlay renders the video/image instead of just text.
    const brands = getLoadedBrands();
    const matchedBrand = pick.brand_id
      ? brands.find((b) => b.slug === pick.brand_id)
      : undefined;
    const hasAsset = matchedBrand?.ad.asset_url;

    const payload = hasAsset
      ? {
          asset_url: matchedBrand.ad.asset_url,
          asset_type: matchedBrand.ad.asset_type ?? "video",
          zone_id: matchedBrand.ad.zone ?? "fullscreen_takeover",
          duration_ms: matchedBrand.ad.duration_ms ?? 8000,
          brand_id: matchedBrand.slug,
          audio: true,
        }
      : null;

    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, payload)
       values ($1, $2, 'brand', $3)
       returning id, created_at`,
      [config.creatorId, message.slice(0, 280), payload ? JSON.stringify(payload) : null],
    );
    const event_id = insert.rows[0]!.id;

    const sseEvent = {
      id: event_id,
      creator_id: config.creatorId,
      created_at: insert.rows[0]!.created_at,
      kind: "brand",
      message,
      ...(payload ?? {}),
    };
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${event_id}:${JSON.stringify(sseEvent)}`,
    ]);
    const tBrandEmit = elapsed();

    const timing = {
      pool_ms: tPool,
      chunk_query_ms: tChunkQuery - tPool,
      dedup_query_ms: tDedupQuery - tChunkQuery,
      raw_emit_ms: tRawEmit - tDedupQuery,
      picker_ms: tPicker - tRawEmit,
      brand_emit_ms: tBrandEmit - tPicker,
      total_ms: tBrandEmit,
    };
    console.log(
      JSON.stringify({
        tag: "manager:tick_timing",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        decision: "emit",
        brand_id: pick.brand_id ?? null,
        has_asset: !!hasAsset,
        dry_run: config.dryRun,
        timing,
      }),
    );

    return { decision: "emit", stream_key: config.streamKey, chunk: meta, pick, event_id };
  } finally {
    client.release();
  }
}

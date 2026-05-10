/**
 * managerTick — standalone for Fly.io worker.
 * Same logic as apps/web/src/lib/manager/tick.ts but without Next.js imports.
 */

import type { Pool } from "pg";
import type { ContextChunk, LoadedBrand, TickResult } from "./types.js";
import { makeClaudePicker, makeStubPicker, type Picker } from "./pick.js";

export type ManagerConfig = {
  streamKey: string;
  creatorId: string;
  dryRun: boolean;
  anthropicKey: string;
  anthropicModel: string;
};

export function configFromEnv(streamKey: string): ManagerConfig {
  return {
    streamKey,
    creatorId: streamKey,
    dryRun: process.env.MANAGER_DRY_RUN === "true" || process.env.MANAGER_DRY_RUN === "1",
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  };
}

export async function managerTick(
  config: ManagerConfig,
  pool: Pool,
  brands: LoadedBrand[],
): Promise<TickResult> {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  const client = await pool.connect();
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
      console.log(JSON.stringify({
        tag: "worker:no_chunks",
        stream_key: config.streamKey,
        timing_ms: { pool: tPool, chunk_query: tChunkQuery - tPool },
      }));
      return { decision: "no_chunks", stream_key: config.streamKey };
    }

    // 1b. Dedup — skip if already processed
    const alreadyProcessed = await client.query<{ id: string }>(
      `select id from render_events
        where creator_id = $1 and kind = 'raw'
          and message::jsonb -> 'chunk' ->> 'id' = $2
        limit 1`,
      [config.creatorId, String(chunk.id)],
    );
    const tDedup = elapsed();
    if (alreadyProcessed.rows.length > 0) {
      return {
        decision: "skip:already_processed",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
      };
    }

    const ageS = Math.round((Date.now() - new Date(chunk.ts_start).getTime()) / 1000);

    // 2. Emit raw firehose event
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

    // 3. Claude (or stub) picker
    const picker: Picker = config.dryRun
      ? makeStubPicker()
      : (() => {
          if (!config.anthropicKey) {
            throw new Error("ANTHROPIC_API_KEY missing — set it or use MANAGER_DRY_RUN=true");
          }
          return makeClaudePicker(config.anthropicKey, config.anthropicModel);
        })();

    const pick = await picker(chunk, brands);
    const tPicker = elapsed();

    const message = pick.message ?? "...";

    // 4. Build placement payload if brand has ad asset
    const matchedBrand = pick.brand_id
      ? brands.find((b) => b.slug === pick.brand_id)
      : undefined;
    const hasAsset = matchedBrand?.ad.asset_url;

    const payload: Record<string, unknown> = {};
    if (hasAsset) {
      payload.asset_url = matchedBrand.ad.asset_url;
      payload.asset_type = matchedBrand.ad.asset_type ?? "video";
      payload.zone_id = matchedBrand.ad.zone ?? "fullscreen_takeover";
      payload.duration_ms = matchedBrand.ad.duration_ms ?? 8000;
      payload.brand_id = matchedBrand.slug;
      payload.audio = true;
    }

    // 5. Insert brand render_event + pg_notify
    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, payload)
       values ($1, $2, 'brand', $3)
       returning id, created_at`,
      [config.creatorId, message.slice(0, 280), Object.keys(payload).length > 0 ? JSON.stringify(payload) : null],
    );
    const event_id = insert.rows[0]!.id;

    const sseEvent = {
      id: event_id,
      creator_id: config.creatorId,
      created_at: insert.rows[0]!.created_at,
      kind: "brand",
      message,
      ...payload,
    };
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${event_id}:${JSON.stringify(sseEvent)}`,
    ]);
    const tBrandEmit = elapsed();

    const timing = {
      pool_ms: tPool,
      chunk_query_ms: tChunkQuery - tPool,
      dedup_ms: tDedup - tChunkQuery,
      raw_emit_ms: tRawEmit - tDedup,
      picker_ms: tPicker - tRawEmit,
      brand_emit_ms: tBrandEmit - tPicker,
      total_ms: tBrandEmit,
    };

    console.log(JSON.stringify({
      tag: "worker:tick_done",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      brand_id: pick.brand_id ?? null,
      has_asset: !!hasAsset,
      dry_run: config.dryRun,
      timing,
    }));

    return {
      decision: "emit",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      brand_id: pick.brand_id,
      message,
      pick,
      event_id,
      timing,
    };
  } finally {
    client.release();
  }
}

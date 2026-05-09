/**
 * managerTick — single cron tick worth of work.
 *
 * 1. Fetch latest context_chunks row for stream_key.
 * 2. Fetch latest render_events row for creator_id (= stream_key today).
 * 3. If we're inside cooldown window since the last emit → skip.
 * 4. Stage 1 semantic filter on the chunk → maybe skip.
 * 5. Stage 2 Claude (or stub) picker → maybe skip on score thresholds.
 * 6. INSERT render_events + pg_notify (same shape the existing /render
 *    route writes), so the SSE consumer at /o/<id> gets the message.
 *
 * No HTTP roundtrip — we hit the DB directly via the shared pg pool.
 */

import { pool } from "@/lib/pg";

import { stage1Filter } from "./intensity";
import { makeClaudePicker, makeStubPicker, type Picker } from "./pickBrand";
import type { ContextChunk, TickResult } from "./types";

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
  const client = await pool().connect();
  try {
    // 1. Latest chunk
    const chunkRes = await client.query<ContextChunk>(
      `select * from context_chunks
        where stream_key = $1
        order by ts_start desc
        limit 1`,
      [config.streamKey],
    );
    const chunk = chunkRes.rows[0];
    if (!chunk) return { decision: "no_chunks", stream_key: config.streamKey };

    // 2. Last emit timestamp (cooldown anchor)
    const lastEmitRes = await client.query<{ created_at: string }>(
      `select created_at from render_events
        where creator_id = $1
        order by created_at desc
        limit 1`,
      [config.creatorId],
    );
    const lastEmit = lastEmitRes.rows[0];
    if (lastEmit) {
      const sinceEmit = Date.now() - new Date(lastEmit.created_at).getTime();
      if (sinceEmit < config.cooldownMs) {
        return {
          decision: "cooldown",
          stream_key: config.streamKey,
          ms_remaining: config.cooldownMs - sinceEmit,
        };
      }
    }

    // 3. Stage 1
    const s1 = stage1Filter(chunk);
    if (!s1.pass) {
      return {
        decision: "skip:stage1",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        reason: s1.reason,
      };
    }

    // 4. Stage 2
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

    if (!pick.should_emit || !pick.brand_id) {
      return {
        decision: "skip:llm_no_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }
    if (pick.moment_quality < config.momentQualityMin) {
      return {
        decision: "skip:moment_quality",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }
    if (pick.brand_match < config.brandMatchMin) {
      return {
        decision: "skip:brand_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }
    if (!pick.message) {
      return {
        decision: "skip:empty_message",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }

    // 5. Emit — same shape as POST /api/creators/[id]/render writes.
    const insert = await client.query<{ id: string }>(
      `insert into render_events (creator_id, message)
       values ($1, $2)
       returning id`,
      [config.creatorId, pick.message.slice(0, 280)],
    );
    const event_id = insert.rows[0]!.id;
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${event_id}`,
    ]);

    return {
      decision: "emit",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      pick,
      event_id,
    };
  } finally {
    client.release();
  }
}

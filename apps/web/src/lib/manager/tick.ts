/**
 * managerTick — single cron tick worth of work.
 *
 * Flow (post-0012):
 *   1. Fetch latest context_chunks row for stream_key.
 *   2. Cooldown lookup: si hubo un OFFER en los últimos `cooldownMs`, skip.
 *      (No usamos kind='brand' como anchor porque ahora 'brand' es la row
 *      derivada del accept — si gateamos por eso, dock spam-eable.)
 *   3. Stage 1 semantic filter on the chunk → maybe skip.
 *   4. Stage 2 Claude (or stub) picker → maybe skip on score thresholds.
 *   5. INSERT render_events kind='offer' status='pending' bid_usdc_cents=N
 *      + pg_notify con payload completo → dock muestra card al toque.
 *   6. La row kind='brand' SOLO se inserta cuando el streamer ✅ accept
 *      (endpoint POST /api/creators/[id]/offers/[event_id]/accept).
 *
 * No HTTP roundtrip — we hit the DB directly via the shared pg pool.
 */

import { pool } from "@/lib/pg";

import { BRANDS } from "@/lib/brands";

import { stage1Filter } from "./intensity";
import { makeClaudePicker, makeStubPicker, type Picker } from "./pickBrand";
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
    if (!chunk) {
      console.log(
        JSON.stringify({
          tag: "manager:no_chunks",
          stream_key: config.streamKey,
          hint: "verify pipeline is writing context_chunks for this stream_key",
        }),
      );
      return { decision: "no_chunks", stream_key: config.streamKey };
    }

    // Visibility: log the chunk we're about to evaluate, so it's obvious
    // which DB row drives each decision (and whether it's stale).
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

    // EVERY tick → emit a `raw` render_event with the full chunk JSON.
    // This is the firehose the iframe at /o/<creator_id> shows as live debug.
    // Independent of Stage1/2 — brand emits below are still gated normally.
    // We keep the chunk shape compact (drop noisy/duplicated fields).
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

    // 2. Last OFFER emit timestamp (cooldown anchor) — incluye pending,
    //    accepted, rejected, expired. Sin esto el agent spamearía offers
    //    (uno por chunk) si el usuario tarda en moderar. Status no influye:
    //    una vez emitido un offer, esperamos cooldownMs antes del próximo.
    const lastEmitRes = await client.query<{ created_at: string }>(
      `select created_at from render_events
        where creator_id = $1 and kind = 'offer'
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
          chunk: toChunkMeta(chunk),
        };
      }
    }

    const meta = toChunkMeta(chunk);

    // 3. Stage 1
    const s1 = stage1Filter(chunk);
    if (!s1.pass) {
      return {
        decision: "skip:stage1",
        stream_key: config.streamKey,
        chunk: meta,
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
      return { decision: "skip:llm_no_match", stream_key: config.streamKey, chunk: meta, pick };
    }
    if (pick.moment_quality < config.momentQualityMin) {
      return { decision: "skip:moment_quality", stream_key: config.streamKey, chunk: meta, pick };
    }
    if (pick.brand_match < config.brandMatchMin) {
      return { decision: "skip:brand_match", stream_key: config.streamKey, chunk: meta, pick };
    }
    if (!pick.message) {
      return { decision: "skip:empty_message", stream_key: config.streamKey, chunk: meta, pick };
    }

    // 5. Emit OFFER — pending, esperando approve/reject del streamer en /dock.
    //    El payload jsonb lleva todo lo que el dock necesita renderizar la
    //    card sin re-fetch (brand_id, brand_label, bid, mensaje, zone, etc).
    const brand = BRANDS.find((b) => b.id === pick.brand_id);
    const bidUsdcCents = pick.bid_usdc != null ? Math.round(pick.bid_usdc * 100) : null;
    const offerPayload = {
      kind: "offer" as const,
      status: "pending" as const,
      brand_id: pick.brand_id,
      brand_label: brand?.display_name ?? pick.brand_id,
      brand_color: brand?.brand_color,
      bid_usdc_cents: bidUsdcCents,
      bid_usdc: pick.bid_usdc,
      moment_quality: pick.moment_quality,
      brand_match: pick.brand_match,
      reason: pick.reason,
      // Default zone para text-only — el agent no elige zone hoy. Cuando se
      // agregue creative pre-gen, el zone vendrá del asset.
      zone_id: "lower_third" as const,
      duration_ms: 8_000,
    };
    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, status, bid_usdc_cents, payload)
       values ($1, $2, 'offer', 'pending', $3, $4)
       returning id, created_at`,
      [
        config.creatorId,
        pick.message.slice(0, 280),
        bidUsdcCents,
        offerPayload,
      ],
    );
    const event_id = insert.rows[0]!.id;
    const created_at = insert.rows[0]!.created_at;

    // pg_notify formato '<creator_id>:<event_id>:<json>' — el SSE handler
    // lo splittea en los primeros dos colons. El JSON acá es lo que el dock
    // recibe directo sin un fetch extra a la DB.
    const sseEvent = {
      id: event_id,
      creator_id: config.creatorId,
      created_at,
      message: pick.message.slice(0, 280),
      ...offerPayload,
    };
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${event_id}:${JSON.stringify(sseEvent)}`,
    ]);

    return { decision: "emit", stream_key: config.streamKey, chunk: meta, pick, event_id };
  } finally {
    client.release();
  }
}

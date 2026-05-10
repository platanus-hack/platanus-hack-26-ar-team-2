/**
 * managerTick — single cron tick worth of work.
 *
 * 1. Atomic claim de la última row no procesada de context_chunks vía
 *    `FOR UPDATE SKIP LOCKED` + setea `processing_locked_until = now()+TTL`.
 *    Si dos ticks corren en paralelo, solo uno gana la row; el otro recibe
 *    0 rows y devuelve `skip:already_processed` o `no_chunks`.
 * 2. Emit raw firehose event (dentro de la tx).
 * 3. Cooldown lookup contra kind='offer' (NO 'brand' — porque post-0012 las
 *    brand rows son derivadas del accept, no las usamos como anchor).
 * 4. Apply gate1 (C-08a) — filter brands deterministicamente; emit
 *    structured `gate1:eval` log lines + accumulate skips for the offer
 *    event payload.
 * 5. Claude (or stub) picker analyses audio_text against the SURVIVING
 *    brands only.
 * 6. Si pick.should_emit && brand_id → INSERT kind='offer' status='pending'
 *    + pg_notify con payload completo. El dock (/dock?creator_id=X) muestra
 *    la card con countdown + Accept/Reject. La row kind='brand' SOLO se
 *    inserta cuando el streamer ✅ desde el endpoint /accept.
 * 7. UPDATE processed_at = now() en la misma tx → COMMIT atómico.
 *
 * Concurrency contract:
 *   - Todo el tick va en una tx (BEGIN..COMMIT). Si crashea o el LLM tira,
 *     ROLLBACK revierte el claim, el render_event y los pg_notify (los
 *     notifies se entregan recién en COMMIT). Garantiza que no haya offer
 *     event sin processed_at.
 *   - Lock TTL (`processing_locked_until`) es defensa secundaria si la tx
 *     queda idle-in-transaction sin error. Configurable: MANAGER_CHUNK_LOCK_TTL_S.
 *   - Pagos on-chain (C-12) van AFUERA — el dispatchAuction es opt-in via
 *     MANAGER_AUCTION_DISPATCH=true y maneja su propio idempotency.
 *
 * No HTTP roundtrip — we hit the DB directly via the shared pg pool.
 */

import { randomUUID } from "node:crypto";

import { transactPool } from "@/lib/pg";

import { applyGateLadder } from "@/lib/agents/brand/gates/applyGateLadder";
import { runAuction } from "@/lib/auctions/runAuction";
import type { ManagerDecisionSummary } from "@/lib/agents/brand/huntForBrand";

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
  /** TTL del processing_locked_until en segundos. Default 14s (< 15s del chunk emit). */
  chunkLockTtlS: number;
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
    chunkLockTtlS: num("MANAGER_CHUNK_LOCK_TTL_S", 14),
  };
}

export async function managerTick(config: ManagerConfig): Promise<TickResult> {
  const tickId = randomUUID().slice(0, 8);
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  console.log(
    JSON.stringify({
      tag: "manager:tick_start",
      tick_id: tickId,
      stream_key: config.streamKey,
      lock_ttl_s: config.chunkLockTtlS,
    }),
  );

  const client = await transactPool().connect();
  const tPool = elapsed();

  let txOpen = false;
  let claimedChunkId: string | null = null;

  try {
    await client.query("begin");
    txOpen = true;

    const claimRes = await client.query<ContextChunk>(
      `with claim as (
         select id from context_chunks
          where stream_key = $1
            and processed_at is null
            and (processing_locked_until is null or processing_locked_until < now())
          order by ts_start desc
          limit 1
          for update skip locked
       )
       update context_chunks c
          set processing_locked_until = now() + ($2::int * interval '1 second')
         from claim
        where c.id = claim.id
        returning c.*`,
      [config.streamKey, config.chunkLockTtlS],
    );
    const tClaimQuery = elapsed();

    if (claimRes.rows.length === 0) {
      const probe = await client.query<{
        id: string;
        processed_at: string | null;
        processing_locked_until: string | null;
      }>(
        `select id, processed_at, processing_locked_until
           from context_chunks
          where stream_key = $1
          order by ts_start desc
          limit 1`,
        [config.streamKey],
      );
      await client.query("commit"); // close tx (read-only, nothing to persist)
      txOpen = false;

      if (probe.rows.length === 0) {
        console.log(
          JSON.stringify({
            tag: "manager:no_chunks",
            tick_id: tickId,
            stream_key: config.streamKey,
            hint: "verify pipeline is writing context_chunks for this stream_key",
            timing_ms: { pool: tPool, claim_query: tClaimQuery - tPool, total: elapsed() },
          }),
        );
        return { decision: "no_chunks", stream_key: config.streamKey };
      }

      const latest = probe.rows[0]!;
      const skipReason = latest.processed_at
        ? "already_processed"
        : "locked_by_other_tick";
      console.log(
        JSON.stringify({
          tag: "manager:skip_no_claim",
          tick_id: tickId,
          stream_key: config.streamKey,
          chunk_id: latest.id,
          skip_reason: skipReason,
          processed_at: latest.processed_at,
          locked_until: latest.processing_locked_until,
          timing_ms: { pool: tPool, claim_query: tClaimQuery - tPool, total: elapsed() },
        }),
      );
      return {
        decision: "skip:already_processed",
        stream_key: config.streamKey,
        chunk_id: latest.id,
      };
    }

    const chunk = claimRes.rows[0]!;
    claimedChunkId = chunk.id;
    const ageS = Math.round((Date.now() - new Date(chunk.ts_start).getTime()) / 1000);

    console.log(
      JSON.stringify({
        tag: "manager:claim_acquired",
        tick_id: tickId,
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        chunk_ts_start: chunk.ts_start,
        chunk_age_s: ageS,
        lock_ttl_s: config.chunkLockTtlS,
      }),
    );

    console.log(
      JSON.stringify({
        tag: "manager:chunk_loaded",
        tick_id: tickId,
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

    // Cooldown anchor: último OFFER (cualquier status). Si emitimos un offer
    // hace <cooldownMs, esperamos. Sino podríamos spamear el dock con cards
    // si el streamer dice keywords en cadena.
    const lastOfferRes = await client.query<{ created_at: string }>(
      `select created_at from render_events
        where creator_id = $1 and kind = 'offer'
        order by created_at desc
        limit 1`,
      [config.creatorId],
    );
    const lastOffer = lastOfferRes.rows[0];
    if (lastOffer) {
      const sinceEmit = Date.now() - new Date(lastOffer.created_at).getTime();
      if (sinceEmit < config.cooldownMs) {
        // Cerramos la tx liberando el claim.
        await client.query(
          `update context_chunks
              set processed_at = now(),
                  processing_locked_until = null
            where id = $1`,
          [chunk.id],
        );
        await client.query("commit");
        txOpen = false;
        return {
          decision: "cooldown",
          stream_key: config.streamKey,
          ms_remaining: config.cooldownMs - sinceEmit,
          chunk: toChunkMeta(chunk),
        };
      }
    }

    const meta = toChunkMeta(chunk);

    const allBrands = getLoadedBrands();
    const ladder = applyGateLadder({
      brands: allBrands,
      context: chunk,
      stream: null,
      log_context: { stream_key: config.streamKey, chunk_id: String(chunk.id) },
    });
    const tGate1 = elapsed();

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

    const pick = await picker(chunk, ladder.surviving);
    const tPicker = elapsed();

    // Resolver brand info (display_name, color, asset visual) del registry YAML.
    const matchedBrand = pick.brand_id
      ? allBrands.find((b) => b.slug === pick.brand_id)
      : undefined;
    const hasAsset = matchedBrand?.ad.asset_url;

    // Construir el payload del offer. Incluye gate_skips para audit + asset
    // visual (si el YAML tiene ad_asset_url) + bid info para el dock.
    const bidUsdcCents = pick.bid_usdc != null ? Math.round(pick.bid_usdc * 100) : null;
    const offerPayload: Record<string, unknown> = {
      kind: "offer",
      status: "pending",
      brand_id: pick.brand_id,
      brand_label: matchedBrand?.payload.display_name ?? pick.brand_id,
      brand_color: matchedBrand?.display.color ?? matchedBrand?.payload.color,
      bid_usdc_cents: bidUsdcCents,
      bid_usdc: pick.bid_usdc,
      moment_quality: pick.moment_quality,
      brand_match: pick.brand_match,
      reason: pick.reason,
      gate_skips: ladder.skips,
      // Visual del placement: si la YAML tiene ad_asset_url usamos ese, sino
      // text-only en lower_third 8s default.
      zone_id: matchedBrand?.ad.zone ?? "lower_third",
      duration_ms: matchedBrand?.ad.duration_ms ?? 8_000,
    };
    if (hasAsset) {
      offerPayload.asset_url = matchedBrand.ad.asset_url;
      offerPayload.asset_type = matchedBrand.ad.asset_type ?? "video";
      offerPayload.audio = true;
      if (matchedBrand.ad.position) {
        offerPayload.ad_position = matchedBrand.ad.position;
      }
    }

    const message = pick.message ?? "...";
    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, status, bid_usdc_cents, payload)
       values ($1, $2, 'offer', 'pending', $3, $4)
       returning id, created_at`,
      [config.creatorId, message.slice(0, 280), bidUsdcCents, offerPayload],
    );
    const event_id = insert.rows[0]!.id;
    const created_at = insert.rows[0]!.created_at;

    // pg_notify con payload completo — el dock recibe todo en el evento sin
    // re-fetch a la DB. Format '<creator_id>:<event_id>:<json>'.
    const sseEvent = {
      id: event_id,
      creator_id: config.creatorId,
      created_at,
      message,
      ...offerPayload,
    };
    await client.query("select pg_notify('render_events', $1)", [
      `${config.creatorId}:${event_id}:${JSON.stringify(sseEvent)}`,
    ]);
    const tOfferEmit = elapsed();

    await client.query(
      `update context_chunks
          set processed_at = now(),
              processing_locked_until = null
        where id = $1`,
      [chunk.id],
    );

    await client.query("commit");
    txOpen = false;

    // Auction dispatch on-chain — opt-in via env. Probablemente queremos que
    // esto se dispare DESPUÉS del accept (no del offer creation), pero por
    // ahora respetamos el flag y lo dejamos acá.
    if (
      pick.should_emit &&
      pick.brand_id &&
      process.env.MANAGER_AUCTION_DISPATCH === "true"
    ) {
      void dispatchAuction({
        chunk,
        creatorSlug: config.creatorId,
        manager_decision: {
          should_emit: pick.should_emit,
          moment_quality: pick.moment_quality,
          brand_match: pick.brand_match,
          reason: pick.reason ?? "",
        },
        dryRun: config.dryRun,
        anthropicKey: config.anthropicKey,
      });
    }

    const timing = {
      pool_ms: tPool,
      claim_query_ms: tClaimQuery - tPool,
      raw_emit_ms: tRawEmit - tClaimQuery,
      gate1_ms: tGate1 - tRawEmit,
      picker_ms: tPicker - tGate1,
      offer_emit_ms: tOfferEmit - tPicker,
      total_ms: elapsed(),
    };
    console.log(
      JSON.stringify({
        tag: "manager:claim_released",
        tick_id: tickId,
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        decision: "emit",
        kind: "offer",
        brand_id: pick.brand_id ?? null,
        bid_usdc: pick.bid_usdc,
        event_id,
        has_asset: !!hasAsset,
        dry_run: config.dryRun,
        surviving_count: ladder.surviving.length,
        skip_count: ladder.skips.length,
        timing,
      }),
    );

    return {
      decision: "emit",
      stream_key: config.streamKey,
      chunk: meta,
      pick,
      event_id,
      gate_skips: ladder.skips,
    };
  } catch (err) {
    if (txOpen) {
      await client.query("rollback").catch(() => {});
    }
    console.error(
      JSON.stringify({
        tag: "manager:tick_error",
        tick_id: tickId,
        stream_key: config.streamKey,
        chunk_id: claimedChunkId,
        tx_rolled_back: txOpen,
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: elapsed(),
      }),
    );
    throw err;
  } finally {
    client.release();
  }
}

async function dispatchAuction(args: {
  chunk: ContextChunk;
  creatorSlug: string;
  manager_decision: ManagerDecisionSummary;
  dryRun: boolean;
  anthropicKey: string;
}): Promise<void> {
  const t0 = Date.now();
  try {
    const result = await runAuction({
      tick: args.chunk,
      manager_decision: args.manager_decision,
      creator_id: args.creatorSlug,
      anthropic_api_key: args.anthropicKey || undefined,
      dry_run: args.dryRun || !args.anthropicKey,
    });
    console.log(
      JSON.stringify({
        tag: "manager:auction_dispatched",
        stream_key: args.creatorSlug,
        chunk_id: args.chunk.id,
        auction_id: result.auction_id,
        decision: result.decision,
        bid_count: result.hunt_summary.bid_count,
        winner: result.placement?.brand_slug ?? null,
        lock_tx: result.placement?.lock_tx_hash ?? null,
        total_ms: Date.now() - t0,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        tag: "manager:auction_dispatch_error",
        stream_key: args.creatorSlug,
        chunk_id: args.chunk.id,
        error: err instanceof Error ? err.message : String(err),
        total_ms: Date.now() - t0,
      }),
    );
  }
}

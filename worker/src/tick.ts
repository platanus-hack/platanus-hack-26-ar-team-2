/**
 * managerTick — standalone for Fly.io worker.
 *
 * Cambio importante (post-0013_placement_requests): el tick ya NO inserta
 * directo en render_events. Inserta un placement_request (status='pending')
 * que el creator aprueba/rechaza desde el Dock. Cuando aprueba, el endpoint
 * /api/placements/[id]/approve es el que crea el render_event y dispara el
 * SSE al overlay de OBS.
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

/**
 * Bid propuesto = lerp(min, max, brand_match). Si el YAML no setea bounds,
 * fallback a 0.50/2.00 — rango "razonable" para el demo. Se redondea a 4
 * decimales (la columna es numeric(10,4)).
 */
function computeBid(brand: LoadedBrand, brand_match: number): number {
  const min = brand.min_bid_usdc ?? 0.5;
  const max = brand.max_bid_usdc ?? 2.0;
  const m = Math.max(0, Math.min(1, brand_match));
  return Math.round((min + (max - min) * m) * 10000) / 10000;
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

    // 1b. Dedup — skip si ya existe un placement_request para este chunk
    // (cualquier brand). El UNIQUE(chunk_id, brand_id) en DB es defense-in-depth;
    // este check evita pegarle al LLM cuando ya procesamos el chunk.
    const alreadyRequested = await client.query<{ id: string }>(
      `select id from placement_requests
        where creator_id = $1 and chunk_id = $2
        limit 1`,
      [config.creatorId, chunk.id],
    );
    const tDedup = elapsed();
    if (alreadyRequested.rows.length > 0) {
      return {
        decision: "skip:already_requested",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
      };
    }

    // 2. Claude (or stub) picker
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

    const matchedBrand = pick.brand_id
      ? brands.find((b) => b.slug === pick.brand_id)
      : undefined;

    // 3. Garantía de existencia: si el picker no matcheó una brand real con
    // un message útil, NO creamos placement_request. Sin pedido = sin pago.
    if (!pick.should_emit || !matchedBrand || !pick.message || pick.message === "...") {
      console.log(JSON.stringify({
        tag: "worker:no_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        should_emit: pick.should_emit,
        brand_id: pick.brand_id,
        reason: pick.reason,
      }));
      return {
        decision: "no_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }

    const message = pick.message;

    // 4. Build payload (asset opcional — si no hay asset_url, OBS muestra el
    //    message como texto; ese sigue siendo un anuncio entregable).
    const payload: Record<string, unknown> = { chunk_id: chunk.id };
    if (matchedBrand.ad.asset_url) {
      payload.asset_url = matchedBrand.ad.asset_url;
      payload.asset_type = matchedBrand.ad.asset_type ?? "video";
      payload.zone_id = matchedBrand.ad.zone ?? "fullscreen_takeover";
      payload.duration_ms = matchedBrand.ad.duration_ms ?? 8000;
      payload.brand_id = matchedBrand.slug;
      payload.audio = true;
    }

    const bid = computeBid(matchedBrand, pick.brand_match);

    // 5. INSERT placement_request. UNIQUE(chunk_id, brand_id) lo hace idempotente
    //    a nivel DB. Si dos LISTEN dispararan el mismo tick por race, el segundo
    //    rebota con duplicate key y el ON CONFLICT DO NOTHING devuelve 0 rows.
    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into placement_requests
         (creator_id, brand_id, brand_display_name, chunk_id, message, payload,
          bid_usdc, reason, brand_match, moment_quality)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (chunk_id, brand_id) do nothing
       returning id, created_at`,
      [
        config.creatorId,
        matchedBrand.slug,
        matchedBrand.display_name,
        chunk.id,
        message.slice(0, 280),
        Object.keys(payload).length > 0 ? JSON.stringify(payload) : null,
        bid,
        pick.reason,
        pick.brand_match,
        pick.moment_quality,
      ],
    );
    const tInsert = elapsed();

    if (insert.rows.length === 0) {
      // Race con otro tick: alguien ya creó el request para este chunk+brand.
      return {
        decision: "skip:race_lost",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        brand_id: matchedBrand.slug,
      };
    }

    const request_id = insert.rows[0]!.id;
    // El trigger pg_notify('placement_requests_new', ...) ya disparó solo,
    // no hace falta pg_notify manual.

    const timing = {
      pool_ms: tPool,
      chunk_query_ms: tChunkQuery - tPool,
      dedup_ms: tDedup - tChunkQuery,
      picker_ms: tPicker - tDedup,
      insert_ms: tInsert - tPicker,
      total_ms: tInsert,
    };

    console.log(JSON.stringify({
      tag: "worker:request_created",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      request_id,
      brand_id: matchedBrand.slug,
      bid_usdc: bid,
      has_asset: !!matchedBrand.ad.asset_url,
      dry_run: config.dryRun,
      timing,
    }));

    return {
      decision: "request_created",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      brand_id: matchedBrand.slug,
      message,
      pick,
      event_id: request_id,
      timing,
    };
  } finally {
    client.release();
  }
}

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
  /** ms mínimos entre offers consecutivos PARA LA MISMA BRAND. Si llega un
   *  platanus y luego un monster los dos pasan; dos platanus seguidos en
   *  <cooldownMs → solo el primero (evitamos card-spam de la misma marca).
   *  Anchored contra kind='offer' porque los brand events solo se emiten
   *  post-accept (perderíamos cadencia mirando 'brand'). */
  cooldownMs: number;
};

export function configFromEnv(streamKey: string): ManagerConfig {
  const cooldownS = Number(process.env.MANAGER_COOLDOWN_S ?? 15);
  return {
    streamKey,
    creatorId: streamKey,
    dryRun: process.env.MANAGER_DRY_RUN === "true" || process.env.MANAGER_DRY_RUN === "1",
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    cooldownMs: (Number.isFinite(cooldownS) ? cooldownS : 15) * 1000,
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

    // 1b. Dedup — skip if this chunk was already turned into an OFFER.
    // Post-0012 el worker emite kind='offer' (no 'brand'). El dedup mira
    // offers existentes, no brand events (que ahora son derivados del accept).
    const alreadyProcessed = await client.query<{ id: string }>(
      `select id from render_events
        where creator_id = $1 and kind = 'offer'
          and payload::jsonb ->> 'chunk_id' = $2
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

    // Si el picker no eligió ninguna brand, salimos sin emitir. No tiene
    // sentido meter una card "marca:—" en el dock — es un chunk procesado
    // que no matcheó nada, no algo accionable.
    if (!pick.brand_id) {
      console.log(JSON.stringify({
        tag: "worker:no_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        moment_quality: pick.moment_quality,
        reason: pick.reason ?? null,
      }));
      return {
        decision: "no_match",
        stream_key: config.streamKey,
        chunk_id: chunk.id,
        pick,
      };
    }

    // 2b. Cooldown PER-BRAND. Si ya emitimos un offer de ESTA misma brand
    // hace <cooldownMs, skipeamos. Brands distintas pasan siempre — si
    // decís "platanus" e inmediatamente "monster", queremos los dos toasts.
    // Repetir "platanus" tres veces en 5s solo dispara uno.
    const lastOfferRes = await client.query<{ created_at: string }>(
      `select created_at from render_events
        where creator_id = $1
          and kind = 'offer'
          and payload::jsonb ->> 'brand_id' = $2
        order by created_at desc
        limit 1`,
      [config.creatorId, pick.brand_id],
    );
    const lastOffer = lastOfferRes.rows[0];
    if (lastOffer) {
      const sinceEmit = Date.now() - new Date(lastOffer.created_at).getTime();
      if (sinceEmit < config.cooldownMs) {
        console.log(JSON.stringify({
          tag: "worker:cooldown",
          stream_key: config.streamKey,
          chunk_id: chunk.id,
          brand_id: pick.brand_id,
          since_last_offer_ms: sinceEmit,
          cooldown_ms: config.cooldownMs,
        }));
        return {
          decision: "cooldown",
          stream_key: config.streamKey,
          chunk_id: chunk.id,
          brand_id: pick.brand_id,
        };
      }
    }

    const message = pick.message ?? "...";

    // 3. Build placement payload if brand has ad asset
    const matchedBrand = pick.brand_id
      ? brands.find((b) => b.slug === pick.brand_id)
      : undefined;
    const hasAsset = matchedBrand?.ad.asset_url;

    // Construir payload del offer. Incluye chunk_id (audit dedup), brand info
    // para el dock, y placement visual si el YAML tiene ad_asset_url.
    const payload: Record<string, unknown> = {
      kind: "offer",
      status: "pending",
      chunk_id: chunk.id,
      brand_id: pick.brand_id,
      brand_label: matchedBrand?.display_name ?? pick.brand_id,
      moment_quality: pick.moment_quality,
      brand_match: pick.brand_match,
      reason: pick.reason,
      // Default para text-only — overrideado abajo si la brand tiene asset.
      zone_id: matchedBrand?.ad.zone ?? "lower_third",
      duration_ms: matchedBrand?.ad.duration_ms ?? 8000,
    };
    if (hasAsset) {
      payload.asset_url = matchedBrand.ad.asset_url;
      payload.asset_type = matchedBrand.ad.asset_type ?? "video";
      payload.zone_id = matchedBrand.ad.zone ?? "fullscreen_takeover";
      payload.duration_ms = matchedBrand.ad.duration_ms ?? 8000;
      payload.audio = true;
      if (matchedBrand.ad.position) {
        payload.ad_position = matchedBrand.ad.position;
      }
    }

    // 4. Insert OFFER render_event (status='pending') + pg_notify. La row
    // kind='brand' SOLO se inserta cuando el streamer ✅ desde el endpoint
    // POST /api/creators/[id]/offers/[event_id]/accept (ver apps/web).
    const insert = await client.query<{ id: string; created_at: string }>(
      `insert into render_events (creator_id, message, kind, status, payload)
       values ($1, $2, 'offer', 'pending', $3)
       returning id, created_at`,
      [config.creatorId, message.slice(0, 280), JSON.stringify(payload)],
    );
    const event_id = insert.rows[0]!.id;

    const sseEvent = {
      id: event_id,
      creator_id: config.creatorId,
      created_at: insert.rows[0]!.created_at,
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
      picker_ms: tPicker - tDedup,
      brand_emit_ms: tBrandEmit - tPicker,
      total_ms: tBrandEmit,
    };

    console.log(JSON.stringify({
      tag: "worker:tick_done",
      stream_key: config.streamKey,
      chunk_id: chunk.id,
      kind: "offer",
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TranscribeHandle } from './transcribe.js';
import type { FrameHandle } from './frame.js';
import type { TwitchHandle } from './twitch.js';
import type { ChatHandle } from './chat.js';
import { log } from './log.js';

const CHUNK_INTERVAL_MS = Number(process.env.CHUNK_INTERVAL_MS ?? 30_000);

export interface ChunkSources {
  streamKey: string;
  // Getters lazy: el orchestrator todavía puede no tener handles cuando arranca
  // el chunk writer. Si devuelven null, el campo correspondiente queda en NULL.
  transcribe: () => TranscribeHandle | null;
  frame: () => FrameHandle | null;
  twitch: () => TwitchHandle | null;
  chat: () => ChatHandle | null;
  // Counters absolutos (nunca decrecen). El writer calcula deltas internos.
  getTickCount: () => number;
  getFrameCount: () => number;
}

export interface ChunkWriterHandle {
  stop(): Promise<void>;
}

interface ChunkRow {
  stream_key: string;
  stream_id: string | null;
  ts_start: string;
  duration_s: number;
  audio_text: string | null;
  audio_partial_at_end: string | null;
  scene_type: string | null;
  energy_level: 'calm' | 'medium' | 'high' | 'epic' | null;
  mood_tags: string[];
  on_screen_text: string | null;
  chat_velocity_avg: number | null;
  chat_velocity_peak: number | null;
  chat_recent_keywords: string[] | null;
  sentiment_avg: 'positive' | 'neutral' | 'negative' | 'hype' | null;
  viewers: number | null;
  viewers_delta_30s: number | null;
  game_category: string | null;
  stream_title: string | null;
  ticks_aggregated: number;
  frame_analyses_aggregated: number;
}

/**
 * Escribe un row en `context_chunks` cada CHUNK_INTERVAL_MS (default 30s).
 * Consume los handles del orchestrator (transcribe, frame, twitch) y los
 * counters absolutos para calcular deltas.
 *
 * Si SUPABASE_URL/SERVICE_ROLE_KEY no están seteadas, loggea el chunk como
 * JSON a consola en lugar de hacer INSERT — el POC sigue funcionando sin DB.
 */
export function startChunkWriter(sources: ChunkSources): ChunkWriterHandle {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabase: SupabaseClient | null = null;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  } else {
    log.warn(`[chunk ${sources.streamKey}] SUPABASE_URL/SERVICE_ROLE_KEY missing → chunks log only`);
  }

  let active = true;
  let chunkCount = 0;
  let lastTickCount = 0;
  let lastFrameCount = 0;
  let lastViewers: number | null = null;
  let windowStartedAt = Date.now();

  const writeChunk = async (): Promise<void> => {
    if (!active && chunkCount > 0) return; // evita doble write en stop()

    chunkCount += 1;
    const now = Date.now();
    const tsStart = new Date(windowStartedAt).toISOString();
    const durationS = Math.round((now - windowStartedAt) / 1000);
    windowStartedAt = now;

    const transcribe = sources.transcribe();
    const frame = sources.frame();
    const twitch = sources.twitch();
    const chat = sources.chat();

    const ticksNow = sources.getTickCount();
    const framesNow = sources.getFrameCount();
    const ticksAggregated = ticksNow - lastTickCount;
    const framesAggregated = framesNow - lastFrameCount;
    lastTickCount = ticksNow;
    lastFrameCount = framesNow;

    const frameLatest = frame?.getLatest();
    const tw = twitch?.getLatest();
    const chatMetrics = chat?.getMetrics() ?? null;

    const viewers = tw?.is_live ? tw.viewers : null;
    const viewersDelta = lastViewers !== null && viewers !== null ? viewers - lastViewers : null;
    if (viewers !== null) lastViewers = viewers;

    const audio_text = transcribe?.getAudio30s() || null;
    const audio_partial = transcribe?.getPartial() || null;

    const chunk: ChunkRow = {
      stream_key: sources.streamKey,
      stream_id: null, // POC: no creamos fila en streams. Lo llena el handler real en apps/web.
      ts_start: tsStart,
      duration_s: durationS,

      audio_text,
      audio_partial_at_end: audio_partial,

      scene_type: frameLatest?.result.scene_type ?? null,
      energy_level: frameLatest?.result.energy_level ?? null,
      mood_tags: frameLatest?.result.mood_tags ?? [],
      on_screen_text: frameLatest?.result.on_screen_text ?? null,

      // Chat (tmi.js — métricas crudas del chat de Twitch en la ventana de 30s).
      chat_velocity_avg: chatMetrics?.velocity_avg ?? null,
      chat_velocity_peak: chatMetrics?.velocity_peak ?? null,
      chat_recent_keywords: chatMetrics?.recent_keywords ?? null,
      sentiment_avg: chatMetrics?.sentiment ?? null,

      viewers,
      viewers_delta_30s: viewersDelta,
      game_category: tw?.game_category || null,
      stream_title: tw?.stream_title || null,

      ticks_aggregated: ticksAggregated,
      frame_analyses_aggregated: framesAggregated,
    };

    log.success(
      `[chunk ${sources.streamKey}] #${chunkCount} · ${ticksAggregated} ticks · ${framesAggregated} frames · ` +
        `viewers=${viewers ?? '—'} (Δ${viewersDelta ?? '—'}) · ` +
        `chat=${chatMetrics ? `${chatMetrics.velocity_avg.toFixed(1)}msg/s ${chatMetrics.sentiment}` : '—'} · ` +
        `scene="${chunk.scene_type ?? '—'}"`,
    );

    if (supabase) {
      const { error } = await supabase.from('context_chunks').insert(chunk);
      if (error) {
        log.warn(`[chunk ${sources.streamKey}] insert failed: ${error.message}`);
      }
    } else {
      // Log a consola para visibilidad sin DB.
      console.log(`[chunk ${sources.streamKey}] payload:`, JSON.stringify(chunk, null, 2));
    }
  };

  const interval = setInterval(writeChunk, CHUNK_INTERVAL_MS);
  log.info(
    `[chunk ${sources.streamKey}] writer arrancado · cada ${CHUNK_INTERVAL_MS}ms${supabase ? ' → Supabase' : ' → console'}`,
  );

  return {
    stop: async () => {
      clearInterval(interval);
      // Último chunk parcial al cerrar (puede ser <30s pero captura los últimos datos).
      try {
        await writeChunk();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`[chunk ${sources.streamKey}] final write failed: ${msg}`);
      } finally {
        active = false;
      }
    },
  };
}

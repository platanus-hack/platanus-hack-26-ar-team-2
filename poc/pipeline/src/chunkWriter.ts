import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TranscribeHandle } from './transcribe.js';
import type { FrameHandle } from './frame.js';
import type { TwitchHandle } from './twitch.js';
import type { ChatHandle } from './chat.js';
import { log } from './log.js';

// audio_summary IA fue removido del fast-path el 2026-05-09 — mataba 1-3s
// por chunk en una call a Claude Haiku que solo se usaba para que Stage 1
// (intensity.ts) tuviera audio_mentions / audio_intent. Como el chunkWriter
// YA sabe qué keyword disparó el flush instantáneo, podemos populate esos
// campos sin LLM. El picker (Stage 2) lee audio_text crudo directamente y
// extrae lo que necesita on-demand. summarizeAudio.ts queda en disco por si
// hace falta volver a habilitarlo, pero NO se importa.

// Default 15s — bajado desde 30s el 2026-05-09. Es el techo del worst-case:
// con instant-flush por keyword (abajo) la mayoría de los chunks salen mucho
// más rápido. Trade-off vs RPM del provider: 15s + keyword flushes ocasionales
// nos deja holgados con Anthropic tier 1 (50 RPM).
const CHUNK_INTERVAL_MS = Number(process.env.CHUNK_INTERVAL_MS ?? 15_000);

// Instant-flush keywords. Si una palabra de esta lista aparece en el partial
// transcript (o en el audio committed de la ventana actual), gatillamos un
// writeChunk() YA — sin esperar al próximo CHUNK_INTERVAL_MS. Idea: alinear
// esto con los `audio_mentions` que les interesan a los mandates de los brands
// (ej "quilmes,fernet,banana,messi"). Vacío → poll desactivado y vuelve al
// comportamiento clásico cada 15s.
//
// Debounce per-keyword 30s (KEYWORD_DEBOUNCE_MS) — matchea el cooldown del
// manager-tick. Una segunda mención dentro de 30s se ignora porque igual el
// agent estaría en cooldown y no emitiría placement.
const FLUSH_KEYWORDS = (process.env.INSTANT_FLUSH_KEYWORDS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0);
const KEYWORD_POLL_MS = Number(process.env.KEYWORD_POLL_MS ?? 500);
const KEYWORD_DEBOUNCE_MS = 30_000;

// Webhook al manager-tick cuando un chunk acaba de insertarse. Push-based →
// el agent corre 1-2s después del INSERT en lugar de esperar al próximo tick
// del cron de Vercel (que tiene gaps de hasta 6s entre invocaciones). El cron
// queda como safety net.
//   MANAGER_WEBHOOK_URL    — base URL del deploy de apps/web (ej "https://web-x.vercel.app")
//   MANAGER_WEBHOOK_SECRET — = CRON_SECRET en apps/web. Sin esto, el endpoint
//                            queda público — el route lo permite si CRON_SECRET
//                            no está seteado del lado server, así que tampoco
//                            es estrictamente requerido para que funcione.
function fireManagerWebhook(streamKey: string): void {
  const base = process.env.MANAGER_WEBHOOK_URL;
  if (!base) return;
  const secret = process.env.MANAGER_WEBHOOK_SECRET;
  const target = `${base.replace(/\/$/, '')}/api/internal/manager-tick?key=${encodeURIComponent(streamKey)}&single=1`;
  // Fire-and-forget — no awaiteamos así no bloquea el próximo writeChunk si
  // el manager está lento (ej una pickBrand tarda 2s con Claude Haiku). El
  // .catch() previene unhandled rejection que mataría el pipeline.
  fetch(target, {
    method: 'GET',
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
    .then((r) => {
      if (!r.ok) log.warn(`[chunk ${streamKey}] manager webhook → ${r.status}`);
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[chunk ${streamKey}] manager webhook error: ${msg}`);
    });
}

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

// Schema reducido — del row anterior con 22 columnas, solo persistimos las
// que el agent realmente lee + viewers (importantes para Stage 1 fallback +
// para mostrar contexto al pitch). El resto de las columnas en context_chunks
// quedan en NULL (todas nullable salvo ticks/frame_aggregated con default 0).
//
// Lo que NO escribimos y por qué:
//   - stream_id              → siempre null en POC (no creamos fila en streams)
//   - audio_partial_at_end   → solo debug, nadie lo lee
//   - audio_topics           → frame/summary apagados → nadie lo populate
//   - scene_type, energy_level, mood_tags, on_screen_text → frame off
//   - chat_velocity_*, chat_recent_keywords, sentiment_avg → chat off
//   - game_category, stream_title → no se usan downstream
//   - duration_s             → tiene default 30 en DB
//   - ticks_aggregated, frame_analyses_aggregated → default 0 en DB
interface ChunkRow {
  stream_key: string;
  ts_start: string;
  audio_text: string | null;
  audio_summary: string | null;
  audio_mentions: string[] | null;
  audio_intent: 'discussion' | 'recommendation' | 'complaint' | 'question' | 'reaction' | 'silence' | null;
  // Viewers — lee Stage 1 (intensity.ts) como fallback signal: si delta>100
  // gatea aun sin keyword match. Útil para captar momentos virales (raid,
  // bombazo de viewers) sin necesitar trigger word del streamer.
  viewers: number | null;
  viewers_delta_30s: number | null;
}

/**
 * Escribe un row en `context_chunks` cada CHUNK_INTERVAL_MS (default 15s).
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
  let windowStartedAt = Date.now();
  // Viewers tracking entre chunks → calcula delta vs el chunk anterior. Reset
  // a null al perder señal de twitch (offline, 401, etc) → el delta del próximo
  // chunk es null tampoco y Stage 1 lo skipea graciosamente.
  let lastViewers: number | null = null;
  // Mutex — los dos triggers (setInterval CHUNK_INTERVAL_MS + keyword poll)
  // pueden firear al mismo tiempo. Sin esto, dos writeChunk concurrentes
  // duplicarían rows + romperían el cálculo de deltas (ticksAggregated etc).
  let writing = false;
  const lastKeywordFlushAt = new Map<string, number>();

  const writeChunk = async (
    trigger: 'interval' | 'keyword' | 'final' = 'interval',
    matchedKeyword?: string,
  ): Promise<void> => {
    if (!active && chunkCount > 0) return; // evita doble write en stop()
    if (writing) return; // otro writeChunk en curso, este trigger se descarta
    writing = true;
    // Declarado fuera del try para que el webhook fire post-finally pueda leerlo.
    let inserted = false;

    try {
    chunkCount += 1;
    const now = Date.now();
    // Capturamos prevWindowStart ANTES de mover windowStartedAt — es el ts
    // que pasamos a getCommittedSince() para traer SOLO audio nuevo desde el
    // último chunk (sin redundancia con el rolling window de transcribe).
    const prevWindowStart = windowStartedAt;
    const tsStart = new Date(prevWindowStart).toISOString();
    const durationS = Math.round((now - prevWindowStart) / 1000);
    windowStartedAt = now;

    const transcribe = sources.transcribe();
    // audio_text = SOLO commits dentro de (prevWindowStart, now). Si el
    // anterior chunk persistió "che, una banana" hace 5s, este chunk NO lo
    // re-incluye — solo lo nuevo. El rolling window de transcribe sigue
    // usándose para keyword detection (checkKeywords abajo) que sí necesita
    // mirar un toque atrás.
    const audio_text = transcribe?.getCommittedSince(prevWindowStart) || null;

    // Twitch Helix metrics — solo si TWITCH_POLL_ENABLED. Sino getter devuelve
    // null y los campos quedan en null (Stage 1 los skipea graciosamente).
    const tw = sources.twitch()?.getLatest();
    const viewers = tw?.is_live ? tw.viewers : null;
    const viewersDelta =
      lastViewers !== null && viewers !== null ? viewers - lastViewers : null;
    if (viewers !== null) lastViewers = viewers;

    // Sin LLM summary. Cuando el flush lo dispara una keyword, populamos
    // audio_mentions + audio_intent directo (Stage 1 los lee para gate).
    // Stage 2 (pickBrand) lee audio_text crudo así que no pierde info.
    const audio_summary = matchedKeyword ? `streamer mencionó: ${matchedKeyword}` : null;
    const audio_mentions = matchedKeyword ? [matchedKeyword] : null;
    const audio_intent: ChunkRow['audio_intent'] = matchedKeyword ? 'recommendation' : null;

    const chunk: ChunkRow = {
      stream_key: sources.streamKey,
      ts_start: tsStart,
      audio_text,
      audio_summary,
      audio_mentions,
      audio_intent,
      viewers,
      viewers_delta_30s: viewersDelta,
    };

    const textPreview = audio_text
      ? audio_text.slice(0, 80) + (audio_text.length > 80 ? '…' : '')
      : '—';
    log.success(
      `[chunk ${sources.streamKey}] #${chunkCount} (${trigger}) · ${durationS}s · ` +
        `viewers=${viewers ?? '—'}${viewersDelta != null ? ` (Δ${viewersDelta >= 0 ? '+' : ''}${viewersDelta})` : ''} · ` +
        `audio=${matchedKeyword ? `keyword="${matchedKeyword}" intent=recommendation` : '—'} · ` +
        `text="${textPreview}"`,
    );

    if (supabase) {
      const insertStartedAt = Date.now();
      const { data, error } = await supabase
        .from('context_chunks')
        .insert(chunk)
        .select('id, ts_start')
        .single();
      const insertMs = Date.now() - insertStartedAt;
      if (error) {
        log.warn(`[chunk ${sources.streamKey}] insert failed: ${error.message}`);
        console.log(
          JSON.stringify({
            tag: 'pipeline:chunk_insert_error',
            stream_key: sources.streamKey,
            ts_start: tsStart,
            duration_s: durationS,
            insert_ms: insertMs,
            error: error.message,
          }),
        );
      } else {
        // Structured log con chunk_id para correlacionar con manager-tick logs
        // (manager:claim_acquired tiene chunk_id matching).
        console.log(
          JSON.stringify({
            tag: 'pipeline:chunk_inserted',
            stream_key: sources.streamKey,
            chunk_id: data?.id ?? null,
            ts_start: data?.ts_start ?? tsStart,
            duration_s: durationS,
            audio_intent: chunk.audio_intent,
            audio_summary_preview: (chunk.audio_summary ?? '').slice(0, 80),
            audio_mentions: chunk.audio_mentions ?? [],
            viewers: chunk.viewers,
            insert_ms: insertMs,
          }),
        );
        // Solo si el INSERT pasó disparamos el webhook al manager-tick.
        inserted = true;
      }
    } else {
      // Log a consola para visibilidad sin DB.
      console.log(`[chunk ${sources.streamKey}] payload:`, JSON.stringify(chunk, null, 2));
    }
    } finally {
      // Garantizá liberar el mutex incluso si algo throweó arriba (network blip,
      // bug en summarizeAudio etc) — sin esto el flag queda colgado y nunca más
      // se escriben chunks: silent dead pipeline.
      writing = false;
    }

    // Push: notificá al manager-tick que hay un chunk nuevo. Solo si el INSERT
    // efectivo pasó (sino el agent miraría la DB y no encontraría nada nuevo).
    // Fire-and-forget — el próximo writeChunk no espera a esta call.
    if (inserted) fireManagerWebhook(sources.streamKey);
  };

  // Keyword poll — corre cada KEYWORD_POLL_MS si la lista no está vacía. Mira
  // el partial actual + el committed audio de la ventana. Si encuentra una
  // keyword no flusheada en los últimos 30s, dispara writeChunk('keyword').
  const checkKeywords = (): void => {
    if (!FLUSH_KEYWORDS.length) return;
    const t = sources.transcribe();
    if (!t) return;
    const partial = (t.getPartial() || '').toLowerCase();
    const committed = (t.getAudio30s() || '').toLowerCase();
    const combined = `${committed} ${partial}`;
    if (!combined.trim()) return;

    const ts = Date.now();
    for (const kw of FLUSH_KEYWORDS) {
      if (!combined.includes(kw)) continue;
      const last = lastKeywordFlushAt.get(kw) ?? 0;
      if (ts - last < KEYWORD_DEBOUNCE_MS) continue;
      lastKeywordFlushAt.set(kw, ts);
      log.info(`[chunk ${sources.streamKey}] 🚨 keyword "${kw}" detectada → flush instantáneo`);
      // Pasamos la keyword matched para que writeChunk pueda populate
      // audio_mentions sin pegarle al LLM — Stage 1 ya pasa con eso.
      void writeChunk('keyword', kw);
      return; // un flush por cycle alcanza
    }
  };

  const interval = setInterval(() => void writeChunk('interval'), CHUNK_INTERVAL_MS);
  const keywordPoll = FLUSH_KEYWORDS.length
    ? setInterval(checkKeywords, KEYWORD_POLL_MS)
    : null;

  const webhookHint = process.env.MANAGER_WEBHOOK_URL ? ' · webhook=on' : '';
  const keywordHint = FLUSH_KEYWORDS.length
    ? ` · keywords=[${FLUSH_KEYWORDS.join(',')}] poll=${KEYWORD_POLL_MS}ms`
    : '';
  log.info(
    `[chunk ${sources.streamKey}] writer arrancado · cada ${CHUNK_INTERVAL_MS}ms${supabase ? ' → Supabase' : ' → console'}${webhookHint}${keywordHint}`,
  );

  return {
    stop: async () => {
      clearInterval(interval);
      if (keywordPoll) clearInterval(keywordPoll);
      // Último chunk parcial al cerrar (puede ser <CHUNK_INTERVAL_MS pero
      // captura los últimos datos antes del session end).
      try {
        await writeChunk('final');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`[chunk ${sources.streamKey}] final write failed: ${msg}`);
      } finally {
        active = false;
      }
    },
  };
}

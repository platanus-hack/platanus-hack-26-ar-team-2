import type { StreamSession, StreamStats } from './types.js';
import { fetchStreamStats } from './streamStats.js';
import { startTranscribe, type TranscribeHandle } from './transcribe.js';
import { startFrameAnalysis, type FrameHandle, type FrameAnalysisResult } from './frame.js';
import { startTwitchPoll, type TwitchHandle } from './twitch.js';
import { startChat, type ChatHandle, type ChatMetrics } from './chat.js';
import { startRealtimeBus, type RealtimeBus } from './realtimeBus.js';
import { startChunkWriter, type ChunkWriterHandle } from './chunkWriter.js';
import { log } from './log.js';

const POLL_INTERVAL_MS = Number(process.env.STAT_POLL_MS ?? 1000);

interface ActiveSession {
  session: StreamSession;
  pollCount: number;
  lastBytesIn: number;
  lastPollAt: number;
  interval: NodeJS.Timeout;
  transcribe: TranscribeHandle | null;
  frame: FrameHandle | null;
  twitch: TwitchHandle | null;
  chat: ChatHandle | null;
  realtime: RealtimeBus | null;
  chunkWriter: ChunkWriterHandle | null;
}

const sessions = new Map<string, ActiveSession>();

function flattenFrame(latest: { result: FrameAnalysisResult; ageMs: number } | null): Record<string, unknown> {
  if (!latest) {
    return {
      frame_summary: '(no frame analysis yet)',
      scene_type: '(unknown)',
      energy_level: '(unknown)',
      mood_tags: [],
      on_screen_text: null,
      frame_age_ms: null,
    };
  }
  return {
    frame_summary: latest.result.summary,
    scene_type: latest.result.scene_type,
    energy_level: latest.result.energy_level,
    mood_tags: latest.result.mood_tags,
    on_screen_text: latest.result.on_screen_text,
    frame_age_ms: latest.ageMs,
  };
}

function flattenChat(metrics: ChatMetrics | null): Record<string, unknown> {
  if (!metrics) {
    return {
      chat_velocity_now: null,
      chat_velocity_baseline: null,
      chat_sentiment: null,
      chat_recent_keywords: null,
      chat_total_messages: null,
    };
  }
  return {
    chat_velocity_now: metrics.velocity_now,
    chat_velocity_baseline: metrics.velocity_baseline,
    chat_sentiment: metrics.sentiment,
    chat_recent_keywords: metrics.recent_keywords,
    chat_total_messages: metrics.total_messages,
  };
}

function flattenTick(
  stats: StreamStats,
  bwEffectiveKbps: number,
  audio30s: string,
  audioPartial: string,
  frame: { result: FrameAnalysisResult; ageMs: number } | null,
  twitchHandle: TwitchHandle | null,
  chat: ChatMetrics | null,
): Record<string, unknown> {
  const tw = twitchHandle?.getLatest();
  return {
    uptime_s: stats.uptime_seconds,
    bw_effective_kbps: bwEffectiveKbps,
    bytes_in: stats.bytes_in,
    nclients: stats.nclients,
    video: stats.video
      ? `${stats.video.codec} ${stats.video.width}x${stats.video.height}@${stats.video.frame_rate}fps`
      : 'no video meta yet',
    audio: stats.audio
      ? `${stats.audio.codec} ${stats.audio.sample_rate}Hz ch=${stats.audio.channels}`
      : 'no audio meta yet',
    audio_30s: audio30s || '(no committed transcript yet)',
    audio_partial: audioPartial || '(no partial)',
    ...flattenFrame(frame),
    ...flattenChat(chat),
    twitch_viewers: tw?.is_live ? tw.viewers : '(offline / no twitch)',
    twitch_game: tw?.game_category || null,
    twitch_title: tw?.stream_title || null,
  };
}

export interface StartSessionOptions {
  // Canal Twitch a monitorear para esta sesión (chat tmi.js + Helix viewers).
  // Default = stream_key (asume que el creator usa su username de Twitch como
  // stream_key). En producción, el handler del on_publish lookups por
  // stream_key en `accounts.metadata.twitch_channel` y pasa el valor explícito.
  twitchChannel?: string;
}

function resolveTwitchChannel(streamKey: string, opts?: StartSessionOptions): string {
  // Prioridad: override (testing standalone) → opts.twitchChannel (lookup
  // de DB en producción) → stream_key del nginx-rtmp como default.
  return process.env.TWITCH_CHANNEL_OVERRIDE || opts?.twitchChannel || streamKey;
}

export function startSession(session: StreamSession, opts?: StartSessionOptions): void {
  const key = session.name;
  if (sessions.has(key)) {
    log.warn(`session ${key} already active, ignoring duplicate on_publish`);
    return;
  }
  const twitchChannel = resolveTwitchChannel(key, opts);
  log.success(
    `▶ session started · stream_key=${key} · twitch_channel=${twitchChannel} · ts=${new Date(session.started_at).toISOString()}`,
  );
  log.info(`polling nginx-rtmp /stat every ${POLL_INTERVAL_MS}ms for real stream metrics`);

  const state: ActiveSession = {
    session,
    pollCount: 0,
    lastBytesIn: 0,
    lastPollAt: 0,
    transcribe: null,
    frame: null,
    twitch: null,
    chat: null,
    realtime: null,
    chunkWriter: null,
    interval: setInterval(async () => {
      state.pollCount += 1;
      const stats = await fetchStreamStats(key);
      if (!stats) {
        if (state.pollCount <= 3) {
          log.info(`tick #${String(state.pollCount).padStart(3, '0')} — esperando metadata del stream…`);
        } else {
          log.warn(`tick #${String(state.pollCount).padStart(3, '0')} — /stat no devuelve datos para "${key}"`);
        }
        return;
      }
      const now = Date.now();
      const dtSec = state.lastPollAt > 0 ? (now - state.lastPollAt) / 1000 : 0;
      const dBytes = stats.bytes_in - state.lastBytesIn;
      const bwEffectiveKbps =
        dtSec > 0 && dBytes >= 0 ? Math.round((dBytes * 8) / 1000 / dtSec) : 0;
      state.lastBytesIn = stats.bytes_in;
      state.lastPollAt = now;

      const audio30s = state.transcribe?.getAudio30s() ?? '';
      const audioPartial = state.transcribe?.getPartial() ?? '';
      const frame = state.frame?.getLatest() ?? null;
      const chat = state.chat?.getMetrics() ?? null;

      const tickPayload = flattenTick(stats, bwEffectiveKbps, audio30s, audioPartial, frame, state.twitch, chat);
      log.tick(state.pollCount, tickPayload);

      // Broadcast a Realtime channel `context:<stream_key>` para que el
      // manager-worker (Track C / Andy) consuma. No-op si SUPABASE_URL no está.
      if (state.realtime) {
        void state.realtime.broadcast('tick', {
          stream_key: key,
          tick_number: state.pollCount,
          ts: now,
          ...tickPayload,
        });
      }
    }, POLL_INTERVAL_MS),
  };

  sessions.set(key, state);

  // Pipes en paralelo. Cada uno se desactiva graciosamente si su dep falta.
  startTranscribe(key)
    .then((handle) => {
      const active = sessions.get(key);
      if (active && handle) active.transcribe = handle;
    })
    .catch((e) => log.warn(`[transcribe ${key}] start failed: ${e instanceof Error ? e.message : e}`));

  // Frame analysis (Claude Haiku vision @ FRAME_FPS) está apagado por default
  // desde 2026-05-09 para el demo: el agent es 100% audio-driven (keyword en
  // partial transcript → flush instantáneo del chunk → manager-tick). El frame
  // analysis era info extra para el picker (scene_type, mood_tags) pero su
  // costo (RPM Anthropic + ~$0.001 por frame) no se justifica si el match ya
  // pega solo con keyword + audio_text. Encendelo si querés que el picker
  // tenga contexto visual:  FRAME_ANALYSIS_ENABLED=true
  if (process.env.FRAME_ANALYSIS_ENABLED === 'true') {
    startFrameAnalysis(key)
      .then((handle) => {
        const active = sessions.get(key);
        if (active && handle) active.frame = handle;
      })
      .catch((e) => log.warn(`[frame ${key}] start failed: ${e instanceof Error ? e.message : e}`));
  } else {
    log.info(`[frame ${key}] disabled (FRAME_ANALYSIS_ENABLED!=true) — pipeline 100% audio-driven`);
  }

  // Twitch Helix poll (viewers, game_category, stream_title) — DEFAULT ON.
  // Viewers + viewers_delta_30s son señal valiosa para Stage 1 (gatea ads en
  // momentos virales: raid, bombazo de viewers, etc) y para el pitch.
  // Apagar explícitamente:  TWITCH_POLL_ENABLED=false
  if (process.env.TWITCH_POLL_ENABLED !== 'false') {
    startTwitchPoll(key, twitchChannel)
      .then((handle) => {
        const active = sessions.get(key);
        if (active && handle) active.twitch = handle;
      })
      .catch((e) => log.warn(`[twitch ${key}] start failed: ${e instanceof Error ? e.message : e}`));
  } else {
    log.info(`[twitch ${key}] disabled (TWITCH_POLL_ENABLED=false)`);
  }

  // Chat (tmi.js IRC anonymous read-only) está apagado por default desde
  // 2026-05-09. El chunkWriter ya no lee chat_velocity / sentiment / etc.
  // Encender:  CHAT_ENABLED=true
  if (process.env.CHAT_ENABLED === 'true') {
    startChat(key, twitchChannel)
      .then((handle) => {
        const active = sessions.get(key);
        if (active && handle) active.chat = handle;
      })
      .catch((e) => log.warn(`[chat ${key}] start failed: ${e instanceof Error ? e.message : e}`));
  } else {
    log.info(`[chat ${key}] disabled (CHAT_ENABLED!=true)`);
  }

  startRealtimeBus(key)
    .then((handle) => {
      const active = sessions.get(key);
      if (active && handle) active.realtime = handle;
    })
    .catch((e) => log.warn(`[realtime ${key}] start failed: ${e instanceof Error ? e.message : e}`));

  // Chunk writer arranca de inmediato (no async). Los handles los toma con
  // getters lazy — si no están listos al primer chunk, los campos quedan en NULL.
  state.chunkWriter = startChunkWriter({
    streamKey: key,
    transcribe: () => state.transcribe,
    frame: () => state.frame,
    twitch: () => state.twitch,
    chat: () => state.chat,
    getTickCount: () => state.pollCount,
    getFrameCount: () => state.frame?.getAnalysisCount() ?? 0,
  });
}

export function stopSession(streamKey: string): void {
  const active = sessions.get(streamKey);
  if (!active) {
    log.warn(`no active session for ${streamKey}`);
    return;
  }
  clearInterval(active.interval);

  // ChunkWriter primero: escribe chunk final antes de cerrar pipes.
  const cleanups: Promise<void>[] = [];
  if (active.chunkWriter) cleanups.push(active.chunkWriter.stop().catch(() => {}));
  if (active.transcribe) cleanups.push(active.transcribe.stop().catch(() => {}));
  if (active.frame) cleanups.push(active.frame.stop().catch(() => {}));
  if (active.twitch) cleanups.push(active.twitch.stop().catch(() => {}));
  if (active.chat) cleanups.push(active.chat.stop().catch(() => {}));
  if (active.realtime) cleanups.push(active.realtime.stop().catch(() => {}));
  void Promise.all(cleanups);

  sessions.delete(streamKey);
  const durationMs = Date.now() - active.session.started_at;
  log.success(
    `■ session stopped · stream_key=${streamKey} · ${active.pollCount} polls · ` +
      `duration=${(durationMs / 1000).toFixed(1)}s · total_bytes_in=${active.lastBytesIn}`,
  );
}

export function listActiveSessions(): string[] {
  return [...sessions.keys()];
}

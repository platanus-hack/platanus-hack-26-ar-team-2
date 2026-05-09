import type { StreamSession, StreamStats } from './types.js';
import { fetchStreamStats } from './streamStats.js';
import { startTranscribe, type TranscribeHandle } from './transcribe.js';
import { startFrameAnalysis, type FrameHandle, type FrameAnalysisResult } from './frame.js';
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

function flattenStats(
  stats: StreamStats,
  bwEffectiveKbps: number,
  audio30s: string,
  audioPartial: string,
  frame: { result: FrameAnalysisResult; ageMs: number } | null,
): Record<string, unknown> {
  return {
    uptime_s: stats.uptime_seconds,
    bw_effective_kbps: bwEffectiveKbps,
    bw_in_kbps: stats.bw_in_kbps,
    bw_video_kbps: stats.bw_video_kbps,
    bw_audio_kbps: stats.bw_audio_kbps,
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
  };
}

export function startSession(session: StreamSession): void {
  const key = session.name;
  if (sessions.has(key)) {
    log.warn(`session ${key} already active, ignoring duplicate on_publish`);
    return;
  }
  log.success(`▶ session started · stream_key=${key} · ts=${new Date(session.started_at).toISOString()}`);
  log.info(`polling nginx-rtmp /stat every ${POLL_INTERVAL_MS}ms for real stream metrics`);

  const state: ActiveSession = {
    session,
    pollCount: 0,
    lastBytesIn: 0,
    lastPollAt: 0,
    transcribe: null,
    frame: null,
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
      log.tick(state.pollCount, flattenStats(stats, bwEffectiveKbps, audio30s, audioPartial, frame));
    }, POLL_INTERVAL_MS),
  };

  sessions.set(key, state);

  // Audio + frame pipes arrancan en paralelo. Si una API key falta o falla, el
  // resto sigue andando — los pipes son independientes.
  startTranscribe(key)
    .then((handle) => {
      const active = sessions.get(key);
      if (active && handle) active.transcribe = handle;
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[transcribe ${key}] start failed: ${msg}`);
    });

  startFrameAnalysis(key)
    .then((handle) => {
      const active = sessions.get(key);
      if (active && handle) active.frame = handle;
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[frame ${key}] start failed: ${msg}`);
    });
}

export function stopSession(streamKey: string): void {
  const active = sessions.get(streamKey);
  if (!active) {
    log.warn(`no active session for ${streamKey}`);
    return;
  }
  clearInterval(active.interval);
  active.transcribe?.stop().catch(() => {
    /* swallow — cleanup best-effort */
  });
  active.frame?.stop().catch(() => {
    /* swallow */
  });
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

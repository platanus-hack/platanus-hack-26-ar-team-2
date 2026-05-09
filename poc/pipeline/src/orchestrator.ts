import type { StreamSession, StreamStats } from './types.js';
import { fetchStreamStats } from './streamStats.js';
import { log } from './log.js';

const POLL_INTERVAL_MS = Number(process.env.STAT_POLL_MS ?? 1000);

interface ActiveSession {
  session: StreamSession;
  pollCount: number;
  lastBytesIn: number;
  lastPollAt: number;
  interval: NodeJS.Timeout;
}

const sessions = new Map<string, ActiveSession>();

function flattenStats(stats: StreamStats, bwEffectiveKbps: number): Record<string, unknown> {
  return {
    uptime_s: stats.uptime_seconds,
    // bw_effective deriva del delta de bytes_in entre ticks → siempre poblado.
    // bw_in/bw_video/bw_audio del XML solo se llenan cuando hay subscribers,
    // los dejo abajo como referencia pero suelen ser 0 con solo publisher.
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
      log.tick(state.pollCount, flattenStats(stats, bwEffectiveKbps));
    }, POLL_INTERVAL_MS),
  };

  sessions.set(key, state);
}

export function stopSession(streamKey: string): void {
  const active = sessions.get(streamKey);
  if (!active) {
    log.warn(`no active session for ${streamKey}`);
    return;
  }
  clearInterval(active.interval);
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

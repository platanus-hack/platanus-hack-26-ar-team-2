import { spawn, type ChildProcess } from 'child_process';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import {
  AudioFormat,
  CommitStrategy,
  RealtimeEvents,
  type RealtimeConnection,
} from '@elevenlabs/elevenlabs-js/wrapper/realtime';
import { log } from './log.js';

// Default 15s — bajado desde 30s el 2026-05-09 para matchear CHUNK_INTERVAL_MS
// (chunkWriter.ts). Si rolling > chunk → cada chunk va a tener overlap del
// audio_text con el chunk anterior (redundancia + más tokens en Gemini summary).
// Si rolling < chunk → audio_text va a perder los primeros segundos. Mejor
// matchear los dos.
const ROLLING_WINDOW_MS = Number(process.env.AUDIO_ROLLING_WINDOW_MS ?? 15_000);
const MODEL_ID = process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2_realtime';
const LANGUAGE_CODE = process.env.ELEVENLABS_STT_LANGUAGE ?? 'es';

// Keyterms: lista (coma-separada) de palabras que sesgan al modelo. Útil para slang
// rioplatense, nombres de streamers, marcas. Max 50, cada una max 20 chars (limite
// de la API). Si una keyterm supera 20 chars, ElevenLabs la rechaza la sesión entera.
function parseKeyterms(): string[] | undefined {
  const raw = process.env.ELEVENLABS_STT_KEYTERMS;
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 20)
    .slice(0, 50);
  return list.length > 0 ? list : undefined;
}

interface CommittedEntry {
  text: string;
  ts: number;
}

export interface TranscribeHandle {
  getAudio30s(): string;
  getPartial(): string;
  isActive(): boolean;
  stop(): Promise<void>;
}

/**
 * Arranca el pipeline de audio para un stream activo:
 *  - ffmpeg pulla el RTMP, decodea audio a PCM 16kHz mono (sin headers).
 *  - Cada chunk se manda como base64 al WS realtime de ElevenLabs Scribe v2.
 *  - VAD del lado del server detecta pausas y emite committed_transcript.
 *  - Mantenemos una ventana móvil de últimos 30s (configurable) y el partial actual.
 *
 * Si no hay ELEVENLABS_API_KEY, no falla — devuelve null y el resto del pipeline
 * sigue funcionando (frame analysis y chat son independientes).
 */
export async function startTranscribe(streamKey: string): Promise<TranscribeHandle | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    log.warn(`[transcribe ${streamKey}] ELEVENLABS_API_KEY missing → audio pipe disabled`);
    return null;
  }

  const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;
  const elevenlabs = new ElevenLabsClient({ apiKey });

  const entries: CommittedEntry[] = [];
  let partial = '';
  let active = true;
  let conn: RealtimeConnection | null = null;
  let ffmpeg: ChildProcess | null = null;

  const keyterms = parseKeyterms();

  try {
    conn = await elevenlabs.speechToText.realtime.connect({
      modelId: MODEL_ID,
      audioFormat: AudioFormat.PCM_16000,
      sampleRate: 16000,
      commitStrategy: CommitStrategy.VAD,
      languageCode: LANGUAGE_CODE,
      ...(keyterms ? { keyterms } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[transcribe ${streamKey}] connect failed: ${msg}`);
    return null;
  }

  conn.on(RealtimeEvents.SESSION_STARTED, () => {
    const ktSummary = keyterms ? ` · keyterms=${keyterms.length}` : '';
    log.success(`[transcribe ${streamKey}] WS open · model=${MODEL_ID} · lang=${LANGUAGE_CODE}${ktSummary}`);
  });

  conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (msg) => {
    partial = msg.text;
  });

  conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (msg) => {
    entries.push({ text: msg.text, ts: Date.now() });
    partial = '';
    const cutoff = Date.now() - ROLLING_WINDOW_MS;
    while (entries.length && entries[0].ts < cutoff) entries.shift();
    log.info(`[transcribe ${streamKey}] ✓ "${msg.text}"`);
  });

  conn.on(RealtimeEvents.ERROR, (err) => {
    if (err instanceof Error) {
      log.warn(`[transcribe ${streamKey}] WS error: ${err.message}`);
    } else {
      log.warn(`[transcribe ${streamKey}] server ${err.message_type}: ${err.error}`);
    }
  });

  conn.on(RealtimeEvents.CLOSE, () => {
    if (active) log.info(`[transcribe ${streamKey}] WS closed`);
  });

  // ffmpeg: pulla el stream RTMP, decodea solo el audio a PCM raw 16kHz mono.
  // -reconnect_streamed permite reconectar si el publisher pierde el stream.
  ffmpeg = spawn(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-i', rtmpUrl,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  ffmpeg.stdout?.on('data', (chunk: Buffer) => {
    if (!active || !conn) return;
    try {
      conn.send({ audioBase64: chunk.toString('base64') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[transcribe ${streamKey}] ws send failed: ${msg}`);
    }
  });

  ffmpeg.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log.warn(`[transcribe ${streamKey}] ffmpeg: ${msg}`);
  });

  ffmpeg.on('close', (code) => {
    if (active) log.info(`[transcribe ${streamKey}] ffmpeg exited code=${code}`);
  });

  return {
    getAudio30s: () => {
      const cutoff = Date.now() - ROLLING_WINDOW_MS;
      return entries
        .filter((e) => e.ts >= cutoff)
        .map((e) => e.text)
        .join(' ')
        .trim();
    },
    getPartial: () => partial,
    isActive: () => active,
    stop: async () => {
      active = false;
      try {
        ffmpeg?.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      try {
        conn?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

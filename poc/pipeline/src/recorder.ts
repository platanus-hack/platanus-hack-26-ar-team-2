import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { log } from './log.js';

const SEGMENT_TIME_S = Number(process.env.RECORDER_SEGMENT_TIME_S ?? 5);
const SEGMENT_COUNT = Number(process.env.RECORDER_SEGMENT_COUNT ?? 4);
const RECORD_DIR = process.env.RECORDER_DIR ?? '/tmp/addie-record';

export interface RecorderHandle {
  /** Directorio donde están los segmentos rotativos `segment_0.ts`..`segment_N.ts`. */
  getRecordDir(): string;
  stop(): Promise<void>;
}

/**
 * ffmpeg long-lived que pulla el RTMP y escribe segmentos rotativos al disco
 * (`-f segment -segment_wrap N -segment_time S`). Siempre tenés los últimos
 * SEGMENT_COUNT × SEGMENT_TIME_S segundos disponibles. Defaults: 4 × 5s = 20s.
 *
 * El recorder NO transcodifica (`-c copy`) — overhead mínimo y mantiene los
 * keyframes originales. ffmpeg rota los archivos en círculo: cuando llega al
 * segment_3.ts, vuelve a segment_0.ts y lo sobrescribe. Cero cron, cero cleanup.
 *
 * Lo consume `auditClip.ts` cuando llega POST /api/audit/clip — concatena los
 * 2 segmentos más nuevos (10s) con `ffmpeg -f concat`.
 */
export function startRecorder(streamKey: string): RecorderHandle {
  const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;
  const dir = `${RECORD_DIR}/${streamKey}`;

  // Limpio el dir por si quedaron .ts de una sesión anterior con el mismo
  // stream_key. ffmpeg los sobrescribiría igual cuando rote, pero borrarlos
  // de antemano evita que `auditClip.ts` levante segmentos viejos si lo
  // llaman antes de que el recorder genere los primeros nuevos.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  mkdirSync(dir, { recursive: true });

  let active = true;
  const ffmpeg: ChildProcess = spawn(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-i', rtmpUrl,
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(SEGMENT_TIME_S),
      '-segment_wrap', String(SEGMENT_COUNT),
      '-segment_format', 'mpegts',
      '-reset_timestamps', '1',
      `${dir}/segment_%d.ts`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  ffmpeg.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log.warn(`[recorder ${streamKey}] ffmpeg: ${msg}`);
  });

  ffmpeg.on('close', (code) => {
    if (active) log.info(`[recorder ${streamKey}] ffmpeg exited code=${code}`);
  });

  log.success(
    `[recorder ${streamKey}] arrancado · dir=${dir} · ${SEGMENT_COUNT}×${SEGMENT_TIME_S}s buffer (${SEGMENT_COUNT * SEGMENT_TIME_S}s total)`,
  );

  return {
    getRecordDir: () => dir,
    stop: async () => {
      active = false;
      try {
        ffmpeg.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    },
  };
}

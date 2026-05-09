import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { log } from './log.js';

const TEMP_DIR = process.env.AUDIT_CLIP_TEMP_DIR ?? '/tmp/addie-clips';
const SEGMENT_TIME_S = Number(process.env.RECORDER_SEGMENT_TIME_S ?? 5);
const DEFAULT_DURATION_S = Number(process.env.AUDIT_CLIP_DURATION_S ?? 10);

export interface CaptureClipInput {
  streamKey: string;
  placementId: string;
  recordDir: string;
  /** Segundos a capturar contando hacia atrás desde "ahora". Default 10. */
  durationS?: number;
}

export interface CaptureClipResult {
  clip_url: string;
  size_bytes: number;
  duration_s: number;
  source: 'vercel-blob';
  segments_used: number;
}

/**
 * Error específico cuando falta `BLOB_READ_WRITE_TOKEN`. El endpoint
 * `/api/audit/clip` lo mapea a HTTP 503 — el caller (apps/web) puede
 * distinguir esto de un fallo de ffmpeg (500). Decisión 2026-05-09:
 * el audit clip es la pata "auditable" del pitch — sin URL pública la
 * marca no puede consumirlo. Si la token falta, fallamos explícito y
 * obligamos a P0-14 (Andy) antes de seguir, en vez de devolver un
 * `file://` que apps/web no puede servir.
 */
export class MissingBlobTokenError extends Error {
  constructor() {
    super('BLOB_READ_WRITE_TOKEN no está cargada — audit clip requiere Vercel Blob (P0-14, Andy).');
    this.name = 'MissingBlobTokenError';
  }
}

/**
 * Toma los N segmentos rotativos más recientes del recorder, los concatena
 * con `ffmpeg -f concat` (sin re-encode → fast), y sube el mp4 final a
 * Vercel Blob. **Requiere `BLOB_READ_WRITE_TOKEN`** — sin la token tira
 * `MissingBlobTokenError` antes de invocar ffmpeg.
 *
 * Estrategia de selección de segmentos: ordenamos los .ts por mtime DESC
 * (más nuevo primero), tomamos `ceil(durationS / SEGMENT_TIME_S)`, los
 * reordenamos cronológicamente y los pasamos a ffmpeg concat. ffmpeg después
 * trunca al exact `durationS` con `-t`.
 *
 * Importante: no asumimos que los archivos se llamen segment_0,1,2,3 en orden.
 * Cuando ffmpeg rota (segment_wrap=4), `segment_0.ts` puede ser MÁS NUEVO que
 * `segment_3.ts` después del primer ciclo. Por eso ordenamos por mtime, no por
 * nombre. Si filtramos por nombre, después del primer wrap el clip queda
 * desordenado (artifacts visuales feos).
 */
export async function captureClip(input: CaptureClipInput): Promise<CaptureClipResult> {
  const { streamKey, placementId, recordDir, durationS = DEFAULT_DURATION_S } = input;

  // Pre-check: token requerida ANTES de gastar ffmpeg. Falla rápido.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) throw new MissingBlobTokenError();

  if (!existsSync(recordDir)) {
    throw new Error(`record dir does not exist: ${recordDir} (¿está activo el recorder?)`);
  }

  const segments = readdirSync(recordDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => {
      const path = `${recordDir}/${f}`;
      return { path, mtime: statSync(path).mtimeMs, size: statSync(path).size };
    })
    .filter((s) => s.size > 0) // descartar archivos vacíos en escritura
    .sort((a, b) => b.mtime - a.mtime);

  if (segments.length === 0) {
    throw new Error(`no segments in ${recordDir} — el stream recién arrancó? (esperá ${SEGMENT_TIME_S}s)`);
  }

  const needed = Math.min(Math.ceil(durationS / SEGMENT_TIME_S), segments.length);
  const selected = segments.slice(0, needed).reverse(); // chronological

  mkdirSync(TEMP_DIR, { recursive: true });
  const concatList = `${TEMP_DIR}/${placementId}.txt`;
  const outPath = `${TEMP_DIR}/${placementId}.mp4`;

  // ffmpeg concat demuxer requiere un archivo de texto con `file '<path>'` por línea.
  // -safe 0 permite paths absolutos.
  writeFileSync(
    concatList,
    selected.map((s) => `file '${s.path}'`).join('\n') + '\n',
  );

  await runFfmpeg([
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatList,
    '-t', String(durationS),
    '-c', 'copy',
    '-movflags', '+faststart', // moov atom al frente para playback instantáneo en web
    '-y',
    outPath,
  ]);

  const size = statSync(outPath).size;
  log.info(
    `[clip ${streamKey}] concat ok · placement=${placementId} · ${(size / 1024).toFixed(1)}KB · ${selected.length} segments → ${durationS}s`,
  );

  // Upload a Vercel Blob (única source válida — sin fallback local).
  const { put } = await import('@vercel/blob');
  const buffer = readFileSync(outPath);
  const blobPath = `audit-clips/${streamKey}/${placementId}.mp4`;
  const result = await put(blobPath, buffer, {
    access: 'public',
    token: blobToken,
    contentType: 'video/mp4',
  });

  // Limpiar archivos temporales — Vercel Blob es la fuente de verdad ahora.
  try {
    unlinkSync(concatList);
    unlinkSync(outPath);
  } catch {
    /* ignore */
  }

  log.success(
    `[clip ${streamKey}] uploaded to Vercel Blob · placement=${placementId} · ${result.url}`,
  );

  return {
    clip_url: result.url,
    size_bytes: size,
    duration_s: durationS,
    source: 'vercel-blob',
    segments_used: selected.length,
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    ff.on('error', (e) => reject(e));
  });
}

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { log } from './log.js';

const FALLBACK_DIR = process.env.AUDIT_CLIP_FALLBACK_DIR ?? '/tmp/addie-clips';
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
  source: 'vercel-blob' | 'local';
  segments_used: number;
}

/**
 * Toma los N segmentos rotativos más recientes del recorder, los concatena
 * con `ffmpeg -f concat` (sin re-encode → fast), y sube el mp4 final a
 * Vercel Blob. Si `BLOB_READ_WRITE_TOKEN` no está cargado, fallback a
 * `/tmp/addie-clips/` y devuelve un `file://` URL — apps/web puede UPDATE-ear
 * después cuando el upload esté disponible.
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

  mkdirSync(FALLBACK_DIR, { recursive: true });
  const concatList = `${FALLBACK_DIR}/${placementId}.txt`;
  const outPath = `${FALLBACK_DIR}/${placementId}.mp4`;

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

  // Intentar upload a Vercel Blob si está la token cargada.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    try {
      const { put } = await import('@vercel/blob');
      const buffer = readFileSync(outPath);
      const blobPath = `audit-clips/${streamKey}/${placementId}.mp4`;
      const result = await put(blobPath, buffer, {
        access: 'public',
        token: blobToken,
        contentType: 'video/mp4',
      });
      // Limpiar local — Vercel Blob es la fuente de verdad ahora.
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[clip ${streamKey}] Vercel Blob upload failed: ${msg} · fallback to local`);
    }
  } else {
    log.info(
      `[clip ${streamKey}] BLOB_READ_WRITE_TOKEN missing · clip guardado local en ${outPath}`,
    );
  }

  // Fallback: dejamos el archivo local. apps/web puede consumir el path o
  // re-uploadearlo después si la token aparece.
  return {
    clip_url: `file://${outPath}`,
    size_bytes: size,
    duration_s: durationS,
    source: 'local',
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

/**
 * Smoke test del audit clip — genera 4 segmentos .ts dummy con ffmpeg
 * (colores sólidos distintos), llama a `captureClip()` con ese dir, y
 * verifica que el upload a Vercel Blob devuelva un URL público válido.
 *
 * NO requiere RTMP activo / OBS / docker. Valida la lógica de concat +
 * selección de segments + upload a Vercel Blob end-to-end.
 *
 * **Requiere `BLOB_READ_WRITE_TOKEN` cargada en .env** — sin la token
 * `captureClip()` tira `MissingBlobTokenError` y este smoke exit 1 con
 * mensaje claro pidiendo que Andy cierre P0-14.
 *
 * Uso: npm run smoke:clip
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { captureClip, MissingBlobTokenError } from '../src/auditClip.js';

const SMOKE_DIR = `/tmp/addie-smoke-record/${Date.now()}`;
const COLORS = ['red', 'green', 'blue', 'yellow'];
const SEGMENT_S = 5;

function generateSegment(idx: number, color: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const path = `${SMOKE_DIR}/segment_${idx}.ts`;
    const ff = spawn(
      'ffmpeg',
      [
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', `color=c=${color}:size=320x240:rate=30`,
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=mono:sample_rate=16000',
        '-t', String(SEGMENT_S),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-shortest',
        '-f', 'mpegts',
        '-y',
        path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ff.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`→ smoke test audit clip · dir=${SMOKE_DIR}`);
  console.log('');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('✗ BLOB_READ_WRITE_TOKEN no está cargada en .env');
    console.error('');
    console.error('   El audit clip REQUIERE Vercel Blob (P0-14, Andy).');
    console.error('   Sin la token, `captureClip()` tira MissingBlobTokenError y el');
    console.error('   endpoint POST /api/audit/clip devuelve HTTP 503.');
    console.error('');
    console.error('   Cómo conseguirla:');
    console.error('   1. Andy → Vercel Dashboard → Storage → Blob → crear store si no existe');
    console.error('   2. Pegá la token en poc/pipeline/.env como BLOB_READ_WRITE_TOKEN=...');
    console.error('   3. Re-correr `npm run smoke:clip`');
    process.exit(1);
  }

  // Setup: generamos 4 segmentos secuencialmente para que sus mtime queden
  // ordenados (auditClip.ts ordena por mtime, no por nombre).
  mkdirSync(SMOKE_DIR, { recursive: true });
  for (let i = 0; i < COLORS.length; i++) {
    process.stdout.write(`   generating segment_${i}.ts (${COLORS[i]}) ... `);
    const t0 = Date.now();
    await generateSegment(i, COLORS[i]);
    console.log(`${Date.now() - t0}ms`);
    // Pequeño delay para que mtime de archivos sea distinto y ordenable.
    await sleep(50);
  }
  console.log('');
  console.log('   provider: vercel-blob (BLOB_READ_WRITE_TOKEN cargada)');
  console.log('   capturing 10s clip from 4×5s segments...');
  console.log('');

  const t0 = Date.now();
  let result;
  try {
    result = await captureClip({
      streamKey: 'smoke-stream',
      placementId: `smoke-${Date.now()}`,
      recordDir: SMOKE_DIR,
      durationS: 10,
    });
  } catch (e) {
    if (e instanceof MissingBlobTokenError) {
      // No debería pasar dado el guard arriba, pero por las dudas.
      console.error('✗ captureClip rechazó la token — ¿está vacía?');
      process.exit(1);
    }
    throw e;
  }
  const ms = Date.now() - t0;

  console.log(`✓ ${ms}ms`);
  console.log('');
  console.log('   clip_url:     ', result.clip_url);
  console.log('   source:       ', result.source);
  console.log('   size_bytes:   ', result.size_bytes, `(${(result.size_bytes / 1024).toFixed(1)} KB)`);
  console.log('   duration_s:   ', result.duration_s);
  console.log('   segments_used:', result.segments_used);
  console.log('');

  // Validaciones básicas.
  if (result.size_bytes <= 0) {
    throw new Error(`clip vacío: size_bytes=${result.size_bytes}`);
  }
  if (result.segments_used !== 2) {
    throw new Error(`esperaba 2 segments para 10s/5s, usó ${result.segments_used}`);
  }
  if (!result.clip_url.startsWith('http')) {
    throw new Error(`clip_url debería ser una URL pública, recibí: ${result.clip_url}`);
  }
  console.log('   ✓ uploaded a Vercel Blob');

  // Cleanup local
  try {
    rmSync(SMOKE_DIR, { recursive: true, force: true });
    console.log(`   ✓ cleanup: borrado ${SMOKE_DIR}`);
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error('✗ smoke test failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

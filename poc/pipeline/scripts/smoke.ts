/**
 * Smoke test — simula los webhooks que mandaría nginx-rtmp.
 *
 * Asume que `npm run demo` ya está corriendo en :3000 (o PIPELINE_PORT).
 *
 * Útil para verificar el flow webhook → orchestrator → polling /stat → log
 * sin tener que levantar OBS. Como no hay un stream real publicando, el
 * polling va a reportar "esperando metadata" / "/stat no devuelve datos" — eso
 * está bien, lo que se valida acá es el ciclo de sesión, no la captura.
 */
import 'dotenv/config';

const PORT = process.env.PIPELINE_PORT ?? '3000';
const BASE = `http://localhost:${PORT}`;
const STREAM_KEY = process.argv[2] ?? `smoke-${Date.now()}`;
const HOLD_MS = Number(process.env.SMOKE_HOLD_MS ?? 4000);

async function postForm(path: string, body: Record<string, string>): Promise<void> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
}

async function main() {
  console.log(`smoke test against ${BASE} · stream_key=${STREAM_KEY}`);

  console.log('→ checking /health');
  const h = await fetch(`${BASE}/health`).catch(() => null);
  if (!h || !h.ok) {
    console.error(`✗ server no responde en ${BASE}. Levanta "npm run demo" antes.`);
    process.exit(1);
  }
  console.log(`✓ /health → ${await h.text()}`);

  console.log('→ POST on_publish');
  await postForm('/api/stream/on-publish', {
    app: 'live',
    name: STREAM_KEY,
    addr: '127.0.0.1',
    tcurl: 'rtmp://localhost/live',
  });

  console.log(`→ holding ${HOLD_MS}ms (mirá la terminal del server: deberías ver "esperando metadata" mientras no haya OBS streamando)`);
  await new Promise((r) => setTimeout(r, HOLD_MS));

  console.log('→ POST on_publish_done');
  await postForm('/api/stream/on-publish-done', {
    app: 'live',
    name: STREAM_KEY,
    addr: '127.0.0.1',
  });

  console.log('✓ smoke test done');
}

main().catch((e) => {
  console.error('✗ smoke test failed:', e);
  process.exit(1);
});

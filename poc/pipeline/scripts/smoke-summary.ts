/**
 * Smoke test del audio summary — llama summarizeAudio con un transcript fake
 * y muestra el output. Valida que el provider directo (ANTHROPIC_API_KEY) +
 * model name + Zod schema funcionen end-to-end SIN necesitar OBS ni RTMP.
 *
 * Uso: npm run smoke:summary
 *
 * Si esto pasa, el pipeline real va a funcionar cuando llegue audio_text del
 * transcribe.
 */
import 'dotenv/config';
import { summarizeAudio } from '../src/audioSummary.js';

const FAKE_TRANSCRIPT =
  'che chicos miren este gol que metió Messi recién, fue una locura. Para mí River juega mejor pero bueno. Y por cierto me tomé una Quilmes ahora antes del stream, está demasiado fría hermano. ¿Ustedes qué cerveza prefieren? metan en el chat. Boludo bancame que voy a buscar la pizza que pedí en Pedidos Ya hace media hora.';

async function main() {
  console.log('→ smoke test audio summary');
  console.log('   transcript:', FAKE_TRANSCRIPT);
  console.log('');
  console.log('   provider:', process.env.ANTHROPIC_API_KEY ? 'anthropic-direct (ANTHROPIC_API_KEY)' : 'ai-gateway (AI_GATEWAY_API_KEY)');
  console.log('   model:', process.env.AUDIO_SUMMARY_MODEL ?? 'claude-haiku-4-5');
  console.log('');

  const t0 = Date.now();
  const result = await summarizeAudio('smoke', {
    audioText: FAKE_TRANSCRIPT,
    sceneType: 'creator hablando a cámara',
    onScreenText: null,
    gameCategory: 'Just Chatting',
  });
  const ms = Date.now() - t0;

  if (!result) {
    console.error(`✗ summarizeAudio devolvió null después de ${ms}ms — ¿falta ANTHROPIC_API_KEY/AI_GATEWAY_API_KEY?`);
    process.exit(1);
  }

  console.log(`✓ ${ms}ms`);
  console.log('');
  console.log('   summary:', result.summary);
  console.log('   topics:', result.topics);
  console.log('   mentions:', result.mentions);
  console.log('   intent:', result.intent);
}

main().catch((e) => {
  console.error('✗ smoke test failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

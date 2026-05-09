import { spawn, type ChildProcess } from 'child_process';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel, isUsingDirectProvider } from './aiModel.js';
import { log } from './log.js';

const MODEL_STRING = process.env.FRAME_MODEL ?? 'gemini-3.1-flash-lite';
const MODEL = resolveModel(MODEL_STRING);
// Frames por segundo capturados del stream. Default 0.5 (1 cada 2s) por el
// rate limit del free tier de Google AI Studio (15 RPM en Flash-Lite). Con 1
// FPS chocábamos. Subí esto si usás un tier pagado.
const FPS = Number(process.env.FRAME_FPS ?? 0.5);

// Schema agnóstico al contenido. El modelo NO debe asumir gaming, IRL, cocina,
// charla — solo describir lo que VE. Estos campos se mergean al ContextTick y
// los consume el brand-agent para decidir bid + ad apropiado.
const FrameAnalysis = z.object({
  scene_type: z
    .string()
    .describe(
      'tipo de contenido en lenguaje libre, en español. Ejemplos: "gameplay de fútbol", "creator hablando a cámara", "cocina en vivo", "música en vivo", "lobby de juego". NO asumas gaming si no lo es.',
    ),
  energy_level: z.enum(['calm', 'medium', 'high', 'epic']).describe('intensidad visual del momento'),
  mood_tags: z
    .array(z.string())
    .max(5)
    .describe('tags cortos describiendo el mood, en español, max 5. Ejemplos: ["celebracion", "tension", "humor", "concentracion"]'),
  on_screen_text: z
    .string()
    .nullable()
    .describe('texto visible en pantalla (HUD, scoreboard, chyron). null si no hay nada legible.'),
  summary: z.string().describe('una sola línea de 10-15 palabras en español describiendo qué se ve en el frame'),
});

export type FrameAnalysisResult = z.infer<typeof FrameAnalysis>;

export interface FrameHandle {
  getLatest(): { result: FrameAnalysisResult; ageMs: number } | null;
  getAnalysisCount(): number;
  stop(): Promise<void>;
}

async function analyzeFrame(jpegBuffer: Buffer): Promise<FrameAnalysisResult> {
  const { object } = await generateObject({
    model: MODEL,
    schema: FrameAnalysis,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describí este frame de un stream en vivo. El stream puede ser de cualquier tipo (gaming, IRL, cocina, música, charla). Devolvé tags genéricos al contenido — no asumas categoría. Respuesta en español.',
          },
          { type: 'image', image: jpegBuffer, mediaType: 'image/jpeg' },
        ],
      },
    ],
  });
  return object;
}

export async function startFrameAnalysis(streamKey: string): Promise<FrameHandle | null> {
  const hasKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.AI_GATEWAY_API_KEY;
  if (!hasKey) {
    log.warn(`[frame ${streamKey}] no GEMINI_API_KEY ni AI_GATEWAY_API_KEY → frame pipe disabled`);
    return null;
  }

  const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;

  let active = true;
  let latest: { result: FrameAnalysisResult; ts: number } | null = null;
  let pending: Buffer | null = null;
  let analyzing = false;
  let buffer = Buffer.alloc(0);
  let analysisCount = 0;

  // Cola tamaño 1: guardamos solo el frame más reciente. Si el modelo tarda más
  // que 1s, descartamos los intermedios y arrancamos análisis con el último.
  // Eso evita acumulación de calls + queda con la información más fresca.
  async function processQueue(): Promise<void> {
    if (analyzing) return;
    analyzing = true;
    while (pending && active) {
      const jpeg = pending;
      pending = null;
      try {
        const result = await analyzeFrame(jpeg);
        if (active) {
          latest = { result, ts: Date.now() };
          analysisCount += 1;
          log.info(`[frame ${streamKey}] ✓ ${result.energy_level} · ${result.scene_type}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`[frame ${streamKey}] analyze failed: ${msg}`);
      }
    }
    analyzing = false;
  }

  // ffmpeg long-lived: pulla el RTMP y tira N JPEGs por segundo concatenados a stdout.
  // Parseamos por SOI (0xFFD8) / EOI (0xFFD9) markers para separar imágenes.
  const ffmpeg: ChildProcess = spawn(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-i', rtmpUrl,
      '-vf', `fps=${FPS}`,
      '-q:v', '5',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  ffmpeg.stdout?.on('data', (chunk: Buffer) => {
    if (!active) return;
    buffer = Buffer.concat([buffer, chunk]);

    // Extraer cada JPEG completo del buffer.
    while (true) {
      const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi < 0) {
        buffer = Buffer.alloc(0);
        break;
      }
      const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi < 0) {
        // JPEG incompleto, esperar más data.
        if (soi > 0) buffer = buffer.subarray(soi); // descartar basura previa
        break;
      }
      const jpeg = buffer.subarray(soi, eoi + 2);
      buffer = buffer.subarray(eoi + 2);

      // Encolar (cola tamaño 1, descarta el anterior si no fue procesado).
      pending = jpeg;
      void processQueue();
    }
  });

  ffmpeg.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log.warn(`[frame ${streamKey}] ffmpeg: ${msg}`);
  });

  ffmpeg.on('close', (code) => {
    if (active) log.info(`[frame ${streamKey}] ffmpeg exited code=${code}`);
  });

  log.success(
    `[frame ${streamKey}] pipe arrancado · model=${MODEL_STRING} · provider=${isUsingDirectProvider() ? 'google-direct' : 'ai-gateway'} · fps=${FPS}`,
  );

  return {
    getLatest: () => {
      if (!latest) return null;
      return { result: latest.result, ageMs: Date.now() - latest.ts };
    },
    getAnalysisCount: () => analysisCount,
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

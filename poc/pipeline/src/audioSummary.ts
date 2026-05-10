import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './aiModel.js';
import { log } from './log.js';

const MODEL = resolveModel(process.env.AUDIO_SUMMARY_MODEL ?? 'claude-haiku-4-5');

// Schema agnóstico al contenido. El modelo NO debe asumir gaming, IRL, cocina,
// charla — solo extraer qué se está diciendo. Los brand-agents consumen estos
// campos para hacer matching contra mandates sin tener que re-leer el transcript.
const AudioSummary = z.object({
  summary: z
    .string()
    .describe(
      '1-2 oraciones en español describiendo qué se está diciendo en la ventana. Concreto, no abstracto. Si no hay habla, devolvé "sin habla".',
    ),
  topics: z
    .array(z.string())
    .max(5)
    .describe(
      'tópicos generales en español, max 5, en categorías amplias. Ejemplos: ["fútbol","cerveza","comida rápida","gaming","tecnología"]. Vacío si no hay habla.',
    ),
  mentions: z
    .array(z.string())
    .max(10)
    .describe(
      'entidades CONCRETAS mencionadas explícitamente: marcas, productos, personas, lugares, equipos. Max 10. Ej: ["Quilmes","River Plate","iPhone"]. Vacío si nada concreto se mencionó.',
    ),
  intent: z
    .enum(['discussion', 'recommendation', 'complaint', 'question', 'reaction', 'silence'])
    .describe(
      'intención dominante: discussion=conversación general, recommendation=recomendando algo, complaint=quejándose, question=preguntando al chat o pensando en voz alta, reaction=reaccionando a algo que pasó, silence=sin habla relevante.',
    ),
});

export type AudioSummaryResult = z.infer<typeof AudioSummary>;

interface SummarizeInput {
  audioText: string;
  sceneType?: string | null;
  onScreenText?: string | null;
  gameCategory?: string | null;
}

/**
 * Resume el audio_text de la ventana de 30s con Claude Haiku (provider directo
 * Anthropic o AI Gateway). Usa contexto del frame (scene_type, on_screen_text,
 * game_category) como prior para desambiguar referencias del transcript
 * ("ese jugador" → nombre del HUD).
 *
 * Devuelve null si no hay ANTHROPIC_API_KEY ni AI_GATEWAY_API_KEY o si la call
 * falla — el chunk se persiste igual con audio_text crudo, solo pierde el
 * summary IA.
 */
export async function summarizeAudio(
  streamKey: string,
  input: SummarizeInput,
): Promise<AudioSummaryResult | null> {
  const hasKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_GATEWAY_API_KEY;
  if (!hasKey) return null;

  const { audioText, sceneType, onScreenText, gameCategory } = input;
  const trimmed = audioText.trim();
  if (!trimmed) {
    return {
      summary: 'sin habla',
      topics: [],
      mentions: [],
      intent: 'silence',
    };
  }

  const contextLines: string[] = [];
  if (sceneType) contextLines.push(`Escena visual: ${sceneType}`);
  if (gameCategory) contextLines.push(`Categoría Twitch: ${gameCategory}`);
  if (onScreenText) contextLines.push(`Texto en pantalla: ${onScreenText}`);

  const contextBlock = contextLines.length ? `\n\nContexto del frame (referencia, no es lo que se dice):\n${contextLines.join('\n')}` : '';

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: AudioSummary,
      messages: [
        {
          role: 'user',
          content:
            'Sos un asistente que extrae estructura de transcripts de streams en vivo. Te paso 30 segundos de audio transcripto (puede tener errores de STT, slang argentino, voseo). Extraé summary + topics + mentions + intent. NO inventes marcas o entidades que no aparezcan textuales.\n\n' +
            `Transcript:\n"""${trimmed}"""${contextBlock}`,
        },
      ],
    });
    return object;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`[audio-summary ${streamKey}] failed: ${msg}`);
    return null;
  }
}

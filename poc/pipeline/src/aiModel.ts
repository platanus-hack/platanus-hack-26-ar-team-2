import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// Si hay GEMINI_API_KEY (Google AI Studio, free tier generoso) usamos el
// provider directo y bypaseamos Vercel AI Gateway. Esto es CRUCIAL durante el
// rate-limiting masivo del free tier de Vercel ("Free credits temporarily have
// rate limits in place due to abuse"). El provider directo no comparte ese
// rate limit — cuotas son las de Google AI Studio (15 req/min, 1500 req/día
// para Flash, más para Flash-Lite).
//
// Si NO hay GEMINI_API_KEY, devolvemos el modelString tal cual y el AI SDK lo
// rutea al Gateway via AI_GATEWAY_API_KEY (modo legacy del POC).

let cachedGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getGoogleProvider() {
  if (cachedGoogle) return cachedGoogle;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  cachedGoogle = createGoogleGenerativeAI({ apiKey });
  return cachedGoogle;
}

/**
 * Devuelve un modelo listo para pasarle a `generateObject` / `generateText`.
 * Acepta tanto el formato AI Gateway ("google/gemini-2.5-flash") como el
 * formato Google directo ("gemini-2.5-flash") — internamente normaliza.
 */
export function resolveModel(modelString: string): LanguageModel | string {
  const google = getGoogleProvider();
  if (google) {
    const modelId = modelString.replace(/^google\//, '');
    return google(modelId);
  }
  // Fallback: AI Gateway. El SDK rutea automáticamente con AI_GATEWAY_API_KEY.
  return modelString;
}

export function isUsingDirectProvider(): boolean {
  return !!getGoogleProvider();
}

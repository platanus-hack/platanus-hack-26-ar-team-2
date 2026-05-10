import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

// Si hay ANTHROPIC_API_KEY usamos el provider directo de Anthropic y
// bypaseamos Vercel AI Gateway. Esto evita pelearse con el rate-limiting del
// free tier del Gateway ("Free credits temporarily have rate limits in place
// due to abuse"). El provider directo usa las cuotas de tu cuenta Anthropic
// (RPM/TPM según tier — para hackathon con la key de P0-07 alcanza holgado).
//
// Si NO hay ANTHROPIC_API_KEY, devolvemos el modelString tal cual y el AI SDK
// lo rutea al Gateway via AI_GATEWAY_API_KEY (modo legacy del POC).

let cachedAnthropic: ReturnType<typeof createAnthropic> | null = null;

function getAnthropicProvider() {
  if (cachedAnthropic) return cachedAnthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cachedAnthropic = createAnthropic({ apiKey });
  return cachedAnthropic;
}

/**
 * Devuelve un modelo listo para pasarle a `generateObject` / `generateText`.
 * Acepta tanto el formato AI Gateway ("anthropic/claude-haiku-4-5") como el
 * formato Anthropic directo ("claude-haiku-4-5") — internamente normaliza.
 */
export function resolveModel(modelString: string): LanguageModel | string {
  const anthropic = getAnthropicProvider();
  if (anthropic) {
    const modelId = modelString.replace(/^anthropic\//, '');
    return anthropic(modelId);
  }
  // Fallback: AI Gateway. El SDK rutea automáticamente con AI_GATEWAY_API_KEY.
  return modelString;
}

export function isUsingDirectProvider(): boolean {
  return !!getAnthropicProvider();
}

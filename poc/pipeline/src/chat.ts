import tmi from 'tmi.js';
import { log } from './log.js';

const VELOCITY_WINDOW_MS = Number(process.env.CHAT_VELOCITY_WINDOW_MS ?? 5_000);
const KEYWORDS_WINDOW_MS = Number(process.env.CHAT_KEYWORDS_WINDOW_MS ?? 30_000);
const TOP_KEYWORDS = Number(process.env.CHAT_TOP_KEYWORDS ?? 10);
const BASELINE_LEARN_MS = Number(process.env.CHAT_BASELINE_LEARN_MS ?? 60_000);

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'hype';

export interface ChatMetrics {
  velocity_now: number; // mensajes/seg en la ventana corta
  velocity_avg: number; // promedio en la ventana media
  velocity_peak: number; // pico en la ventana media
  velocity_baseline: number; // baseline aprendido en los primeros N segundos
  recent_keywords: string[]; // top palabras del ventana media
  sentiment: Sentiment;
  total_messages: number; // contador absoluto desde el connect
}

export interface ChatHandle {
  getMetrics(): ChatMetrics;
  stop(): Promise<void>;
}

interface ChatMessage {
  ts: number;
  user: string;
  text: string;
}

// Heurística de sentimiento: palabras/emotes positivos vs negativos.
const POSITIVE = new Set([
  'pog', 'poggers', 'gg', 'lol', 'jaja', 'jajaja', 'kekw', 'lul', 'lmao',
  'epic', 'genio', 'crack', 'capo', 'groso', 'maestro', 'goat', 'bien',
  'aguante', 'vamos', 'dale', 'bueno', 'lindo', 'increible', 'winner',
  '🔥', '❤️', '👏', '😂', '🤣', '🎉', '⚽', '🏆',
]);

const NEGATIVE = new Set([
  'l', 'rip', 'ratio', 'boring', 'aburrido', 'noob', 'trash', 'asco',
  'malo', 'feo', 'cringe', 'meh', 'flop', 'rage', 'mute',
]);

const HYPE_EMOTES = new Set([
  'pogchamp', 'omegalul', 'kekw', 'pog', 'poggers', 'monkas', 'kappa',
  'golazo', 'goal', 'gol', 'goooooool', 'amazing',
]);

// Stopwords ES/EN para filtrar de keywords.
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'y', 'o', 'pero', 'que', 'cual', 'como', 'cuando', 'donde', 'quien',
  'es', 'son', 'soy', 'eres', 'esta', 'están', 'estoy', 'estás', 'fue',
  'ser', 'haber', 'hacer', 'tener', 'me', 'te', 'se', 'nos', 'lo', 'le',
  'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'yo', 'voy', 'va', 'vas', 'van',
  'no', 'si', 'sí', 'por', 'para', 'con', 'sin', 'sobre', 'entre',
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'in', 'on', 'at', 'to',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function classifySentiment(messages: ChatMessage[]): Sentiment {
  if (messages.length === 0) return 'neutral';

  let pos = 0;
  let neg = 0;
  let hype = 0;
  let total = 0;

  for (const m of messages) {
    const tokens = tokenize(m.text);
    for (const t of tokens) {
      total += 1;
      if (HYPE_EMOTES.has(t)) {
        hype += 1;
        pos += 1; // hype también suma positivo
      } else if (POSITIVE.has(t)) {
        pos += 1;
      } else if (NEGATIVE.has(t)) {
        neg += 1;
      }
    }
    // ALL CAPS messages (al menos 5 chars y >70% mayúsculas) cuentan como hype
    if (m.text.length >= 5) {
      const upperRatio = (m.text.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length / m.text.length;
      if (upperRatio > 0.7) hype += 1;
    }
  }

  if (total === 0) return 'neutral';
  const hypeRatio = hype / messages.length;
  const posRatio = pos / total;
  const negRatio = neg / total;

  if (hypeRatio >= 0.3) return 'hype';
  if (posRatio > 0.15 && posRatio > negRatio * 2) return 'positive';
  if (negRatio > 0.15 && negRatio > posRatio * 2) return 'negative';
  return 'neutral';
}

function topKeywords(messages: ChatMessage[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    for (const t of tokenize(m.text)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([word]) => word);
}

/**
 * Conecta a Twitch IRC vía tmi.js (anonymous read-only) al canal configurado y
 * mantiene buffer rolling de mensajes. Calcula velocity, sentiment heurístico
 * y top keywords on-demand cuando el orchestrator/chunkWriter consultan.
 *
 * Si TWITCH_CHANNEL no está seteado, el módulo se desactiva graciosamente.
 */
export async function startChat(streamKey: string): Promise<ChatHandle | null> {
  const channel = process.env.TWITCH_CHANNEL ?? streamKey;
  if (!channel) {
    log.warn(`[chat ${streamKey}] TWITCH_CHANNEL missing → chat pipe disabled`);
    return null;
  }

  const messages: ChatMessage[] = [];
  let active = true;
  let totalMessages = 0;
  let connectedAt = 0;
  let baseline: number | null = null;

  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { secure: true, reconnect: true, maxReconnectAttempts: 5 },
    channels: [channel],
    // No identity → connection anónima read-only (no requiere OAuth).
  });

  client.on('message', (_channel: string, tags: tmi.ChatUserstate, msg: string, self: boolean) => {
    if (self || !active) return;
    messages.push({ ts: Date.now(), user: tags['display-name'] ?? tags.username ?? 'anon', text: msg });
    totalMessages += 1;
    // Trim buffer: mantenemos solo lo que cabe en la ventana de keywords (más larga).
    const cutoff = Date.now() - KEYWORDS_WINDOW_MS;
    while (messages.length && messages[0].ts < cutoff) messages.shift();
  });

  client.on('connected', () => {
    connectedAt = Date.now();
    log.success(`[chat ${streamKey}] conectado a Twitch IRC · channel=${channel}`);
  });

  client.on('disconnected', (reason: string) => {
    if (active) log.warn(`[chat ${streamKey}] desconectado: ${reason}`);
  });

  try {
    await client.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[chat ${streamKey}] connect failed: ${msg}`);
    return null;
  }

  function getMetrics(): ChatMetrics {
    const now = Date.now();
    const shortWindowStart = now - VELOCITY_WINDOW_MS;
    const longWindowStart = now - KEYWORDS_WINDOW_MS;
    const shortMsgs = messages.filter((m) => m.ts >= shortWindowStart);
    const longMsgs = messages.filter((m) => m.ts >= longWindowStart);

    const velocity_now = shortMsgs.length / (VELOCITY_WINDOW_MS / 1000);
    const velocity_avg = longMsgs.length / (KEYWORDS_WINDOW_MS / 1000);

    // Peak: divido la ventana larga en buckets de 5s y agarro el max.
    let peak = 0;
    for (let bucketStart = longWindowStart; bucketStart < now; bucketStart += VELOCITY_WINDOW_MS) {
      const bucketEnd = bucketStart + VELOCITY_WINDOW_MS;
      const inBucket = longMsgs.filter((m) => m.ts >= bucketStart && m.ts < bucketEnd).length;
      const rate = inBucket / (VELOCITY_WINDOW_MS / 1000);
      if (rate > peak) peak = rate;
    }

    // Baseline: una vez que pasaron BASELINE_LEARN_MS desde connect, lockeamos
    // el promedio de la ventana larga como baseline. Antes de eso, el baseline
    // es el velocity_avg actual.
    if (baseline === null && connectedAt > 0 && now - connectedAt >= BASELINE_LEARN_MS) {
      baseline = velocity_avg;
      log.info(`[chat ${streamKey}] baseline locked at ${baseline.toFixed(2)} msg/s`);
    }
    const velocity_baseline = baseline ?? velocity_avg;

    return {
      velocity_now: Number(velocity_now.toFixed(2)),
      velocity_avg: Number(velocity_avg.toFixed(2)),
      velocity_peak: Number(peak.toFixed(2)),
      velocity_baseline: Number(velocity_baseline.toFixed(2)),
      recent_keywords: topKeywords(longMsgs, TOP_KEYWORDS),
      sentiment: classifySentiment(longMsgs),
      total_messages: totalMessages,
    };
  }

  return {
    getMetrics,
    stop: async () => {
      active = false;
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}

import { log } from './log.js';

const HELIX_BASE = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

interface TwitchStreamInfo {
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
}

export interface TwitchMetrics {
  viewers: number;
  game_category: string;
  stream_title: string;
  language: string;
  is_live: boolean;
  fetched_at: number;
}

export interface TwitchHandle {
  getLatest(): TwitchMetrics | null;
  stop(): Promise<void>;
}

const POLL_INTERVAL_MS = Number(process.env.TWITCH_POLL_MS ?? 30_000);

async function getAppAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!r.ok) {
      log.error(`[twitch] auth failed: HTTP ${r.status}`);
      return null;
    }
    const data = (await r.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[twitch] auth error: ${msg}`);
    return null;
  }
}

async function fetchStreamInfo(
  channel: string,
  token: string,
  clientId: string,
): Promise<TwitchStreamInfo | null> {
  try {
    const r = await fetch(`${HELIX_BASE}/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': clientId,
      },
    });
    if (!r.ok) {
      // 401 sería token vencido — devolvemos null y el caller refresh-ará en el siguiente tick
      return null;
    }
    const data = (await r.json()) as { data: TwitchStreamInfo[] };
    return data.data?.[0] ?? null; // null si el canal no está en vivo
  } catch {
    return null;
  }
}

/**
 * Pulla métricas del canal de Twitch cada N segundos. Si el canal no está en
 * vivo, devuelve un TwitchMetrics con is_live=false y viewers=0. Si las creds
 * Helix faltan, el módulo se desactiva graciosamente y getLatest() devuelve null.
 *
 * IMPORTANTE: `twitchChannel` es **per-stream**, NO global. Para multi-stream
 * cada sesión llama startTwitchPoll() con SU canal propio. En producción el
 * handler del on_publish lookups por stream_key en `accounts` y pasa el canal.
 *
 * Las creds Helix (CLIENT_ID + CLIENT_SECRET) son del PROYECTO Addie,
 * NO per-creator. Una sola app de dev.twitch.tv autentica las consultas Helix
 * de todos los creators que tengamos onboardeados.
 */
export async function startTwitchPoll(streamKey: string, twitchChannel: string): Promise<TwitchHandle | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const channel = twitchChannel;

  if (!clientId || !clientSecret) {
    log.warn(`[twitch ${streamKey}] TWITCH_CLIENT_ID/SECRET missing → twitch poll disabled`);
    return null;
  }
  if (!channel) {
    log.warn(`[twitch ${streamKey}] twitchChannel vacío → twitch poll disabled`);
    return null;
  }

  const token = await getAppAccessToken(clientId, clientSecret);
  if (!token) {
    log.warn(`[twitch ${streamKey}] no token → twitch poll disabled`);
    return null;
  }

  let active = true;
  let latest: TwitchMetrics | null = null;

  log.success(`[twitch ${streamKey}] poll arrancado · channel=${channel} · cada ${POLL_INTERVAL_MS}ms`);

  const poll = async () => {
    if (!active) return;
    const info = await fetchStreamInfo(channel, token, clientId);
    if (info) {
      latest = {
        viewers: info.viewer_count,
        game_category: info.game_name,
        stream_title: info.title,
        language: info.language,
        is_live: true,
        fetched_at: Date.now(),
      };
    } else {
      // Canal no está en vivo o error transitorio. No pisamos latest si ya teníamos data.
      if (!latest) {
        latest = {
          viewers: 0,
          game_category: '',
          stream_title: '',
          language: '',
          is_live: false,
          fetched_at: Date.now(),
        };
      }
    }
  };

  // Primer poll inmediato + interval
  void poll();
  const interval = setInterval(poll, POLL_INTERVAL_MS);

  return {
    getLatest: () => latest,
    stop: async () => {
      active = false;
      clearInterval(interval);
    },
  };
}

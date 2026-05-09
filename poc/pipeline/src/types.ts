export interface StreamSession {
  app: string;
  name: string;
  started_at: number;
  client_ip?: string;
}

export interface NginxRtmpHookBody {
  app?: string;
  name?: string;
  addr?: string;
  flashver?: string;
  swfurl?: string;
  tcurl?: string;
  pageurl?: string;
  call?: string;
  [k: string]: string | undefined;
}

// Lo que devuelve nginx-rtmp /stat sobre un stream activo. Datos reales del feed,
// no inventados — sirven para CUALQUIER tipo de stream (gaming, IRL, charla, etc.).
export interface StreamStats {
  publishing: boolean;
  uptime_seconds: number;
  bytes_in: number;
  bw_in_kbps: number;
  bw_video_kbps: number;
  bw_audio_kbps: number;
  nclients: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    frame_rate: number;
    profile?: string;
    level?: string;
  };
  audio?: {
    codec: string;
    sample_rate: number;
    channels: number;
    profile?: string;
  };
}

// Contrato del tick rico que va a producir el pipeline cuando estén los pipes reales
// (Deepgram audio + Gemini Flash frame + tmi.js chat). Por ahora NO se emite —
// queda definido para que los modulos B-04..B-07 implementen contra esta forma.
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'hype';

export interface ContextTick {
  stream_key: string;
  ts: number;
  audio_30s: string;
  frame_summary: string;
  frame_tags: Record<string, string | undefined>;
  chat_velocity_now: number;
  chat_velocity_baseline: number;
  recent_chat_keywords: string[];
  viewer_count: number;
  viewer_delta_1m: number;
  sentiment: Sentiment;
}

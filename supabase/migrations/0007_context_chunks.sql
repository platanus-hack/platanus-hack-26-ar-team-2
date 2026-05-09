-- 0007_context_chunks.sql — chunks de contexto agregados (B-07)
-- Renombrada de 0005 → 0007 porque main ya tenía 0005_mandates_prompt.sql y
-- 0006_auth.sql cuando se mergeó. La tabla `context_chunks` ya está aplicada
-- en la DB de producción (psql -f, 2026-05-09).
--
-- Cada N segundos (default 30) el pipeline consolida los ContextTicks de la
-- ventana + viewers/game/title de Twitch Helix + agregados de chat, y escribe
-- una row acá. Los brand-agents pollean el último chunk con su propia cadencia
-- (ej cada 60s) en vez de subscribirse al firehose 1/seg → menos calls LLM.
--
-- stream_id es nullable porque el POC standalone (poc/pipeline/) no crea fila
-- en streams todavía — solo escribe stream_key como identificador. Cuando se
-- portee a apps/web el flow del on_publish handler creará la fila en streams
-- y pasará stream_id real al chunk writer.

create table context_chunks (
  id uuid primary key default gen_random_uuid(),

  -- Identificación del stream
  stream_key text not null,                                  -- nginx-rtmp stream key (ej "coscu-test")
  stream_id uuid,                                            -- FK lógica a streams(id), null en POC standalone
  ts_start timestamptz not null,                             -- inicio de la ventana del chunk
  duration_s int not null default 30,                        -- segundos cubiertos

  -- Audio (transcripción ElevenLabs Scribe v2 realtime)
  audio_text text,                                           -- transcript completo de la ventana
  audio_partial_at_end text,                                 -- partial activo al cerrar el chunk

  -- Frame analysis (Gemini 2.5 Flash via Vercel AI Gateway)
  scene_type text,                                           -- libre, ej "FIFA gameplay", "creator hablando"
  energy_level text check (energy_level in ('calm','medium','high','epic')),
  mood_tags text[],                                          -- agregado de los mood_tags del chunk
  on_screen_text text,                                       -- último HUD/scoreboard legible

  -- Chat (tmi.js — B-06, NULL hasta que esté implementado)
  chat_velocity_avg real,
  chat_velocity_peak real,
  chat_recent_keywords text[],
  sentiment_avg text check (sentiment_avg in ('positive','neutral','negative','hype')),

  -- Twitch Helix API metrics
  viewers int,
  viewers_delta_30s int,                                     -- delta vs chunk anterior
  game_category text,                                        -- "FIFA 26" / "Just Chatting" / etc
  stream_title text,

  -- Counters / debug
  ticks_aggregated int not null default 0,                   -- cuantos ContextTicks 1-seg entraron al chunk
  frame_analyses_aggregated int not null default 0,          -- cuantos frame analysis exitosos

  created_at timestamptz not null default now()
);

-- Lookups por stream_key (lo más común en el POC)
create index context_chunks_stream_key_ts_idx
  on context_chunks(stream_key, ts_start desc);

-- Lookups por stream_id (cuando esté poblado en producción)
create index context_chunks_stream_id_idx
  on context_chunks(stream_id, ts_start desc)
  where stream_id is not null;

alter table context_chunks enable row level security;

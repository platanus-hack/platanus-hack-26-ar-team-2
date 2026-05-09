# Addie · Pipeline POC

Standalone proof of concept de la capa de pipeline desde [DESIGN.md §3](../../DESIGN.md). Sin agentes, sin on-chain, sin overlay UI — solo **OBS → nginx-rtmp → webhooks → stream stats reales + transcripción en streaming, todo en tu terminal**.

## Qué hace

1. nginx-rtmp en Docker expone un endpoint RTMP en `rtmp://localhost/live/<stream_key>`.
2. OBS publica ahí (gaming, IRL, charla, lo que sea — el pipeline es agnóstico al contenido).
3. nginx-rtmp dispara el webhook `on_publish` → el server Express arranca dos cosas en paralelo:
   - **Polling de `/stat`** cada 1s → datos reales del stream (codec, resolución, fps, bitrate, sample rate, bytes_in, uptime).
   - **Audio pipe**: ffmpeg pulla el RTMP, decodea audio a PCM 16kHz mono, lo manda como base64 al WebSocket realtime de **ElevenLabs Scribe v2**. VAD del lado server detecta pausas y emite `committed_transcript`. Mantenemos ventana móvil de 30s + partial actual.
4. Cada 1s se loggea un tick con `video / audio / bw_effective_kbps / audio_30s / audio_partial`.
5. `on_publish_done` cierra el polling, mata ffmpeg, cierra el WS de ElevenLabs.

> **Cero mocks de contenido.** Lo que se mide es lo que el stream realmente está mandando, lo que se transcribe es lo que realmente se dice.

## API keys necesarias

> **Status**: pipeline verificado end-to-end con todas las APIs activas el 2026-05-09 (ver sección [Verificación end-to-end](#-verificación-end-to-end-2026-05-09) abajo).

| Variable | Capa del pipeline | Sin la key |
|---|---|---|
| `ELEVENLABS_API_KEY` | Audio (Scribe v2 realtime) → `audio_text` + `audio_partial` | esos campos quedan en NULL, resto sigue funcionando |
| `AI_GATEWAY_API_KEY` | Frame analysis (Gemini 2.5 Flash via Vercel AI Gateway) → `scene_type` + `energy_level` + `mood_tags` + `on_screen_text` | esos campos quedan en `(unknown)` |
| `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | Helix API → `viewers` + `game_category` + `stream_title` | esos campos quedan en NULL |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Persistencia en `context_chunks` + broadcast Realtime al canal `context:<stream_key>` | chunks salen como JSON a consola, no hay broadcast a Track C |
| `TWITCH_CHANNEL_OVERRIDE` (opcional) | Override global del canal Twitch para testing local | cada sesión usa su `stream_key` como `twitch_channel` (multi-stream) |

### Cómo conseguir cada una

- **ElevenLabs**: [elevenlabs.io](https://elevenlabs.io) → Sign up → Settings → API Keys → Create. Free tier suficiente para el demo. Cubre **Scribe v2 realtime + Creative + TTS** con la misma key.
- **AI Gateway** (Vercel): [vercel.com/dashboard](https://vercel.com/dashboard) → tu proyecto Addie → AI Gateway → Create Key. Créditos compartidos del proyecto.
- **Twitch Helix** (gratis, requiere 2FA en la cuenta): [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → Register Your Application (name `addie-poc`, OAuth Redirect `http://localhost`, Category `Application Integration`, Client Type `Confidential`) → te da Client ID. Click **New Secret**. **Las creds son del proyecto, NO per-creator** — una sola app autentica las consultas Helix de todos los streams onboardeados.
- **Supabase** (proyecto del equipo, P0-12 ✅ Andy): pediselo a Andy. Settings → API → URL + service_role key. **Service role bypassea RLS — server-side ONLY, NO frontend.**
- **Migration 0007**: ya aplicada en producción ([`supabase/migrations/0007_context_chunks.sql`](../../supabase/migrations/0007_context_chunks.sql)). Si reseteás la DB, reaplicala con `psql $POSTGRES_URL_NON_POOLING -f supabase/migrations/0007_context_chunks.sql`.

**La `.env` está gitignored** — nunca pushees tu key al repo. Verificalo siempre con `git status` antes de commitear.

### Multi-stream — cómo se resuelve `twitch_channel` per-session

El pipeline soporta **múltiples streams concurrentes** (un `Map<stream_key, ActiveSession>` en el orchestrator). El `twitch_channel` para chat + Helix se resuelve en cada sesión así:

1. **`TWITCH_CHANNEL_OVERRIDE`** env var (testing standalone — fuerza TODAS las sesiones al mismo canal)
2. **`opts.twitchChannel`** pasado a `startSession()` (lookup en DB, producción)
3. **`stream_key`** del nginx-rtmp como default (asume creator usa username Twitch como key)

En producción (apps/web), el handler del `on_publish` debe lookups en `accounts.metadata.twitch_channel` y pasar el valor explícito a `startSession(session, { twitchChannel })`.

## Setup

```bash
cd poc/pipeline
npm install
cp .env.example .env
# editá .env y pegá ELEVENLABS_API_KEY=sk_...
docker compose up -d         # nginx-rtmp en :1935 RTMP y :8080 HTTP/stat
npm run demo                 # express webhook server en :3000
```

### ElevenLabs — paso a paso

1. Creá una cuenta en [elevenlabs.io](https://elevenlabs.io) (Sign up con Google o email).
2. Verificá el email.
3. Avatar arriba a la derecha → **API Keys** → **Create API Key** → nombre cualquiera (ej `addie-poc`) → **Create**.
4. Copiá la key (empieza con `sk_...`). **Solo se ve una vez.**
5. Pegala en `.env`:
   ```
   ELEVENLABS_API_KEY=sk_...
   ELEVENLABS_STT_LANGUAGE=es
   # Opcional: keyterms para sesgar a slang argentino + nombres propios del demo
   ELEVENLABS_STT_KEYTERMS=che,boludo,groso,quilombo,laburo,addie,adidas,Quilmes
   ```
6. Reiniciá `npm run demo` para que tome las env vars.

Cuando arranque vas a ver `[transcribe ...] WS open · model=scribe_v2_realtime · lang=es · keyterms=N` confirmando la conexión.

### Sin API key

Si la key NO está, el POC arranca igual y los ticks tienen `audio_30s: "(no committed transcript yet)"` — el resto del pipeline (frame analysis, chat) son independientes del audio.

## Streamear desde OBS

1. OBS → Settings → Stream
2. Service: **Custom**
3. Server: `rtmp://localhost/live`
4. Stream Key: `team-stream` (o lo que quieras, free-form)
5. Click **Start Streaming**

En la terminal donde corre `npm run demo` deberías ver:

```
◆ on_publish · name="team-stream"
▶ session started
polling nginx-rtmp /stat every 1000ms
[transcribe team-stream] WS open · model=scribe_v2_realtime · lang=es

▶ tick #001
    uptime_s               1
    bw_effective_kbps      4523
    video                  "H264 1920x1080@60fps"
    audio                  "AAC 48000Hz ch=2"
    audio_30s              "(no committed transcript yet)"
    audio_partial          "dale loco vamos"

▶ tick #002
    audio_30s              "dale loco vamos"
    audio_partial          "qué jugada hizo"
...
[transcribe team-stream] ✓ "dale loco vamos qué jugada hizo"
```

Cuando paras OBS → llega `on_publish_done` → la sesión se cierra y se imprime el resumen.

## Smoke test sin OBS

Para probar el flow sin OBS, podés streamear con ffmpeg sintético (sirve para verificar webhooks + stats; no genera transcripción porque el audio sintético es un tono 440Hz, no voz):

```bash
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
       -f lavfi -i "sine=frequency=440" \
       -c:v libx264 -preset ultrafast -tune zerolatency \
       -c:a aac -b:a 128k \
       -f flv rtmp://localhost/live/test
```

O dispará los webhooks a mano:

```bash
curl -X POST http://localhost:3000/api/stream/on-publish \
  -d 'app=live&name=smoke&addr=127.0.0.1'
curl -X POST http://localhost:3000/api/stream/on-publish-done \
  -d 'app=live&name=smoke&addr=127.0.0.1'
```

## Verificar el stream con ffprobe

```bash
ffprobe rtmp://localhost/live/team-stream
```

## ✅ Verificación end-to-end (2026-05-09)

Smoke test corrido con **todas las APIs activas + datos reales** apuntando al canal de [Ibai](https://twitch.tv/ibai) en vivo:

```
[transcribe full-stack]   WS open · model=scribe_v2_realtime · lang=es
[frame full-stack]        ✓ calm · patrón de prueba de televisión   ← Gemini reconoció el testpattern de ffmpeg
[twitch full-stack]       poll arrancado · channel=ibai
[chat full-stack]         conectado a Twitch IRC · channel=ibai
[realtime full-stack]     broadcast channel listo · context:full-stack
[chunk full-stack]        writer arrancado · cada 8000ms → Supabase

▶ tick #005
    twitch_viewers          32181                                        ← Helix viewers reales
    twitch_game             "League of Legends"                          ← categoría real
    twitch_title            "MKOI vs KC | LA BATALLA DEFINITIVA..."      ← título real
    chat_recent_keywords    ["estuviera","mellado","ganaba","aeglos777"] ← chat real del IRC

[chunk full-stack] #1 · 8 ticks · 1 frames · viewers=32181 · chat=0.0msg/s neutral
                                            scene="patrón de prueba de televisión"
```

Confirmación en DB:
```sql
SELECT scene_type, viewers, game_category, chat_recent_keywords FROM context_chunks ORDER BY ts_start DESC;

scene_type                       viewers   game_category         chat_recent_keywords
patrón de prueba de televisión   32181     League of Legends     {estuviera,mellado,esto,ganaba,giant,aeglos777,tal}
patrón de prueba de televisión   32181     League of Legends     {estuviera,mellado,esto,ganaba,giant}
```

**Migration 0005 ya está aplicada en la DB de producción** del proyecto Addie (Supabase del equipo, P0-12 ✅).

## Arquitectura

```
                   OBS Studio (con micrófono real para que VAD detecte voz)
                        │
                        ▼ (RTMP publish)
                  nginx-rtmp (Docker)
                  ├── on_publish webhook ─────────────────────┐
                  │                                            ▼
                  │                                    Express :3000 (server.ts)
                  │                                            │
                  │                                            ▼
                  │                                   orchestrator.ts
                  │                                       │      │
                  │  (cada 1s GET :8080/stat)            │      │  (en paralelo)
                  │  ┌─────────────────────────────────  │      │
                  │  ▼                                   │      ▼
                  │  streamStats.ts                      │   transcribe.ts
                  │  (codec, fps, bitrate, bytes_in)     │      │
                  │                                       │      │  ffmpeg -i rtmp://… -ac 1 -ar 16000 -f s16le pipe:1
                  │                                       │      ▼
                  │                                       │   ElevenLabs Scribe v2 realtime (WebSocket)
                  │                                       │      │
                  │                                       │      ▼  partial / committed transcripts
                  │                                       │   rolling 30s window
                  │                                       ▼
                  │                                   log.ts (tick a la terminal con todo)
                  │
                  └── on_publish_done webhook → cierra todo (interval, ffmpeg, WS)
```

Estructura:

```
poc/pipeline/
├── docker-compose.yml          nginx-rtmp container
├── nginx-rtmp.conf             RTMP + HTTP/stat (worker_processes=1 para que /stat sea consistente)
├── package.json                tsx + express + chalk + @elevenlabs/elevenlabs-js
├── tsconfig.json
├── .env.example
└── src/
    ├── types.ts                StreamSession, NginxRtmpHookBody, StreamStats, ContextTick
    ├── log.ts                  chalk + timestamps (estilo poc/negotiation)
    ├── streamStats.ts          GET /stat → parse XML → StreamStats
    ├── transcribe.ts           ffmpeg → ElevenLabs Scribe v2 realtime → audio_30s + audio_partial
    ├── orchestrator.ts         maneja sesiones (1 stream → polling + transcribe pipe)
    ├── server.ts               express con /api/stream/on-publish[-done]
    └── index.ts                main: levanta express, espera webhooks
```

## Contrato con Track C (Agents — Andy)

Este pipeline produce **el contexto que los brand-agents necesitan para decidir bids**. La fuente única de verdad es la tabla **`context_chunks`** en Supabase. **El pipeline no conoce a las brands** — solo escribe contexto crudo. El routing/matching contra brands vive en Track C.

### Cómo consumir desde un brand-agent

```sql
-- Última ventana de contexto del stream activo
SELECT *
FROM context_chunks
WHERE stream_key = 'team-stream'
ORDER BY ts_start DESC
LIMIT 1;

-- History reciente (cold start, debug, replay)
SELECT *
FROM context_chunks
WHERE stream_key = 'team-stream'
  AND ts_start > now() - interval '5 minutes'
ORDER BY ts_start ASC;
```

Una row aparece cada **`CHUNK_INTERVAL_MS`** (default 30s). Los brand-agents pollean con su propia cadencia (recomendado: cada 30-60s) y deciden con un LLM si el contexto les calza vs su mandate.

### Schema de `context_chunks` (relevante para Track C)

| Columna | Tipo | Significado |
|---|---|---|
| `stream_key` | text | Identificador del stream (nginx-rtmp key, ej `team-stream`) |
| `ts_start` / `duration_s` | timestamptz / int | Ventana cubierta por el chunk |
| `audio_text` | text | **Transcript completo** de los últimos 30s (Scribe v2 realtime, español) |
| `audio_partial_at_end` | text | Lo que se está diciendo cuando se cerró el chunk (puede no estar comiteado todavía) |
| `scene_type` | text | Descripción libre: "FIFA gameplay", "creator hablando", "cocina", etc. |
| `energy_level` | text | `calm` / `medium` / `high` / `epic` |
| `mood_tags` | text[] | Tags genéricos: `celebracion`, `tension`, `humor`, etc. |
| `on_screen_text` | text | HUD/scoreboard/chyron leído por Gemini, NULL si no hay |
| `viewers` | int | Viewer count actual del canal Twitch (Helix API) |
| `viewers_delta_30s` | int | Cambio respecto al chunk anterior (signal de subida/bajada de audiencia) |
| `game_category` | text | Categoría Twitch: "FIFA 26", "Just Chatting", etc. |
| `stream_title` | text | Título del stream en Twitch |
| `chat_velocity_avg` / `_peak` | real | Mensajes/seg promedio y pico (B-06, NULL hasta entonces) |
| `chat_recent_keywords` | text[] | Top palabras del chat en la ventana (B-06, NULL hasta entonces) |
| `sentiment_avg` | text | Sentimiento agregado del chat (B-06) |
| `ticks_aggregated` | int | Cuántos ContextTicks 1-seg entraron al chunk |
| `frame_analyses_aggregated` | int | Cuántos frames pasaron por Gemini Flash exitosamente |

Schema completo: [`supabase/migrations/0007_context_chunks.sql`](../../supabase/migrations/0007_context_chunks.sql).

### Si Track C necesita eventos en tiempo real (no esperar 30s)

El pipeline puede emitir eventos al **Realtime channel** `stream:{stream_key}:context_events` cada vez que llega:
- nuevo `committed_transcript` de Scribe (típicamente cada 5-15s, cuando el VAD cierra una pausa)
- nuevo `frame_analyzed` de Gemini (cada 1s)
- `chat_spike` (chat_velocity > N×baseline) cuando esté B-06
- `viewer_threshold_cross` (subida/bajada brusca de audiencia)

**No está implementado todavía** — lo agrego cuando Track C lo necesite y me confirmes el schema exacto del payload. Avisame.

### Lo que NO hace el pipeline (es de Track C)

- **Conocer las brands** — los mandates viven en Supabase + frontend, los gestiona Andy/Jere.
- **Routing/matching** contra brands — si un chunk dice "tomo unos mates", el pipeline NO sabe que eso le interesa a una marca de mate. Eso lo decide el brand-agent (o un router multi-brand del Track C).
- **Subastas / negociación / on-chain** — esto vive en Track A (on-chain) + Track C (agents).

### Qué keys necesita Track C que YO no necesito

- Mandates en `mandates` table — Andy las crea desde el frontend (P0-22 ✅ cargó 8 YAMLs base; el frontend permite editarlas/agregar más).
- ANTHROPIC/GEMINI keys propias para los agentes (Andy ya las tiene en su track).

---

## Roadmap (commits siguientes en `track/b-pipeline`)

- ✅ **B-04**: `transcribe.ts` — ElevenLabs Scribe v2 realtime, transcript rolling 30s + partial.
- ✅ **B-05**: `frame.ts` — Gemini 2.5 Flash multimodal vía Vercel AI Gateway, schema agnóstico al contenido.
- ⬜ **B-06**: `chat.ts` — tmi.js read-only al canal de Twitch, calcula `chat_velocity_now`, sentiment, recent_keywords. **Cuando se implemente, los chunks tendrán esos campos poblados**.
- ✅ **B-07**: `chunkWriter.ts` + Twitch Helix metrics + persistencia en `context_chunks`. Es el contrato concreto con Track C.
- ⬜ **B-07.5** (opcional, on-demand de Track C): `eventBus.ts` con Realtime push al `stream:{key}:context_events`. Implementación bloqueada hasta que Track C confirme los eventos que necesita.
- ⬜ **B-08..B-11**: audit clip compuesto (record on con permisos correctos → cliprange T-10..T+20s → overlay ad → upload Vercel Blob).

## Lo que está intencionalmente fuera de scope

- **Routing/matching contra brands** — vive en Track C (Andy).
- **Brand-agent / streamer-agent** — ver [`poc/negotiation/`](../negotiation/) para el POC inicial.
- **Privy wallets / escrow** — ver [DESIGN.md §4](../../DESIGN.md), Track A.
- **Audit clip con overlay del ad** — falta nginx-rtmp record + segundo ffmpeg con overlay (B-08..B-11).
- **Auth real en `on_publish`** (rechazar streams no autorizados con 403) — post-MVP.

Cuando se haga el porting a `apps/web/`, el express server pasa a route handlers en `apps/web/src/app/api/stream/*` con la misma lógica. El chunkWriter ya escribe directo a Supabase, así que portea casi sin cambios — solo hay que agregar la creación de fila en `streams` al recibir `on_publish` y pasar el `stream_id` real al chunkWriter (hoy va NULL en POC standalone).

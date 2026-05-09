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

| Variable | Para qué sirve | Estado | Cómo conseguirla |
|---|---|---|---|
| `ELEVENLABS_API_KEY` | Audio: transcripción en streaming con Scribe v2 realtime (B-04). **Misma key cubre Creative para pre-gen de ads + TTS** — una sola cuenta para los 3 servicios. | **Requerida para audio_30s.** Sin ella el POC corre igual pero los campos `audio_30s` y `audio_partial` van vacíos. | [elevenlabs.io](https://elevenlabs.io) → Sign up → Settings → API Keys → Create. Free tier alcanza para el demo. |
| `AI_GATEWAY_API_KEY` | Frame analysis (B-05) con Gemini 2.5 Flash multimodal vía **Vercel AI Gateway**. Una sola key del gateway rutea a Gemini/Claude/GPT/etc — ideal porque el equipo ya tiene cuenta Vercel para deploy. | **Requerida para frame_summary / scene_type / mood_tags / on_screen_text.** Sin ella el POC corre con esos campos como `(unknown)`. | [vercel.com/dashboard](https://vercel.com/dashboard) → AI Gateway → Create Key. Créditos compartidos del proyecto Vercel. |
| `TWITCH_*` | Chat real desde Twitch IRC (B-06, después). | Aún no usada. | tmi.js usa OAuth anónimo; configuración en commit B-06. |

**La `.env` está gitignored** — nunca pushees tu key al repo. Verificalo siempre con `git status` antes de commitear.

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
   ELEVENLABS_STT_KEYTERMS=che,boludo,groso,quilombo,laburo,Coscu,adidas,Quilmes
   ```
6. Reiniciá `npm run demo` para que tome las env vars.

Cuando arranque vas a ver `[transcribe ...] WS open · model=scribe_v2_realtime · lang=es · keyterms=N` confirmando la conexión.

### Sin API key

Si la key NO está, el POC arranca igual y los ticks tienen `audio_30s: "(no committed transcript yet)"` — el resto del pipeline (frame analysis, chat) son independientes del audio.

## Streamear desde OBS

1. OBS → Settings → Stream
2. Service: **Custom**
3. Server: `rtmp://localhost/live`
4. Stream Key: `coscu-test` (o lo que quieras, free-form)
5. Click **Start Streaming**

En la terminal donde corre `npm run demo` deberías ver:

```
◆ on_publish · name="coscu-test"
▶ session started
polling nginx-rtmp /stat every 1000ms
[transcribe coscu-test] WS open · model=scribe_v2_realtime · lang=es

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
[transcribe coscu-test] ✓ "dale loco vamos qué jugada hizo"
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
ffprobe rtmp://localhost/live/coscu-test
```

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

## Roadmap (commits siguientes en `track/b-pipeline`)

- ✅ **B-04**: `transcribe.ts` — ffmpeg → 16kHz PCM → ElevenLabs Scribe v2 realtime WS, transcript rolling 30s + partial.
- ⬜ **B-05**: `frame.ts` — `ffmpeg -i rtmp://... -vf fps=1 -update 1` → Gemini 2.5 Flash multimodal con prompt agnóstico al contenido (`describí qué se ve, devolvé tags genéricos`).
- ⬜ **B-06**: `chat.ts` — tmi.js conectado al canal de demo, calcula `chat_velocity_now`, sentiment, `recent_chat_keywords` extraídos dinámicamente.
- ⬜ **B-07**: `context.ts` — combinador real que mergea las 3 fuentes en un `ContextTick` y broadcastea (en lugar del log directo).
- ⬜ **B-08..B-11**: audit clip compuesto (record on con permisos correctos → cliprange T-10..T+20s → overlay ad → upload Vercel Blob).

## Lo que está intencionalmente fuera de scope

- Supabase Realtime broadcast — los ticks van solo a la terminal del POC.
- Audit clip con overlay del ad — falta nginx-rtmp record + segundo ffmpeg con overlay.
- Brand-agent / streamer-agent — ver [`poc/negotiation/`](../negotiation/).
- Privy wallets / escrow — ver [DESIGN.md §4](../../DESIGN.md).
- Auth real en `on_publish` (rechazar streams no autorizados con 403).

Cuando se haga el porting a `apps/web/`, el express server pasa a route handlers en `apps/web/src/app/api/stream/*` y el `ContextTick` se broadcastea a un canal de Supabase Realtime. El orchestrator y los módulos de pipe portean sin cambios.

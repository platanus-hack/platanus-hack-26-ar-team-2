# Addie · Pipeline POC

Standalone proof of concept de la capa de pipeline desde [DESIGN.md §3](../../DESIGN.md). Sin agentes, sin on-chain, sin overlay UI — solo **OBS → nginx-rtmp → webhooks → stream stats reales en tu terminal**.

## Qué hace

1. nginx-rtmp en Docker expone un endpoint RTMP en `rtmp://localhost/live/<stream_key>`.
2. OBS publica ahí (gaming, IRL, charla, lo que sea — el pipeline es agnóstico al contenido).
3. nginx-rtmp dispara el webhook `on_publish` → el server Express arranca un orchestrator.
4. Cada 1 segundo el orchestrator consulta `http://localhost:8080/stat` (endpoint propio de nginx-rtmp), parsea el XML y loggea **datos reales del stream activo**: bitrate de video/audio, codec, resolución, frame_rate, sample_rate, bytes_in totales, uptime, número de subscribers.
5. El webhook `on_publish_done` cierra la sesión.

> **Cero mocks de contenido.** Lo que se mide es lo que el stream realmente está mandando. El `ContextTick` rico (audio_30s + frame_summary + chat_velocity + sentiment) se va a producir cuando estén los pipes reales contra Deepgram (audio), Gemini Flash (frames) y tmi.js (chat) — eso son los commits siguientes (B-04..B-07).

## Setup

```bash
cd poc/pipeline
npm install
cp .env.example .env
docker compose up -d         # nginx-rtmp en :1935 RTMP y :8080 HTTP/stat
npm run demo                 # express webhook server en :3000
```

Para ver los logs del container nginx-rtmp:

```bash
npm run rtmp:logs
```

## Streamear desde OBS

1. OBS → Settings → Stream
2. Service: **Custom**
3. Server: `rtmp://localhost/live`
4. Stream Key: `coscu-test` (o lo que quieras, free-form)
5. Click **Start Streaming**

En la terminal donde corre `npm run demo` deberías ver algo así:

```
[12:34:56.789] ◆ on_publish
              app            "live"
              name           "coscu-test"
              addr           "172.17.0.1"
              tcurl          "rtmp://localhost/live"
[12:34:56.792] ▶ session started · stream_key=coscu-test
[12:34:56.793] polling nginx-rtmp /stat every 1000ms for real stream metrics
[12:34:57.812] tick #001 — esperando metadata del stream…
[12:34:58.815] ▶ tick #002
              uptime_s               2
              bw_in_kbps             4523
              bw_video_kbps          4180
              bw_audio_kbps          158
              bytes_in               582341
              nclients               1
              video                  "h264 1920x1080@60fps"
              audio                  "aac 48000Hz ch=2"
[12:34:59.820] ▶ tick #003
              ...
```

Cuando paras OBS → llega `on_publish_done` → la sesión se cierra y se imprime el resumen con duración y total bytes_in.

## Smoke test sin OBS

Para probar el flow de webhooks sin tener OBS configurado, dispará los hooks a mano (no van a aparecer stats reales porque no hay stream realmente publicando, pero la sesión se crea/cierra):

```bash
curl -X POST http://localhost:3000/api/stream/on-publish \
  -d 'app=live&name=smoke-test&addr=127.0.0.1&tcurl=rtmp://localhost/live'

curl -X POST http://localhost:3000/api/stream/on-publish-done \
  -d 'app=live&name=smoke-test&addr=127.0.0.1'
```

Para ver el endpoint de stats de nginx-rtmp directamente:

```bash
curl http://localhost:8080/stat
```

## Verificar el stream con ffprobe

```bash
ffprobe rtmp://localhost/live/coscu-test
```

## Arquitectura

```
OBS ──(RTMP)──▶ nginx-rtmp (Docker)
                    │  on_publish / on_publish_done (HTTP webhooks)
                    ▼
              Express :3000 (server.ts)
                    │
                    ▼
            orchestrator.ts (1 sesión por stream_key)
                    │
                    │  cada 1s GET http://localhost:8080/stat
                    ▼
              streamStats.ts (parsea XML del nginx-rtmp)
                    │
                    ▼
                  log.ts (terminal, datos reales)
```

Estructura:

```
poc/pipeline/
├── docker-compose.yml          nginx-rtmp container
├── nginx-rtmp.conf             RTMP config con webhooks + record + /stat
├── package.json                tsx + express + chalk
├── tsconfig.json
├── .env.example
└── src/
    ├── types.ts                StreamSession, NginxRtmpHookBody, StreamStats, ContextTick (contrato futuro)
    ├── log.ts                  chalk + timestamps (estilo poc/negotiation)
    ├── streamStats.ts          GET /stat → parse XML → StreamStats
    ├── orchestrator.ts         maneja sesiones activas (1 stream → 1 polling loop)
    ├── server.ts               express con /api/stream/on-publish[-done]
    └── index.ts                main: levanta express, espera webhooks
```

## Roadmap (commits siguientes)

- **B-04**: `transcribe.ts` — `ffmpeg -i rtmp://... -f s16le -ar 16000 -ac 1 -` → Deepgram WS, transcript rolling 30s.
- **B-05**: `frame.ts` — `ffmpeg -i rtmp://... -vf fps=1 -update 1` → Gemini 2.5 Flash multimodal con prompt agnóstico al contenido (`describí qué se ve y devolvé tags genéricos`).
- **B-06**: `chat.ts` — tmi.js conectado al canal de demo, calcula `chat_velocity_now`, sentiment via Gemini, `recent_chat_keywords` extraídas dinámicamente del propio chat.
- **B-07**: `context.ts` — combinador real que mergea las 3 fuentes en un `ContextTick` y broadcastea (en lugar del log directo).
- **B-08..B-11**: audit clip compuesto (`record on` ya está → cliprange T-10..T+20s → overlay ad → upload Vercel Blob).

> **Importante:** ninguno de los pipes va a hardcodear listas de juegos / moments / palabras de chat. El frame_summary y los frame_tags los devuelve el LLM en función de lo que ve. Los chat keywords salen del chat real con un n-gram counter sobre la ventana móvil. El audio_30s es la transcripción literal de Deepgram. El pipeline es content-agnostic: gaming, IRL, ASMR, charla política — todo procesado igual.

## Lo que está intencionalmente fuera de scope

- Supabase Realtime broadcast — los stats van solo a la terminal del POC.
- Audit clip con overlay del ad — `record on` está, pero falta el segundo `ffmpeg` que mete el ad en el clip (B-10).
- Brand-agent / streamer-agent — ver [`poc/negotiation/`](../negotiation/).
- Privy wallets / escrow — ver [DESIGN.md §4](../../DESIGN.md).
- Auth real en `on_publish` (rechazar streams no autorizados con 403).

Cuando se haga el porting a `apps/web/`, el express server pasa a route handlers en `apps/web/src/app/api/stream/*` y el `ContextTick` se broadcastea a un canal de Supabase Realtime. El orchestrator y los módulos de pipe portean sin cambios.

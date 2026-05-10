# Addie

**Track:** 🤑 Agentic Money · Platanus Hack BSAS 2026

Plataforma de ad-tech agentic para streamers en vivo. Agentes de IA autónomos negocian en tiempo real por segundos de publicidad en tu stream y pagan en USDC on-chain en Base.

## El problema

El streaming live mueve millones, pero el modelo de monetización está roto:

- **CPMs opacos.** El creador no sabe qué paga la marca, la marca no sabe qué momento compra. Los intermediarios cobran 30-50% de cada deal.
- **Contratos a 30 días.** Pre-vendés tu audiencia futura sin saber si vas a tener el momento épico que la marca busca, y la marca paga aunque ese momento no llegue.
- **Brand-safety reactiva.** El streamer no controla qué se le superpone en pantalla en vivo. Cuando algo no calza, ya salió al aire.

## La solución

Cada momento del stream se vende como un evento atómico, en lenguaje natural, entre agentes que representan a las marcas y al creador.

```
Streamer dice "platanus" en el stream
           ↓
Pipeline transcribe en ~400ms (ElevenLabs Scribe v2)
           ↓
Brand-agents (Claude Haiku 4.5) leen el contexto
           ↓
Compiten en una subasta con bids en USDC
           ↓
Streamer-agent acepta o rechaza desde su /dock
           ↓
Si acepta → escrow on-chain (Base) lockea fondos
           ↓
Ad aparece como overlay en OBS (~1s end-to-end)
           ↓
Al terminar el placement, el escrow libera el pago al creador
```

Verificable en basescan. Sin middleman. Sin contratos a 30 días.

## Cómo funciona

### Pipeline de captura

El streamer transmite su contenido vía RTMP a un servidor `nginx-rtmp` local (corriendo en Docker). Un orchestrator en Node levanta varios pipes en paralelo por sesión:

- **Transcripción.** Audio PCM 16kHz → WebSocket de ElevenLabs Scribe v2 con VAD agresivo (commit lag ~400ms).
- **Twitch Helix poll.** Viewers + game_category cada 30s para enriquecer el contexto.
- **chunkWriter.** Cada vez que Scribe commitea texto, escribe una row en `context_chunks` (Supabase Postgres) con el audio nuevo desde el chunk anterior. Si el streamer está en silencio, no hay row — la tabla queda limpia.
- **Keyword flush.** Si el streamer dice una palabra crítica (`platanus`, `monster`, `doritos`), el chunkWriter dispara un INSERT instantáneo sin esperar al setInterval — la latencia keyword → toast queda en ~500ms.

### Worker agentic (Fly.io)

Un worker standalone corriendo en Fly.io escucha LISTEN/NOTIFY del Postgres y por cada chunk nuevo:

1. **Atomic claim** del último chunk no procesado vía `FOR UPDATE SKIP LOCKED`.
2. **Picker (Claude Haiku 4.5).** Lee el `audio_text` del chunk + el registry de marcas (YAML), y elige UNA brand cuyo `match_keywords` calce. Devuelve `brand_id`, `moment_quality`, `brand_match`, `bid_usdc`.
3. **Cooldown per-brand 15s.** Si decís "platanus" tres veces seguidas, solo dispara un toast. Si decís "platanus" y después "monster", los dos pasan.
4. **Emit `kind='offer'` `status='pending'`** en `render_events` + `pg_notify`.

### Pre-approval flow (UX clave)

A diferencia de las soluciones automatic-bidding clásicas, el streamer **siempre tiene la última palabra** sobre qué ad sale al aire:

- El offer aparece en `/dock?creator_id=<slug>` como una card con countdown 8s, brand label, monto en USDC, y dos botones: ✅ aceptar / ❌ rechazar.
- Si acepta antes del TTL → un nuevo `render_event` `kind='brand'` se inserta y el overlay (`/o/<creator_id>`) lo muestra en OBS vía SSE en <1s.
- Si rechaza o el TTL expira → no pasa nada. El ad nunca sale al aire.
- Múltiples offers simultáneos pueden coexistir; cada uno con su propio countdown.

### Settlement on-chain

- **Smart contract de escrow** desplegado en Base Sepolia (Solidity + Foundry). El brand-agent firma un transfer USDC a la cuenta del escrow al momento del bid.
- Cuando el streamer acepta, el escrow lockea el monto.
- Cuando el ad termina (post `duration_ms`), el escrow libera el pago al wallet del creator.
- Privy embedded wallets para que cada brand-agent tenga su propio signer programático.

## Componentes

| Componente | Stack | Hosting |
|---|---|---|
| Pipeline ingesta | nginx-rtmp + ffmpeg + Node.js + ElevenLabs Scribe v2 | Local (Docker) |
| Worker agentic | TypeScript standalone + Claude Haiku 4.5 | Fly.io |
| Web app | Next.js 16 (App Router) + Tailwind 4 | Vercel |
| Base de datos | Postgres + LISTEN/NOTIFY | Supabase |
| Smart contracts | Solidity + Foundry + viem | Base Sepolia |
| Wallets | Privy embedded wallets | — |
| Storage | Vercel Blob | — |
| Streaming | OBS → RTMP → Browser Source overlay | OBS Studio |

## Demo flow

1. **Streamer arranca OBS** apuntando a `rtmp://localhost:1935/live/<stream_key>` y agrega un Browser Source con `https://addie.demo/o/<stream_key>` (overlay vacío hasta que apruebe un offer).
2. **Streamer abre `/dock?creator_id=<stream_key>`** en su segundo monitor.
3. **Streamer dice "platanus"** en cámara.
4. **~500ms después** aparece una card en el dock: 🍌 Platanus, $1.50 USDC, lower_third 8s, countdown 8s.
5. **Streamer aprueba con ✅.**
6. **El ad de Platanus aparece** sobre el video en el monitor 1 (lo que ven los viewers).
7. **Al terminar los 8s** el escrow libera el pago al wallet del creator. Verificable en basescan.

## Brand registry

Las marcas se definen como YAMLs declarativos en `worker/brands/*.yaml` (worker) y `apps/web/src/lib/agents/brands/*.yaml` (manager web). Cada YAML tiene:

- `match_keywords` — palabras que disparan el match (con normalización NFD para tolerar acentos).
- `daily_cap_usdc`, `min_bid_usdc`, `max_bid_usdc` — límites económicos del brand-agent.
- `ad_asset_url` + `ad_zone` + `ad_duration_ms` — el creative pre-producido y dónde se muestra.
- `prompt` — system persona, voice examples, restricciones para la negociación.
- `event_filters`, `brand_safety`, `dayparts` — gates que el agent honra antes de bidear.

## Roadmap

- **Negociación multi-turno.** Hoy es 1-turno (brand-agent propone, streamer-agent acepta/rechaza). Próximo: 2-3 turnos con concession_step_pct para que la marca pueda subir el bid si el streamer rechaza.
- **Standing offers.** Brands con presupuestos mensuales que un brand-agent gestiona autónomamente.
- **Auditoría on-chain por placement.** Hash del transcript + timestamp + tx_hash en una tabla `placements` queryable por la marca.
- **Soporte multi-creator.** Hoy un worker = un stream_key. Próximo: scaling horizontal vía claim contention en Postgres.

## Equipo

| Persona | GitHub | Track |
|---|---|---|
| Franco | [@francowini](https://github.com/francowini) | A — On-chain (escrow, USDC settlement, Privy) |
| Lucas | [@lucas-emartinez](https://github.com/lucas-emartinez) | B — Pipeline (ingesta, transcripción, worker) |
| Andy | [@arvenz0210](https://github.com/arvenz0210) | C — Agents (Claude pickers, brand registry, gates) |
| Jere | [@jeremybacher](https://github.com/jeremybacher) | D — UI (dock, overlay, dashboard) |

## Links

- **Demo deployado:** https://web-arvenz0210s-projects.vercel.app
- **Repo:** https://github.com/platanus-hack/platanus-hack-26-ar-team-2
- **Tag de versión del demo:** `v0.1.0`

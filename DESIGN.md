# Addie — Diseño Final

**Fecha:** 2026-05-09
**Hackatón:** Platanus Hack BSAS · track *agent money*
**Demo:** domingo 2026-05-10 12:00
**Equipo:** 4 ingenieros · ~22 hs efectivas
**Repo:** [platanus-hack/platanus-hack-26-ar-team-2](https://github.com/platanus-hack/platanus-hack-26-ar-team-2)

---

## TL;DR

Dos agents AI negocian en tiempo real durante un stream en vivo. El brand-agent caza momentos épicos. El streamer-agent defiende los intereses del creator. **Las marcas suben sus ads pre-producidos a Addie**; el brand-agent decide cuándo y cuál mostrar. Cuando cierran deal, escrow lock + render con video del brand + QR dinámico de tracking, escrow release a USDC en la wallet del creator. Todo on-chain en Base, todo verificable en basescan.

---

## 1. Conceptos clave

1. **Brand-agents son cazadores activos.** Subscriben a múltiples streams, evalúan contexto en vivo, deciden cuándo y con QUÉ ad bidean (de la biblioteca que la marca pre-cargó).
2. **Streamer-agent es defensor reactivo.** Recibe ofertas, filtra contra mandate firmado del creator, negocia o rechaza, cierra deals.
3. **Negociación en lenguaje natural multi-turno.** No es bidding numérico — los dos agents regatean en español 2-3 turnos antes de cerrar. Eso es agent commerce real.
4. **Las marcas suben sus ads.** No hay generación runtime de creative. Las marcas son las dueñas de su arte; Addie decide cuándo mostrarlo. Igual que cualquier ad-tech serio.
5. **Settlement on-chain en USDC.** Lock al ganar, release al renderizar, refund automático si brand-safety pull. 2 transacciones por placement, todas en Base mainnet.

---

## 2. Arquitectura general — 5 capas

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 1 · INGEST                                                    │
│  ───────────────────────────────────────────────────────────        │
│  OBS del creator ──RTMP──► nginx-rtmp localhost (~1s latency)       │
│                  ──RTMP──► Twitch ingest (público + chat real)      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 2 · CONTEXT EXTRACTION                                        │
│  ───────────────────────────────────────────────────────────        │
│  ffmpeg pipe                                                        │
│    ├─ audio @16kHz ──► ElevenLabs Scribe v2 realtime ──► transcript rolling 30s │
│    └─ frames @1fps ──► Gemini 2.5 Flash ──► frame summary + tags   │
│  tmi.js IRC ──► Twitch chat velocity + sentiment + recent keywords  │
│                                                                     │
│  Context Buffer (Supabase Realtime channel):                        │
│    { audio_30s, frame, chat_vel, viewers, sentiment, ts }           │
│    broadcast cada 1s                                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (broadcast)
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 3 · NEGOCIACIÓN AGENTIC                                       │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│  8 BRAND-AGENTS (cazadores)                                         │
│   ├─ adidas, nike, quilmes, mp, steam, rappi, globant, cocacola     │
│   ├─ cada uno tiene una BIBLIOTECA DE ADS (subida por la marca)     │
│   ├─ subscriben al context channel                                  │
│   ├─ evalúan: ¿bideo? ¿con qué ad de mi biblioteca? ¿cuánto USDC?   │
│   └─ los que matchean inician negociación con streamer-agent        │
│                                                                     │
│  STREAMER-AGENT (defensor reactivo)                                 │
│   ├─ tiene mandate firmado del creator (inventory + prefs)          │
│   ├─ recibe N ofertas en paralelo                                   │
│   ├─ negocia 2-3 turnos en español por cada una                     │
│   └─ compara closed deals → pickea ganador                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ ("adidas ganó $1.80 con ad 'epic_goal_lower'")
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 4 · SETTLEMENT (on-chain)                                     │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│   AddieEscrow.lock(placementId, streamer_team_addr, 1.80 USDC)      │
│   ⚡ tx en basescan #1                                              │
│                                                                     │
│   Plataforma arma placement assembly:                               │
│   { ad_video_url: "...epic_goal_lower.mp4",                         │
│     tracking_qr_url: "addie.app/q/<placement_id>",                  │
│     duration_ms: 6000, zone: "lower_third" }                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 5 · RENDER + RELEASE                                          │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│   Push directo al Browser Source overlay (MVP: sin approve manual)  │
│   <video autoplay src={ad_url}>                                     │
│   <img class="qr-corner" src={qr_dynamic}>                          │
│   framer-motion fade-in                                             │
│              │                                                      │
│   Brand-safety listener corre en paralelo durante el render:        │
│   keyword prohibida → fade out 200ms → AddieEscrow.refund           │
│   ⚡ tx alt #2 (refund): USDC vuelve al brand-agent                 │
│              │                                                      │
│   Twitch viewers + jueces ven el placement durante N segundos       │
│              │                                                      │
│              ▼ (placement termina sin pull)                         │
│   AddieEscrow.release(placementId)                                  │
│   ⚡ tx #2 (release): 1.80 USDC → streamer-team wallet              │
│                                                                     │
│   En paralelo, async: clip 30s (T-10s..T+20s) → Vercel Blob         │
│   → placements.clip_url para auditoría de la marca                  │
│                                                                     │
│   Per-placement approve del creator → Post-MVP §13.                 │
│   MVP confía en mandate firmado + brand-safety auto-pull.           │
└─────────────────────────────────────────────────────────────────────┘
```

**Latencia end-to-end:** ~5-7 segundos del momento épico al placement on-screen (sin step de approve manual en MVP). **2 txs por placement** (lock + release).

---

## 3. Diagrama de flujo — vida de un placement

> **Nota — ejemplo ilustrativo.** El timeline de abajo usa nombres de marca reales (adidas/nike/mp) porque corresponde al spec técnico pre-pivote. El **demo final** usa marcas inventadas (☕ CafetITO, 🧊 TermoFlex, 🌭 Pancho Rex, 🧉 MateBros) y la narrativa externa es de **matching win-win-win** en vez de subasta competitiva — ver `docs/PITCH.md` y `docs/DEMO_RUNBOOK.md`. El mecanismo interno (auction con deadline + standing offers + soft holds) **no cambia**: es el plumbing que implementa el matching. Solo cambia cómo se cuenta hacia afuera.

```
T+0.0s    Speaker dice trigger word ("ÉPICO") en el pitch
─────────────────────────────────────────────────────────────────────
T+0.5s    OBS encode → RTMP llega a nginx-rtmp
T+1.2s    ElevenLabs Scribe v2 realtime transcribe "ÉPICO"
T+1.3s    Gemini Flash describe frame: "speakers gesticulando + dashboard"
T+1.5s    tmi.js detecta chat velocity 12→180 msg/s
T+1.5s    Context broadcast a brand-agents
─────────────────────────────────────────────────────────────────────
T+2.0s    LLM call paralela en los brand-agents (2 en MVP: adidas + mp; N en prod):
          → adidas: HUNT con "epic_goal_lower" (epic mood + audience match)
          → nike: HUNT con "win_moment_lower"
          → quilmes: HUNT con "social_celebration"
          → rappi: SKIP (no es food context)
          → mp: HUNT weak con "persistent_logo"
          → steam, globant, cocacola: SKIP
─────────────────────────────────────────────────────────────────────
T+2.5s    4 brand-agents inician negociación con streamer-agent
T+5.5s    Negociaciones cierran 3 turnos:
          adidas: $1.80 / lower_third / 6s ✅ con "epic_goal_lower"
          nike: $1.50 / lower_third / 5s ✅ con "win_moment_lower"
          quilmes: no deal
          mp: $0.30 / corner / 30s ✅ con "persistent_logo"
─────────────────────────────────────────────────────────────────────
T+5.7s    Streamer-agent compara: ADIDAS gana
          (mejor USD/seg en zona premium + brand fit alto)
─────────────────────────────────────────────────────────────────────
T+6.0s    Orchestrator firma desde la wallet de adidas (session signer Privy):
          ⚡ AddieEscrow.lock(1.80 USDC)  [tx 0xAAA]
─────────────────────────────────────────────────────────────────────
T+6.2s    Plataforma arma placement assembly:
          { ad_url: "https://addie-cdn/.../adidas/epic_goal_lower.mp4",
            qr_url: "addie.app/q/abc123?placement=...",
            duration_ms: 6000, zone: "lower_third" }
─────────────────────────────────────────────────────────────────────
T+6.5s    Push directo al Browser Source overlay (MVP: sin approve)
T+6.55s   Overlay renderiza:
          <video autoplay src={ad_url}>     ← ad de adidas (con voz baked-in)
          <img class="qr-corner" src={qr_dynamic}>
          framer-motion fade-in
          Brand-safety listener activo en paralelo
─────────────────────────────────────────────────────────────────────
T+12.55s  Placement termina (duración 6s)
T+12.6s   ⚡ AddieEscrow.release(placementId)  [tx 0xBBB]
          → 1.80 USDC al wallet del streamer-team
─────────────────────────────────────────────────────────────────────
T+15s     [Async] Clip de auditoría guardado:
          nginx-rtmp segmenta T-10s..T+20s → mp4 → Vercel Blob
          → placements.clip_url disponible en la brand console

2 transacciones on-chain por placement (lock + release).
Demo de 5 min con ~6 placements = ~12 txs visibles en basescan.
```

---

## 4. Negociación: subasta con deadline + soft holds

La negociación no funciona como un protocolo "sí/no" donde los agents tienen que llegar a un acuerdo explícito. Es una **subasta con deadline duro de 5s** sobre standing offers que se actualizan turno a turno.

### Tres agentes

Tres roles agénticos, todos LLM-powered, cada uno con su propio prompt + tooling:

| Agent | Cuántos | Modelo | Trigger | Job |
|---|---|---|---|---|
| **Manager** | 1 por stream | Claude Haiku 4.5 | tick filtrado por cheap intensity (B-07a) | Decide si el momento amerita pautar (auctionable). Pre-flag de brand-safety. Sugiere zonas + duración. |
| **Brand-agent** | **2 en MVP** (adidas + mp), escalable a N | Claude Haiku 4.5 | inicio de auction | Hunt + bid + counter-response con curva de concesión. Walk-away discipline. |
| **Streamer-agent** | 1 por creator | Claude Sonnet 4.6 | inicio de auction (parallel batched) | Counter-batched a todas las ofertas, picks single winner. Defiende inventario. |

**MVP scope — 2 brands:**
- **adidas** (premium episodic) — apunta a momentos celebratorios deportivos. Bidea fuerte en zonas premium (`lower_third`) cuando el manager flaggea épico.
- **mp / MercadoPago** (default bidder al floor, `always_bid_floor: true`) — siempre ofrece el reserve mínimo del streamer si el contexto no es brand-unsafe. Llena los momentos en los que adidas no bidea (calm chat, audiencia chica).

Esto preserva los dos roles del diseño (premium vs floor) con la cantidad mínima de marcas. Producción agrega N brands sin cambios de arquitectura — solo más rows en `mandates`. El resto del diseño (manager + streamer-agent + orchestrator + settlement) es brand-count-agnóstico.

El **Manager** es el filtro económico: protege costos LLM (8 brand-agents corriendo en cada tick sería ~$3-10/min) y la experiencia del viewer (no pautar cada 5 segundos). Los **Brand-agents** son cazadores con disciplina de mandate. El **Streamer-agent** es defensor de inventario con visión global.

### Process topology — qué corre dónde

```
LAPTOP / VPS BACKEND (un solo host físico para el demo)
├── nginx-rtmp (Docker container)
│   recibe RTMP de OBS, dispara on_publish/on_publish_done webhooks
│
├── pipeline orchestrator
│   (Node, port de poc/pipeline → apps/web/src/lib/pipeline/)
│   ↳ ffmpeg → ElevenLabs Scribe v2 (audio) + Gemini Flash (frame) + tmi.js (chat)
│   ↳ ContextTick cada 1s
│   ↳ cheap_intensity = score(chat_spike, sentiment, audio_caps, audience)  // B-07a, sin LLM
│   ↳ supabase.realtime.broadcast('context:<stream_id>', tick)
│
├── manager-worker (proceso Node, ~50 LoC, apps/manager-worker/)  // C-08m
│   ↳ supabase.channel('context:<stream_id>').on('broadcast', { event: 'tick' }, …)
│   ↳ filtra cheap_intensity > 0.5 + cooldown_ok (30s post-auction)
│   ↳ await managerDecide(tick)  → Claude Haiku
│   ↳ if decision.should_auction:
│       POST /api/auctions/run  { tick, manager_decision }
│
└── Next.js (apps/web, deployable a Vercel)
    /api/stream/{on-publish,on-publish-done}      ← arrancan/limpian el orchestrator (B-03)
    /api/auctions/run                              ← runs full auction (sync, ~5-8s)  (C-14)
    /api/q/[placement]                             ← QR redirect + tracking (C-17)
    /overlay/[stream_id]                           ← Browser Source overlay (D-01)
    /dock                                          ← OBS Browser Dock (D-03)
    /demo-display                                  ← pantalla principal del demo (D-09)
    /brands/[brandId]                              ← brand console (D-06)

LAPTOP STREAMER (laptop del team que streamea el pitch — meta-streaming)
├── OBS (publica RTMP a backend)
├── Browser Source overlay (loads /overlay/<stream_id>)
└── OBS Browser Dock (loads /dock)
```

**Por qué Manager-as-worker en vez de inline en el pipeline:** mantiene la separación 1-rol-1-proceso (el pitch dice "tres agentes"; los hacemos visibles), usa Supabase Realtime de verdad como transporte, y deja el pipeline puro (solo ingest + emit). Trade-off: un proceso más para lanzar en el demo. Para producción multi-stream, manager-worker se replica fácil.

### Event flow — Supabase Realtime topics + payloads

Cinco eventos distintos viajan por el sistema. Tres por Supabase Realtime broadcast, uno por HTTP POST, uno por watch del contrato on-chain.

```
1. ContextTick           — every 1s                               ◀ pipeline → Realtime
   topic     'context:<stream_id>'
   producer  pipeline orchestrator (B-07)
   consumers manager-worker  (C-08m)
             /demo-display    (live debug feed, D-09)
   payload {
     stream_id, ts_ms,
     audio_30s, audio_partial,
     frame_summary, scene_type, energy_level, mood_tags, on_screen_text,
     bw_effective_kbps, video_meta, audio_meta,
     chat_velocity_now, chat_velocity_baseline, recent_keywords,
     viewer_count, sentiment,
     cheap_intensity         // [0..1] computed inline by B-07a
   }

2. ManagerDecision       — rare (~6 / 5min)                       ◀ manager-worker → HTTP
   transport HTTP POST (sin Realtime topic — request/response sync)
   producer  manager-worker
   consumer  /api/auctions/run
   payload {
     stream_id,
     tick: <ContextTick que disparó>,
     manager_decision: {
       should_auction: true,
       intensity_label: 'epic'|'building'|'rage'|'mundane',
       brand_safety_pre_flag: string|null,
       recommended_zones: ['lower_third'|'bottom_right_corner'][],
       recommended_max_duration_s: number,
       reason: string         // español, ≤2 oraciones, audit
     }
   }

3. AuctionStarted        — immediately on accept                  ◀ /api/auctions/run → Realtime
   topic     'auction:<stream_id>'
   producer  /api/auctions/run
   consumers /demo-display (chat columnas)
             /dock (saldo updates)
   payload {
     auction_id, stream_id, tick, manager_decision, started_at_ms,
     market_signals: {
       intensity_label, intensity_multiplier,
       fair_value_usdc:        { lower_third, bottom_right_corner },
       dynamic_reserve_usdc:   { lower_third, bottom_right_corner },
       streamer_aspiration_usdc:{ lower_third, bottom_right_corner }
     },
     brands_evaluated: 8
   }

4. NegotiationTurn       — multiple per auction (~10-20 turns)    ◀ /api/auctions/run → Realtime
   topic     'auction:<auction_id>:turn'
   producer  /api/auctions/run (orchestrator interno)
   consumer  /demo-display (chat de negociación en vivo)
   payload {
     auction_id, round, ts_ms,
     from: 'brand'|'streamer', brand_id,
     action: 'open'|'counter'|'accept'|'reject'|'walk',
     message,                  // español, ≤25 palabras
     terms: { bid_usdc, duration_s, zone, exclusivity_s? }?,
     curve_target_usdc?,       // audit: target del concession curve
     tactic?,                  // streamer-side: PLAY_BIDDERS / ANCHOR_ABOVE_RESERVE / etc.
     override?                 // si AC_combi gate disparó (LLM trató de violar RP)
   }

5. AuctionSettled        — one per auction                        ◀ /api/auctions/run → Realtime
   topic     'auction:<stream_id>:settled'
   producer  /api/auctions/run
   consumers /demo-display (winner banner)
             /dock (balance actualizado)
             /brands/<winner>/audit (toca refresh de la lista)
   payload {
     auction_id, stream_id, settled_at_ms,
     winner: {
       brand_id, terms, reason,
       placement_id,           // FK a placements row
       escrow_lock_tx_hash     // basescan link
     } | null,                 // null si no hubo deal (pasa raro con default bidder)
     rejected: [{ brand_id, reason }],
     total_revenue_usdc,
     metrics: {
       total_rounds, total_llm_calls, ac_overrides_fired
     }
   }

6. PlacementRendering    — overlay arranca el render              ◀ /api/auctions/run → Realtime
   topic     'placement:<stream_id>'
   producer  /api/auctions/run (post escrow.lock exitoso)
   consumer  Browser Source overlay (/overlay/<stream_id>)
   payload {
     placement_id, ad_url, qr_url, zone,
     duration_ms, brand_id, start_at_ms
   }

7. (on-chain)            — Locked / Released / Refunded events    ◀ AddieEscrow → viem watch
   producer  AddieEscrow.sol on Base
   consumer  TxFeed component (apps/web/src/components/demo/TxFeed.tsx, A-10)
   payload   per-event ABI (placementId, payee, amount, txHash, blockNumber)
```

### Salience gate — anti-spam + cost ceiling

Pipeline calcula `cheap_intensity` cada tick (heurística sin LLM, B-07a): chat velocity spike + sentiment + audio salience + audience size. **Solo ticks con `cheap_intensity > 0.5` despiertan al manager-agent**. El manager filtra más con su propia decisión LLM.

Cifras esperadas (escenario fifa_goal en demo):

| Etapa | Volumen / 5min | Costo |
|---|---|---|
| Ticks emitidos por pipeline | 300 (1/s) | $0 — heurística sin LLM |
| Pasan cheap_intensity > 0.5 | ~30-50 | $0 |
| Pasan también el cooldown (30s post-auction) | ~6-10 | — |
| Manager LLM calls (Haiku) | ~6-10 | ~$0.01 total |
| Auctions disparadas (~50% de manager YES) | ~6 | ~$0.60 total (~$0.10 c/u) |
| **Total demo** | — | **~$0.61 USD** |

### Cooldowns y fail-modes

- Después de un `AuctionSettled`, el manager-worker setea `cooldown = now + 30s`. Cualquier tick recibido en ese período se ignora (anti-spam visual + ahorro LLM).
- Si `managerDecide()` falla (LLM error, timeout): **fail-closed** → `should_auction = false`. Mejor perder un placement que disparar uno sin verificar brand-safety pre-flag.
- Si `/api/auctions/run` está mid-flight cuando llega un nuevo trigger del manager: **drop el nuevo** (el cooldown del manager lo absorbe igual al settlement).
- Si `escrow.lock()` falla on-chain post-settlement: fallback al runner-up (ver C-12). Si runner-up también falla: skip placement (el momento se pierde, no se rompe el demo).
- Si la conexión Realtime del manager se cae: reconnect con backoff (Supabase JS lo hace solo); ticks perdidos durante reconnect = placements perdidos, aceptable.

### Event broadcast pattern — base reusable (C-13a)

Todos los eventos que llegan al overlay del creator (incluyendo `PlacementRendering` de §4) usan el mismo patrón base: **POST a un endpoint targeted por creator → row en Postgres + `NOTIFY` → SSE handler hace `LISTEN` y push al iframe del creator**.

Decidido NO usar Supabase Realtime broadcast directo: queremos una capa de logic intermedia (filtrado, scheduling, retries, audit) sobre las que ya tenemos transparencia con queries normales sobre la tabla `render_events`.

**Cómo funciona:**

```
┌────────────────────────────────────────────────────────────────┐
│  CUALQUIER PRODUCTOR (auctions/run, manager-worker, curl test) │
│  curl -X POST https://addie/api/creators/<id>/render           │
│       -H "Content-Type: application/json"                      │
│       -d '{"message":"Hola"}'                                  │
│       (más adelante: { asset_url, asset_type, duration_ms,     │
│        zone, expires_at } cuando los assets vivan en S3)       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  POST /api/creators/[creator_id]/render  (Next.js Route)       │
│  - INSERT INTO render_events (creator_id, message, …)          │
│  - NOTIFY render_events, '<creator_id>:<event_id>'             │
│  - return 200 { event_id }                                     │
└────────────────────────────────────────────────────────────────┘
                              │  pg LISTEN/NOTIFY (in-process)
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  GET /api/creators/[creator_id]/stream  (SSE, Edge runtime)    │
│  - On connect: dedicated pg client does `LISTEN render_events` │
│  - On notify with matching creator_id: SELECT row + push        │
│    `data: <json>\n\n` to the SSE stream                        │
│  - Heartbeat `: ping\n\n` cada 25s para keep-alive              │
│  - On reconnect: replay desde `?since=<event_id>`              │
└────────────────────────────────────────────────────────────────┘
                              │  text/event-stream
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  IFRAME en /o/[creator_id]  (Client Component)                 │
│  const es = new EventSource('/api/creators/<id>/stream')       │
│  es.onmessage = (e) => render(JSON.parse(e.data))              │
│  EventSource auto-reconnects en disconnect (Vercel timeout)    │
└────────────────────────────────────────────────────────────────┘
```

**Por qué SSE + pg LISTEN/NOTIFY:**
- Pure Next.js Edge runtime, no extra infra (Redis/Pusher/etc.)
- `render_events` table = source of truth para auditoría, scheduling, retries
- pg `NOTIFY` push instantáneo (sub-segundo) → no polling
- `EventSource` browser API auto-reconnects → Vercel timeouts son transparentes
- Iframe-friendly (sin headers especiales)
- Una capa de "logic" entre POST y push se agrega editando solo el handler — no cambiamos transport

**Por qué NO Supabase Realtime broadcast:**
- Queremos audit trail + capacidad de query (qué se mandó, cuándo, a quién, ¿se entregó?)
- Queremos un punto explícito para insertar logic (rate limiting, brand-safety check, deduplicación) entre POST y push
- Postgres ya está + ya manejamos el connection pool

**Cómo C-14 lo reusa:**
Mismo POST endpoint, mismo SSE stream. La auction llama `POST /api/creators/<creator_id>/render` con `{ asset_url, duration_ms, zone, placement_id, brand_id }` cuando elige al ganador. El iframe `/o/[creator_id]` ya está conectado y recibe el evento.

**Sobre los assets (post-MVP):**
- Assets de ads (videos / imágenes) van a S3 (o Vercel Blob como bridge mientras se setea S3 — P0-14).
- `render_events.asset_url` = URL pública (CDN cache OK)
- El iframe hace `<video src="…">` o `<img src="…">` — el browser hace fetch directo a S3
- Esto significa: el SSE stream solo carga JSON metadata pequeño; los pixels viajan por separado en HTTPS optimizado.

### Mecánica

```
T+0s     N brand-agents inician diálogo con streamer-agent
T+0-4s   Cada uno regatea hasta 3 turnos (paralelo, en español)
         Cada turno → standing offer actualizada + soft hold renovado
T+5s     ⏰ Hard deadline → settlement step:
         streamer-agent toma la mejor standing offer ≥ floor del mandate
         y la cierra unilateralmente (sin requerir "OK" final del brand)
```

**Standing offers.** En cualquier turno, lo último que dijo el brand-agent cuenta como su oferta vigente. Si se traba en regateo eterno o se queda sin turnos, su última oferta sigue en pie. Al deadline el streamer-agent agarra la mejor disponible — igual que un closing call de mercado real ("going once, going twice, sold").

### Un solo ad por momento

En cualquier instante corre **EXACTAMENTE UN ad** en pantalla, sin importar la zona. Las zonas (`lower_third`, `bottom_right_corner`, `fullscreen_takeover`) son **formatos** del único slot — definen dónde aparece el ad y cuánto puede durar — no slots simultáneos. Cada subasta termina con UN único ganador a través de todas las zonas competidoras.

Esto significa:
- Entre momentos épicos detectados (o FULL BREAK manual), la pantalla está limpia, sin overlay.
- Si un brand-agent bidea con `lower_third 6s` y otro con `bottom_right_corner 30s`, son **alternativas** del mismo slot — ganará una sola.
- El streamer-agent elige el ganador comparando revenue absoluto + fit del momento + marcas preferidas.
- Las zonas se mantienen en el modelo porque definen el formato visual del ad ganador (tamaño, posición, duración), pero nunca corren en paralelo.

**Default bidder vía mp.** Uno de los brand-agents (MercadoPago con su `persistent_logo`) actúa como **default bidder al floor**: para cualquier contexto que no sea brand-unsafe, ofrece exactamente el reserve mínimo del streamer. Garantiza que toda subasta tenga al menos UNA standing offer cerrable al deadline, incluso si los otros brands pasan el momento. Si una marca premium bidea más alto, la desplaza naturalmente. Es transparente — figura como tercera pata del *Know Your Agent* del mp (`always_bid_floor: true` en su mandate).

### Soft hold ledger (off-chain)

Para evitar que un brand-agent prometa $1.80 acá y $1.50 en otra subasta paralela cuando solo tiene $2 en wallet, el orchestrator mantiene en memoria:

```ts
holds: { brand_id, placement_id, amount, expires_at }[]
```

Cada vez que un brand-agent emite o actualiza una standing offer, se crea/refresca su hold con `expires_at = now + 10s`. La `available_balance` que se le expone al LLM en el siguiente prompt = `on_chain_balance - Σ(holds_propios_activos)`. Garantiza correctness sin tx on-chain durante la negociación.

### Settlement step (T+5s)

1. Streamer-agent elige la mejor standing offer ≥ floor de su mandate **a través de todas las zonas competidoras** (lower_third, corner). Comparación: revenue absoluto + fit + marca preferida.
2. Si ninguna supera el floor, gana el default bidder (mp tiene siempre una standing offer exacta al floor → fill garantizado).
3. El hold del ganador se convierte en `escrow.lock()` on-chain real.
4. Si el lock falla on-chain (defensivo), fallback al runner-up — también tiene hold activo.
5. Holds de los perdedores se liberan; vuelven al `available_balance` del LLM en su próxima decisión.

**Quién firma cada tx.** El brand-agent decide; el **orchestrator firma** desde la smart wallet del brand vía **session signer de Privy** pre-aprobado al crear el mandate (Know Your Agent). Concretamente:

| Tx | Firma | Por qué |
|---|---|---|
| `escrow.lock()` | Orchestrator → wallet del brand ganador (session signer) | El brand está poniendo plata; la session key acotada al `AddieEscrow` + `validBefore` evita pedirle al humano-marca que firme cada placement (latencia <5s imposible si no). Revocable on-chain en cualquier momento. |
| `escrow.release()` | Orchestrator → wallet plataforma (rol `releaser` en el contrato) | Trigger-only: el contrato chequea que `placement.status == 'rendered'` y libera al `payee` registrado en el `lock`. Plataforma firma porque tiene visibilidad del end-of-render event; no maneja los fondos. |
| `escrow.refund()` | Orchestrator → wallet plataforma (rol `guardian`) | Brand-safety auto-pull. Mismo principio: plataforma es el listener; el contrato valida que `status == 'locked'` y devuelve al brand. |

El orchestrator no custodia claves de usuarios — solo ejecuta sobre session keys que el humano-marca aprobó al firmar su mandate, y sobre la wallet plataforma para los roles `releaser`/`guardian`. La separación de roles vive en el contrato (`AddieEscrow.sol`, A-04), no en código off-chain.

### Garantías

- ✅ **Single-ad-per-moment** — UN único placement on-screen por subasta, nunca dos overlays compitiendo.
- ✅ **Siempre hay ganador** — default bidder al floor garantiza que toda subasta cierra; runner-up cubre lock failures.
- ✅ **Latencia predecible** — 5s exactos, sin diálogos eternos.
- ✅ **Sin double-spend** — soft holds previenen sobre-comprometer balance entre subastas paralelas.

### Inventario: zonas como formatos del único slot

Las zonas no son slots simultáneos — son **formatos** que definen dónde y cuánto dura el ad ganador.

| Zona | Tamaño / posición | Duración típica | Cuándo dispara |
|---|---|---|---|
| `lower_third` | Banda inferior 1920×180 | 5-8s | Subasta automática en momentos épicos detectados por el pipeline |
| `bottom_right_corner` | Logo 240×240 esquina | hasta 60s | Subasta automática también disponible; default bidder cubre el floor si nadie mejor bidea |
| `fullscreen_takeover` | Pantalla completa 1920×1080 | 30s | **Solo manual** vía hotkey FULL BREAK del creator (Acto 4 demo) |

En subastas automáticas los brand-agents pueden ofertar en `lower_third` o `bottom_right_corner` — la elección de zona es parte de su standing offer. El streamer-agent elige UNA zona ganadora por subasta (puede preferir un `lower_third 6s` a $2.50 sobre un `corner 30s` a $1.20 si el momento es épico, o al revés en un momento calm). `fullscreen_takeover` queda fuera del bidding automático y solo se activa con hotkey, disparando una subasta dedicada.

**Cadencia esperada en demo:** ~6 subastas en 5 min (una por momento épico) = ~6 placements = 12 txs on-chain (lock + release por placement).

**Post-MVP:** reemplazar soft hold por **EIP-3009 `transferWithAuthorization`** (USDC nativo). Cada standing offer firmada como auth con `validBefore = T+10s`. Hold real on-chain, no centralizado, auditable. Ver §13.

### Pre-LLM gate ladder — cómo cada brand decide MATCH/SKIP barato

Ver `docs/GATES.md` para la spec completa. Resumen:

Cuando un `ContextTick` llega al brand-agent worker, no se llama directo al LLM. Pasa por una **escalera de 4 gates** que filtran progresivamente, ordenados por costo/latencia ascendente. La marca solo "habla" (gasta tokens de LLM) si su mandate y su contexto sugieren que el momento le calza.

```
ContextTick + BrandMandate
        │
        ▼
┌──────────────────────────────────────────────────────┐
│ gate1 · MANDATE DETERMINÍSTICO   ~0ms / $0           │
│ event_filters, dayparts, blocked_keywords,           │
│ blocked_competitor_brands, min_viewers               │
│ → SKIP rápido si el momento contradice el mandate    │
└────────────────┬─────────────────────────────────────┘
                 │ pasa
                 ▼
┌──────────────────────────────────────────────────────┐
│ gate2 · EMBEDDING SIMILARITY     ~10ms / ~$0.0001    │
│ cosine(embed(context), embed(ideal_contexts))        │
│ → SKIP si fit semántico es muy bajo                  │
└────────────────┬─────────────────────────────────────┘
                 │ pasa
                 ▼
┌──────────────────────────────────────────────────────┐
│ gate3 · HAIKU TRIAGE             ~200ms / ~$0.0008   │
│ Claude Haiku decide go/no-go con razonamiento        │
│ → SKIP con reason si el LLM cheap dice que no        │
└────────────────┬─────────────────────────────────────┘
                 │ pasa
                 ▼
┌──────────────────────────────────────────────────────┐
│ gate4 · SONNET DECISIÓN          ~600ms / ~$0.009    │
│ Claude Sonnet → BrandAgentDecision con bid + msg    │
│ → bid concreto entra a la subasta                    │
└──────────────────────────────────────────────────────┘
```

**Bypass del default bidder.** Brands con `always_bid_floor: true` (ej. TermoFlex / mp) saltean gate2/3/4: si pasan gate1 (no es brand-unsafe), emiten directo un bid al floor con `opening_message` templateado, sin LLM. Cero costo, latencia <5ms, fill garantizado.

**Cost/latency budget esperado** (8 brands, 1 auction):
- Sin escalera (todos directo a Sonnet): ~$0.04 + 1.5s p95.
- Con escalera (3-4 brands llegan a Sonnet en promedio): ~$0.01 + 0.8s p95.

**Eventos de logging.** Cada SKIP en cualquier gate emite un `GateSkipReason` event al topic `auction:<auction_id>:gate-skip` con `human_message` en es-AR — esto es lo que la UI didáctica del demo muestra ("☕ CafetITO → SKIP gate1: este momento no es para mí, hoy no hay clutch"). Ver `docs/GATES.md §6`.

**Schema del mandate extendido.** `BrandMandate` adopta nuevos campos opcionales: `event_filters` (required_any_tag, preferred_categories, min_viewers, required_chat_keyword_any), `brand_safety` (blocked_keywords, blocked_categories, blocked_competitor_brands), `dayparts.active`, `ideal_contexts` (free-text para embeddings). Backwards-compatible con los YAMLs actuales — si no están seteados, el gate se saltea.

Tasks de implementación: `C-08a` (gate1 mandate filter) → `C-08b` (gate2 embeddings) → `C-08c` (gate3 Haiku) → `C-08d` (Sonnet integration con outputs de gates anteriores como context).

---

## 5. Brand Console — donde las marcas suben sus ads

Cada marca tiene su consola en `addie.app/brands/<brand_id>`.

### Lo que ven las marcas

```
┌────────────────────────────────────────────────────────────────┐
│  CONSOLE de adidas — addie.app/brands/adidas             │
│                                                                │
│  💰 Saldo: 47.36 USDC          [+ Cargar más USDC]            │
│  📊 Wallet: 0x4f...a8c (basescan ↗)                           │
│                                                                │
│  📦 Mi biblioteca de ads:                                      │
│                                                                │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ╔════════╗  Epic Goal Lower                              │ │
│  │  ║ video  ║  Format: lower_third (1920x180)               │ │
│  │  ║  6s    ║  Duration: 6000ms                             │ │
│  │  ╚════════╝  Targeting: FIFA, eFootball, Just Chatting   │ │
│  │              Mood tags: high_energy, celebration          │ │
│  │              Tracking URL: adidas.com.ar/predator         │ │
│  │              [Editar metadata] [Reemplazar asset]         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ╔════════╗  Premium Takeover                             │ │
│  │  ║ video  ║  Format: fullscreen_takeover (1920x1080)      │ │
│  │  ║  30s   ║  Targeting: any sports + "calm" moments      │ │
│  │  ╚════════╝  Mood: storytelling, premium                  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ╔════════╗  Persistent Logo                              │ │
│  │  ║ image  ║  Format: bottom_right_corner (240x240)        │ │
│  │  ║ static ║  Duration: hasta 60s                          │ │
│  │  ╚════════╝  Mood: any                                    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  [+ Subir nuevo ad]                                            │
│                                                                │
│  📋 Mandate (firmado EIP-712):                                │
│     Daily cap: $50 USDC · Min bid: $0.50 · Max bid: $5.00    │
│     Brand-safety keywords: [puto, maricón, ...]                │
│     [Editar mandate]                                           │
│                                                                │
│  📊 Performance (últimas 24h):                                │
│     Placements: 47 · QR scans: 312 · Conversions: 28          │
└────────────────────────────────────────────────────────────────┘
```

### Modelo de datos `ads`

```sql
create table ads (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references accounts(id),
  variant_name text not null,
  format text not null check (format in ('lower_third','top_banner','bottom_right_corner','side_panel','fullscreen_takeover','picture_in_picture')),
  asset_url text not null,                    -- video/image en CDN (Vercel Blob / S3)
  asset_type text not null check (asset_type in ('video','image','gif')),
  duration_ms int,
  has_baked_audio boolean default false,
  tracking_url text not null,                  -- destino del QR
  targeting jsonb,                             -- { games, languages, audiences }
  mood_tags text[],                            -- ['high_energy','celebration']
  created_at timestamptz default now()
);
```

### Cómo el brand-agent decide cuál ad usar

```
prompt al LLM (Claude 4.6 Sonnet):
─────────────────────────────────────
Sos el agent de adidas Argentina. Tu mandate y wallet acá:
{ daily_cap: $50, balance: $47, min_bid: $0.50, max_bid: $5 }

Tenés ESTOS ads disponibles:
- ad_id: epic_goal_lower (video 6s, lower_third, mood: high_energy+celebration)
- ad_id: premium_takeover (video 30s, fullscreen, mood: storytelling)
- ad_id: persistent_logo (image, corner, mood: any)
- ad_id: win_moment_lower (video 5s, lower_third, mood: alegre)

Contexto del stream:
- Audio 30s: "GOOOL CARAJOOO QUE GOLAZO"
- Frame: "FIFA gameplay, replay del gol, jugador celebrando"
- Chat velocity: 180 msg/s (baseline 12)
- Sentiment: 0.92
- Viewers: 8430

Inventario disponible del creator (zonas habilitadas):
- lower_third: min_bid $0.50, max_duration 8s
- bottom_right_corner: min_bid $0.20, max_duration 60s
- fullscreen_takeover: min_bid $5.00, manual_only

Output schema:
{ should_bid, ad_id, bid_usdc_cents, zone, opening_message }
─────────────────────────────────────

LLM output:
{ should_bid: true,
  ad_id: "epic_goal_lower",
  bid_usdc_cents: 150,
  zone: "lower_third",
  opening_message: "¡ÉPICO! Quiero este momento. Ofrezco $1.50 por mi ad 
                    'Epic Goal Lower' en lower_third 6s." }
```

El brand-agent NO genera nada. Solo elige.

### Auditoría por placement: clip + reasoning + transcript

Cada placement queda guardado completo para que la marca pueda auditar **dónde** apareció su ad, **por qué** su agent decidió bidear, y **qué** pagó. Sin esto, agent commerce no es defendible: si la marca delega a un agent que toma decisiones autónomas con su plata, tiene que poder reconstruir cualquier decisión a posteriori.

Lo que se guarda por placement:

| Campo | Contenido |
|---|---|
| `clip_url` | Clip de 30s del **video compuesto** (stream + ad overlay + QR) centrado en T+0, mostrando exactamente lo que vieron los viewers durante el placement. 10s antes + 20s después del momento épico. Generado server-side post-render. |
| `context_snapshot` | JSON con lo que vio el brand-agent en el momento de bidear: `{ audio_30s, frame_summary, frame_tags, chat_velocity, viewers, sentiment, ts }`. |
| `agent_reasoning` | Output completo del LLM al decidir bidear: `{ should_bid, ad_id, bid_usdc_cents, zone, opening_message, reasoning }`. |
| `negotiation_transcript` | Diálogo completo en español entre brand-agent y streamer-agent (todos los turnos, standing offers actualizadas turno a turno). |
| `winning_offer` | `{ bid_amount, ad_id, zone, duration_ms, settled_at }` — la oferta cerrada que ganó la subasta. |
| `onchain_refs` | `{ lock_tx_hash, release_tx_hash, refund_tx_hash }` con links a basescan. |
| `qr_metrics` | Scans agregados, conversiones reportadas (post-render). |

La brand console expone estos por placement con botones **"Ver clip"**, **"Ver razonamiento"**, **"Ver transcript"**, **"Ver en basescan"**. También exportable a CSV/JSON para auditorías externas (legal, compliance, agencia).

```sql
create table placements (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references streams(id),
  brand_id uuid references accounts(id),
  ad_id uuid references ads(id),
  zone text not null,
  amount_usdc_cents int not null,
  duration_ms int not null,
  rendered_at timestamptz,
  -- audit
  clip_url text,                          -- 30s mp4 en CDN
  context_snapshot jsonb,                 -- lo que vio el brand-agent
  agent_reasoning jsonb,                  -- decisión del LLM
  negotiation_transcript jsonb,           -- diálogo completo en español
  -- on-chain
  lock_tx_hash text,
  release_tx_hash text,
  refund_tx_hash text,
  status text not null check (status in ('locked','rendered','refunded','failed')),
  created_at timestamptz default now()
);
```

**Pipeline del clip compuesto:**
1. nginx-rtmp `record` directive con segmentos de 1s en buffer circular (~60s) — captura el stream crudo del creator.
2. Al evento de placement, el orchestrator extrae el rango T-10s..T+20s del buffer (single ffmpeg `cliprange`, ~2s).
3. Sobre ese clip base, segundo paso ffmpeg: overlay del ad video del `ad_url` en la zona/timestamp correctos (`overlay=x:y:enable='between(t,10,16)'`) + overlay del QR en el corner (`overlay`).
4. Output mp4 final → upload a Vercel Blob → guarda URL en `placements.clip_url`.

Total ~4-6s, **async, no bloquea el placement** ni el settlement on-chain. La marca recibe el clip ya compuesto: ve exactamente lo que el viewer vio (su ad encima del stream del team, con el QR y todo).

---

## 6. Pre-generación de la biblioteca de ads (para el demo)

Las marcas reales generarían sus ads con sus agencias / herramientas. Para el demo, **nosotros pre-generamos la biblioteca de las 2 brands del MVP (adidas + mp) con ElevenLabs Creative**, una sola vez antes del demo. Si queda tiempo, expandimos a más brands; el flow es idéntico — solo cambia la cantidad de iteraciones.

### Matriz a generar

| Brand | epic_goal | premium_takeover | persistent_logo | calm_chat |
|---|---|---|---|---|
| adidas | ✅ video 6s lower | ✅ video 30s full | ✅ image corner | ✅ video 5s lower |
| nike | ✅ | ✅ | ✅ | ✅ |
| quilmes | ✅ | ✅ | ✅ | ✅ |
| mp | ✅ | ✅ | ✅ | ✅ |
| steam | ✅ | ✅ | ✅ | ✅ |
| rappi | ✅ | ✅ | ✅ | ✅ |
| globant | ✅ | ✅ | ✅ | ✅ |
| cocacola | ✅ | ✅ | ✅ | ✅ |

**32 assets totales.** Generación con ElevenLabs Creative (video + voz baked-in + música) toma ~3 min por asset → ~1.5 hs en cola con paralelismo. Hacelo el sábado a la noche.

### Script de pre-gen

```typescript
// scripts/pregen-brand-ads.ts
const BRANDS = ['adidas','nike','quilmes','mp','steam','rappi','globant','cocacola'];
const VARIANTS = [
  { name: 'epic_goal_lower', format: 'lower_third', duration: 6000, mood: 'high_energy' },
  { name: 'premium_takeover', format: 'fullscreen_takeover', duration: 30000, mood: 'storytelling' },
  { name: 'persistent_logo', format: 'bottom_right_corner', duration: 60000, mood: 'any' },
  { name: 'calm_chat_lower', format: 'lower_third', duration: 5000, mood: 'calm' },
];

for (const brand of BRANDS) {
  const kit = brandKits[brand];
  for (const v of VARIANTS) {
    const result = await elevenlabs.creative.generate({
      brand_kit: kit,
      voice_id: kit.voice_id,
      music_mood: v.mood,
      duration_ms: v.duration,
      format_dims: FORMAT_DIMS[v.format],
    });
    const url = await uploadToBlob(result.video_url);
    await db.ads.insert({
      brand_id: brand, variant_name: v.name,
      format: v.format, asset_url: url,
      duration_ms: v.duration, mood_tags: [v.mood],
      targeting: brandTargeting[brand],
      tracking_url: kit.tracking_url,
    });
  }
}
```

### Fallback si pre-gen no termina

Para combinaciones que no quedaron generadas a tiempo: **CSS fallback** — banda negra con logo + texto + colores corporativos. El sistema chequea: ¿hay video? Sí → usa video. No → CSS render. **Demo no se rompe nunca.**

---

## 7. Las tres patas del track *agent money*

| Pata | Cómo se manifiesta |
|---|---|
| **Negociación** | Brand-agents y streamer-agent regatean en lenguaje natural multi-turno. Brand-agent inicia con offer + ad variant, streamer-agent contraoferta basado en mandate del creator + pricing dinámico contextual. Cap 3 turnos. |
| **Know Your Agent** | Cada brand-agent tiene **mandate firmado EIP-712** del humano-marca: budget en USDC, contextos permitidos/prohibidos, keywords-pull, performance bonus. Wallet pública en Base. Auditable, revocable on-chain. |
| **Transacciones** | **USDC nativo en Base.** AddieEscrow contract: `lock` al ganar, `release` al renderizar exitosamente, `refund` si brand-safety pull. Cada placement = 2 txs visibles en basescan. Settlement instantáneo, sin Stripe, sin payouts mensuales. |

---

## 8. Stack tecnológico

| Pieza | Tech | Por qué |
|---|---|---|
| Framework web | Next.js 16 App Router | RSC + edge functions + Vercel free tier |
| Auth + DB | Supabase | Postgres + Realtime + Auth |
| Smart wallets | Privy embedded | Email login, sin seed phrase |
| Blockchain | Base mainnet | Gas barato (~$0.001/tx), USDC nativo |
| Stablecoin | USDC (`0x833589fCD6...`) | Liquidez + EIP-3009 nativo |
| Smart contract | AddieEscrow.sol (~80 líneas) | Lock/release/refund |
| Web3 client | viem | Type-safe Ethereum |
| Stream ingest | nginx-rtmp Docker localhost | Latencia <1s |
| Multi-streaming | OBS plugin "Multiple RTMP Outputs" | Stream simultáneo a Twitch + nuestro RTMP |
| Audio STT | ElevenLabs Scribe v2 realtime (WS) | <500ms latency, misma cuenta que Creative + TTS — una sola API key |
| Vision tagging | Gemini 2.5 Flash multimodal | Free tier 1M tokens/día |
| Brand-agent + streamer-agent LLM | Anthropic Claude 4.6 Sonnet | Mejor razonamiento de negociación |
| Twitch chat | tmi.js IRC | Anonymous read, real-time, free |
| Ad creative pre-gen (offline, una vez) | ElevenLabs Creative | Video + voz + música en una API |
| Asset storage | Vercel Blob | CDN incluido, integración con Next.js |
| QR generation (runtime) | `qrcode` npm | Server-side, ~50ms |
| Frontend | Next.js + Tailwind + framer-motion | Overlay + Dock + Console |

---

## 9. Estructura del proyecto

```
addie/                                  ← repo platanus-hack-26-ar-team-2
├── apps/
│   └── web/                            ← Next.js app
│       ├── src/
│       │   ├── app/
│       │   │   ├── overlay/[id]/       ← Browser Source overlay
│       │   │   ├── dock/               ← OBS Browser Dock UI
│       │   │   ├── settings/
│       │   │   │   ├── inventory/      ← Inventory editor (creator)
│       │   │   │   └── preferences/    ← Brands aprobadas, keywords
│       │   │   ├── brands/[brandId]/   ← Brand console (subir ads, ver perf)
│       │   │   ├── demo-display/       ← Pantalla principal del demo
│       │   │   └── api/
│       │   │       ├── stream/         ← nginx-rtmp webhooks
│       │   │       ├── auctions/       ← negotiation orchestrator endpoint
│       │   │       ├── placements/     ← decide approve/reject
│       │   │       ├── q/[placement]/  ← QR redirect + tracking
│       │   │       └── brands/[id]/ads ← upload + CRUD
│       │   ├── components/
│       │   │   ├── overlay/            ← PlacementRenderer
│       │   │   ├── dock/               ← Incoming, Balance, FullBreak
│       │   │   ├── settings/           ← InventoryEditor
│       │   │   ├── brands/             ← AdLibraryEditor, AdUploader
│       │   │   └── demo/               ← BidLeaderboard, NegotiationChat, TxFeed
│       │   └── lib/
│       │       ├── agents/
│       │       │   ├── brand/          ← brand-agent runner (hunter)
│       │       │   ├── streamer/       ← streamer-agent runner (defender)
│       │       │   ├── negotiation/    ← multi-turn orchestrator
│       │       │   ├── safety/         ← brand-safety auto-pull
│       │       │   ├── brands/         ← 2 mandate templates en MVP (adidas, mp)
│       │       │   └── types.ts
│       │       ├── pipeline/
│       │       │   ├── rtmp.ts         ← orchestrator
│       │       │   ├── audio.ts        ← ElevenLabs Scribe v2 realtime client
│       │       │   ├── vision.ts       ← Gemini Flash client
│       │       │   ├── chat-twitch.ts  ← tmi.js
│       │       │   └── context.ts      ← buffer + Realtime push
│       │       ├── chain/
│       │       │   ├── viem.ts
│       │       │   ├── escrow.ts       ← AddieEscrow bindings
│       │       │   └── privy.ts
│       │       ├── ads/
│       │       │   ├── library.ts      ← lookup ads from DB
│       │       │   └── render.ts       ← assembly del placement
│       │       └── theme.ts
├── contracts/                          ← Foundry project
│   ├── src/AddieEscrow.sol
│   ├── test/AddieEscrow.t.sol
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── infra/
│   ├── docker-compose.yml
│   └── nginx-rtmp.conf
├── supabase/migrations/
│   ├── 0001_init.sql
│   ├── 0002_inventory.sql
│   ├── 0003_ads.sql
│   └── 0004_placements.sql              ← audit fields (§5)
├── scripts/
│   ├── seed-wallets.ts                 ← genera 3 smart wallets en MVP (2 brand + 1 platform)
│   ├── seed-mandates.ts                ← 2 brand mandates iniciales (adidas, mp) en MVP
│   ├── seed-inventory.ts               ← inventario del creator demo
│   ├── pregen-brand-ads.ts             ← genera 32 ads con ElevenLabs Creative
│   └── smoke-e2e.ts                    ← test integration
├── public/
└── README.md
```

---

## 10. Estrategia de ramas + asignaciones

### Ramas

```
main                         ← integraciones, mergeos en checkpoints
├── track/a-onchain          ← Dev 1
├── track/b-pipeline         ← Dev 2
├── track/c-agents           ← Dev 3
└── track/d-ui               ← Dev 4
```

**Reglas:**
- Cada dev pushea solo a su rama durante Phase 1.
- Merge a `main` en checkpoints (T+12h, T+18h).
- Cero force-pushes.

### Asignaciones

#### 🔗 Dev 1 — ON-CHAIN

**Owns:**
- `contracts/AddieEscrow.sol` + tests Foundry + deploy a Base mainnet
- Privy setup + 3 smart wallets en MVP (2 brand: adidas+mp + 1 platform owner del escrow)
- Fondear las 2 brand wallets con $5 USDC cada una
- viem clients + escrow bindings
- TxFeed component (escucha eventos `Locked` / `Released` / `Refunded`)

**Files:**
- `contracts/**`
- `apps/web/src/lib/chain/**`
- `apps/web/src/components/demo/TxFeed.tsx`
- `scripts/seed-wallets.ts`

**Skills:** Solidity básico, viem, ERC-20, Privy SDK.

#### 🎬 Dev 2 — PIPELINE

**Owns:**
- Docker nginx-rtmp localhost
- ffmpeg pipes (audio + frames)
- ElevenLabs Scribe v2 realtime WebSocket client
- Gemini Flash multimodal client
- tmi.js Twitch chat
- Context buffer + Supabase Realtime push
- Webhooks `on_publish` / `on_publish_done`
- **Audit clip compuesto** (§5): nginx-rtmp `record` con segmentos 1s en buffer circular 60s → ffmpeg `cliprange` T-10s..T+20s del stream crudo → segundo ffmpeg overlay con `ad_url` + QR en zona/timestamp del placement (mp4 final = lo que vio el viewer) → upload a Vercel Blob → escribir `clip_url` y `context_snapshot` en `placements`

**Files:**
- `infra/**`
- `apps/web/src/lib/pipeline/**`
- `apps/web/src/app/api/stream/**`

**Skills:** ffmpeg, WebSocket clients, Node child_process, Supabase Realtime.

#### 🤖 Dev 3 — AGENTS

**Owns:**
- 2 brand mandate templates en MVP (adidas, mp) en YAML, incluyendo `always_bid_floor: true` para mp (default bidder al floor, §4). Escalable a N — la arquitectura es brand-count-agnóstica.
- brand-agent runner (hunter logic — pickea ad variant + bid amount)
- streamer-agent runner (defender logic — accept/counter/reject)
- **Subasta con deadline duro (§4):** negotiation orchestrator multi-turno paralelo (3 turnos cap) + standing offers table actualizada turno a turno + **soft hold ledger off-chain** (10s expiry, expone `available_balance` corregido a cada LLM)
- **Settlement engine (§4):** al deadline T+5s, streamer-agent cierra unilateralmente la mejor standing ≥ floor a través de TODAS las zonas competidoras (single-ad-per-moment); fallback al default bidder si nadie pasa el floor; fallback al runner-up si lock on-chain falla
- Brand-safety listener (auto-pull + escrow.refund trigger)
- QR generation server-side + tracking redirect (`/api/q/[placement]`)
- **Audit metadata (§5):** persistir `agent_reasoning` (output del LLM) + `negotiation_transcript` (todos los turnos) en `placements` al settlement

**Files:**
- `apps/web/src/lib/agents/**`
- `apps/web/src/app/api/auctions/**`
- `apps/web/src/app/api/q/[placement]/route.ts`
- `scripts/seed-mandates.ts`

**Skills:** AI SDK (Vercel), Anthropic Claude, prompt engineering, async orchestration.

#### 🎨 Dev 4 — UI

**Owns:**
- Tailwind theme + design tokens
- Browser Source overlay (`/overlay/[id]`) con framer-motion
- Browser Dock (`/dock`) con balance + recent placements + FULL BREAK button (preview/approve/reject → post-MVP §14)
- Settings + Inventory editor (`/settings/inventory`)
- **Brand console** (`/brands/[brandId]`) con upload de ads + ad library viewer + **audit log panel (§5):** lista de placements con clip player (video compuesto) + viewer JSON de `agent_reasoning` + viewer del transcript de negociación + export CSV/JSON
- Demo Display (`/demo-display`) con bid leaderboard + tx feed + negotiation chat (mostrando standing offers actualizándose en vivo, §4)
- **Pre-generación de ads sábado de noche** (`scripts/pregen-brand-ads.ts`) con ElevenLabs Creative

**Files:**
- `apps/web/src/app/{overlay,dock,settings,brands,demo-display}/**`
- `apps/web/src/components/**`
- `apps/web/src/lib/ads/**`
- `apps/web/src/app/globals.css`
- `scripts/pregen-brand-ads.ts`

**Skills:** Next.js App Router, Tailwind, framer-motion, ElevenLabs Creative API, Supabase Realtime client.

---

## 11. Cronograma — 30 horas (sáb 06:00 → dom 12:00)

```
SÁBADO
─────────────────────────────────────────────────────────────────────
T+0h   06:00   Phase 0 — Setup compartido
                • Repo + Next.js scaffold
                • API keys (Anthropic, Gemini, ElevenLabs [STT + Creative + TTS], Privy, Supabase, Alchemy)
                • Supabase project + schema
                • Foundry init
                • Docker nginx-rtmp probado
                • 2 brand mandates definidos en MVP (adidas, mp)
                • Tailwind theme

T+2h   08:00   ✅ CHECKPOINT 1 — Phase 0 completa, todos arrancan tracks

T+2h-12h        Phase 1 — TRACKS PARALELOS
                Cada dev en su rama, sin tocar a otros.

T+12h  18:00   ✅ CHECKPOINT 2 — Tracks individuales done, merge a main

T+12h-18h       Phase 2 — INTEGRACIÓN
                Dev 1+3 (par): negociación → escrow.lock → render → release
                Dev 2+4 (par): pipeline → context → dock preview
                Dev 4: PRE-GEN ADS con ElevenLabs Creative (en background, ~1.5 hs)
                (cruza medianoche del sábado al domingo)

DOMINGO
T+18h  00:00   ✅ CHECKPOINT 3 — End-to-end completo, merge final

T+18h-22h       Phase 3 — POLISH + DEMO
                Scripting demo flow, hotkeys (FORCE EVENT, FULL BREAK),
                brand-safety triggers, coalición visible, cash-out con SMS,
                backup VOD pre-grabado, pitch slides, 2 ensayos completos.

T+22h  04:00   ✅ CHECKPOINT 4 — Demo grabable lista

T+22h-30h       Phase 4 — FINAL (8h, incluye buffer)
                Power nap + shower + arrive at venue + setup físico
                + test wifi + ensayo técnico final.

T+30h  12:00   DEMO LIVE 🎤
```

---

## 12. Demo choreography

> **El demo es meta-streaming.** El equipo se streamea a sí mismo durante el pitch — no hay videojuego, los speakers + dashboard son el contenido. Las trigger words ensayadas (ÉPICO/CLUTCH/TRANQUI/FOGÓN) disparan matches de las 4 brands fictional (CafetITO/TermoFlex/Pancho Rex/MateBros) durante los 90s del Bloque 3.
>
> - **Flow del pitch** (180s, 5 bloques, qué se dice y qué se muestra) → [`docs/PITCH.md`](./docs/PITCH.md).
> - **Setup físico, hardware, OBS scenes, viewer-bot, fallback plan, Q&A** → [`docs/DEMO_RUNBOOK.md`](./docs/DEMO_RUNBOOK.md).

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Wifi del venue se cae | Hotspot 4G activo. Stack 100% en localhost menos LLM/STT/TTS APIs. |
| Pre-gen de ads no termina a tiempo | CSS fallback automático para combinaciones faltantes. Demo no se rompe. |
| Negociación no cierra | Cap 3 turnos + timeout 5s + fallback a mejor offer parcial. |
| Streamer no produce momento épico | Hotkey "FORCE EVENT" en dock dispara epic_moment manual. |
| ElevenLabs Scribe WS cae | Reconnect + skip step si falla. Agents bidean solo con chat + frame. |
| Gemini Flash rate-limit | Pre-cargar quota + Claude Vision como fallback. |
| Tx on-chain se atora | Base es rápido (~2s). Si tarda >5s, mostrar "pending" y seguir. |
| Smart wallet sin gas | Pre-fondear con $0.10 ETH cada una. |
| Demo total se rompe | Backup VOD pre-grabado de un ensayo completo. Switch invisible. |

---

## 14. Post-MVP roadmap (importante pero no para el hackatón)

El MVP del demo prioriza claridad narrativa y demo robusto en 24h. Estos features quedan **diseñados** pero no implementados — son críticos para la versión post-hackatón:

| Feature | Por qué importa | Qué cambia |
|---|---|---|
| **Approve granular del creator por placement** | Algunos creators top-tier querrán control fino más allá del mandate, con veto manual antes de cada render. | OBS Browser Dock con countdown 2s + botones aprobar/rechazar antes del overlay. Refund tx automática si rechaza. Mandate-only sigue siendo el default; este es opt-in. |
| **External / self-hosted agents (BYO agent)** | Marcas grandes (Adidas global, Coca-Cola corporate) y creators top no van a confiar su mandate a un agent que corre en infra de Addie. Su equipo de marketing/legal va a querer correr el agent ellos, en su infra, con sus propios prompts y reglas. | API pública con WebSocket para que el agent externo se subscriba al context channel + endpoint para emitir standing offers + verificación on-chain del mandate firmado. Addie pasa de "operador del agent" a **infra del marketplace de agents**. Mismo patrón para streamer-agent: top creators correrán el suyo. |
| **EIP-3009 holds on-chain** | Soft holds off-chain dependen del orchestrator central. En producción multi-tenant con múltiples streamers en paralelo, el hold tiene que ser real, no centralizado. | Brand-agent firma `transferWithAuthorization` por cada standing offer (`validBefore = T+10s`). Settlement submit la auth del ganador. Auditable, descentralizable, sin trust en Addie. |
| **Brand onboarding real para humanos** | El demo tiene 8 brands pre-cargadas. Producción necesita que cualquier marca firme up, fondee USDC, suba ads, defina mandate, vea performance. | Stripe → on-ramp USDC → wizard de mandate (presets por vertical) → upload UI con preview en zonas reales → dashboard de performance. |
| **Streamer pricing dinámico** | El streamer-agent del MVP usa floor + reglas simples del mandate. En producción debería aprender qué contextos / horarios / brands rinden más y ajustar. | Pricing model entrenado sobre placements pasados (CTR, scan rate, conversion del QR) → floor adaptativo por zona/contexto/hora. |
| **Coalición de bids (varios brands chip-in)** | Si ningún brand individual paga el floor del takeover premium, varios podrían pagarlo en conjunto y aparecer como split (logo izq + logo der). | Negociación N-a-1 con división proporcional del crédito en el ad asset (ad genérico + logos overlay). |
| **Disputas / refunds disputables** | Brand reclama que el render no fue como se acordó (zona equivocada, duración corta, contexto inadecuado). Necesita recurso. | Smart contract con período de reclamo + admin/oracle para resolver. Para esto el clip de auditoría de §5 es la evidencia clave. |
| **KYC / AML para off-ramp fiat** | Cuando agreguemos off-ramp directo a peso/dólar bancario, necesitamos compliance. | Integración con un proveedor (Bitso, Buenbit) por país. |

Lo que **sí está en MVP**: audit completo (clip + reasoning + transcript) y soft holds off-chain. Ambos necesarios para defender las decisiones del agent y para que las marcas confíen el delegate desde el día 1.

---

## 15. Fuera de scope (YAGNI)

- ❌ Cero off-ramp fiat — USDC nativo, fin.
- ❌ Cero Twitch Extension oficial — solo OBS Browser Dock.
- ❌ Cero TikTok Live (API cerrada).
- ❌ Cero YouTube Live discovery.
- ❌ Cero browser extension propia.
- ❌ Cero mobile app.
- ❌ Cero brand onboarding flow real para humanos — 2 brand-agents pre-cargados (adidas + mp) con ads pre-generadas. Producción adopta el flow de §14.
- ❌ Cero KYC.
- ❌ Cero pricing dinámico complejo del streamer-agent.
- ❌ Cero disputas/refunds automatizados — manual desde admin.
- ❌ Cero analytics dashboard para brands más allá de stats simples.
- ❌ Cero internacionalización del UI.
- ❌ Cero zonas avanzadas (`top_banner`, `side_panel`, `picture_in_picture`) — solo `lower_third`, `bottom_right_corner`, `fullscreen_takeover`.
- ❌ **Cero generación runtime de creative** — todo pre-subido por la marca.
- ❌ **Cero sub-agents x402** — los servicios de QR/render son internos, no agents.

---

## 16. Pitch line

> **Las marcas suben sus ads pre-producidos a Addie. El brand-agent decide cuándo aparecer, contra qué streamer, con qué variante de su biblioteca. Negocia con el agent del creator en lenguaje natural. Cierran en USDC vía smart contract en Base. El long tail de creators monetiza atención sin contratos, sin equipos de ventas, sin esperas. Agents hablando, agents pagando, on-chain, en tiempo real.**

---

## 17. Decisiones cerradas finales

| Decisión | Resultado |
|---|---|
| Producto | **Addie** — agentic ad-tech para streams |
| Crypto | **USDC en Base + smart wallets ERC-4337** (Privy) |
| Cash-out | **USDC nativo** + off-ramp link externo (v2) |
| Streamer UI | **OBS Browser Dock universal** |
| Stream pipeline | **RTMP propio + multi-streaming a Twitch** |
| Demo | **Live real**, backup VOD en standby |
| Use case marquee | **FIFA + brand-safety pull + coalición + FULL BREAK** |
| Vertical primario | Live streams LATAM (creators independientes) |
| Pricing | **Negociación multi-turno** brand-agent vs streamer-agent |
| **Creative** | **Brands suben sus ads. Cero generación runtime. Pre-gen offline con ElevenLabs Creative para el demo.** |
| **Sub-agents** | **Cero. Solo brand-agents y streamer-agent.** |
| Voice/Visual en placement | **Bake-in en el ad subido por la marca** |
| QR | **Server-side dynamic con tracking_id por placement** |
| On-chain txs por placement | **2** (lock + release). Demo de 5 min × 6 placements = 12 txs. |
| Brand-safety | **Auto-pull con escrow.refund automático** |
| **Auction mechanics** | **Standing offers + 5s hard deadline + default bidder al floor (mp) → fill garantizado por subasta** |
| **Holds durante negociación** | **Soft hold ledger off-chain (10s expiry). Post-MVP: EIP-3009 on-chain.** |
| **Inventario** | **Single-ad-per-moment. Zonas (lower_third / corner / takeover) son FORMATOS del único slot, no slots simultáneos. Entre subastas la pantalla está limpia.** |
| **Audit por placement** | **Clip 30s + context snapshot + agent reasoning + transcript negociación, todo guardado y exportable a la marca** |
| **Approve del creator per placement** | **Post-MVP §14. MVP confía en mandate firmado + brand-safety auto-pull.** |
| **Hosting de los agents** | **MVP: agents corren en infra de Addie (3 agents en MVP — manager + adidas + mp + streamer = 4 procesos). Post-MVP §14: marcas/streamers pueden traer su propio agent (BYO).** |
| **MVP brand scope** | **2 brand-agents (adidas premium + mp default bidder). Arquitectura es brand-count-agnóstica — agregar más brands = más rows en `mandates`, sin cambios de código. Post-MVP escala a N.** |
| **Brand prompting en DB** | **Columna dedicada `mandates.prompt jsonb` (separada de `mandates.payload`). Shape: `{ system_persona, voice_examples[], dont_say[], dont_do[] }`. Owned por marketing/creative team de la marca, no por legal/finance que owna `payload`. Migration `0005_mandates_prompt.sql`.** |

---

## Referencias

- Plan de implementación detallado: [`docs/superpowers/plans/2026-05-09-atrio-implementation.md`](../plans/2026-05-09-atrio-implementation.md) (renombrar a `addie` cuando se mueva al repo nuevo)
- Spec previa con sub-agents x402 (descartada): [`docs/superpowers/specs/2026-05-09-atrio-design.md`](./2026-05-09-atrio-design.md)
- Spec original (AgentVille, descartada): [`docs/superpowers/specs/2026-05-08-agentville-design.md`](./2026-05-08-agentville-design.md)

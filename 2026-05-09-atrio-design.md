# Atrio — Diseño Final + Plan de Coordinación

**Fecha:** 2026-05-09
**Hackatón:** Platanus Hack BSAS · track *agent money*
**Demo:** domingo 2026-05-10
**Equipo:** 4 ingenieros · ~24 hs efectivas

---

## TL;DR

Dos agents AI negocian en tiempo real durante un stream en vivo. Los **brand-agents son cazadores** que subscriben al contexto y deciden cuándo engageearse. El **streamer-agent es defensor** reactivo que filtra contra el mandate firmado del creator. Cuando cierran deal — en una ronda directa o tras 2-3 turnos de negociación — una cadena de pagos USDC on-chain dispara el ensamblado del placement publicitario combinando los **assets que la marca subió en su brand kit** (audio + visual) con un QR único trackeable. El placement renderiza sobre el stream vía OBS Browser Source. El creator cobra USDC al instante en su smart wallet. Todo verificable en basescan.

---

## 1. Conceptos clave (los 5 que importan)

1. **Brand-agents son cazadores activos.** Subscriben a múltiples streams, evalúan contexto en vivo, deciden cuándo engageearse. No esperan que les pidan; van a buscar momentos.
2. **Streamer-agent es defensor reactivo.** Recibe ofertas, filtra contra mandate firmado, negocia o rechaza, cierra deals. El creator define el inventario una vez y el agent lo enforces.
3. **Negociación en lenguaje natural con red de seguridad.** El initial offer del hunter funciona como sealed bid (round 1). Si el streamer-agent acepta directo, cierra en 1 paso. Si countereja, entra round 2 multi-turn. Si round 2 no converge en 3 turnos, fallback al initial bid más alto. **Nunca se queda sin placement.**
4. **Generación de placement on-chain.** Cuando cierra el deal, escrow lock USDC + 3 sub-agents (voice, visual, qr) ejecutan ensamblado vía x402. Cada paso es tx en Base.
5. **Brand kit subido por la marca, ensamblado on-demand.** En el MVP cada marca sube su audio (MP3) y su visual (imagen o video corto) por moment_type cuando crea su mandate. Los sub-agents son **lookup, no generación** — sirven el asset correcto desde storage. Cero generación de audio/video runtime ni offline.

---

## 2. Arquitectura general — 5 capas

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 1 · INGEST                                                    │
│  ───────────────────────────────────────────────────────────        │
│  OBS del creator ──RTMP──► nginx-rtmp localhost (1s latency)        │
│                  ──RTMP──► Twitch ingest (público)                  │
│                  ──RTMP──► Kick ingest (opcional)                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 2 · CONTEXT EXTRACTION                                        │
│  ───────────────────────────────────────────────────────────        │
│  ffmpeg pipe                                                        │
│    ├─ audio @16kHz ──► Deepgram Nova ──► transcript rolling 30s     │
│    └─ frames @1fps ──► Gemini 2.5 Flash ──► frame summary + tags    │
│  tmi.js IRC ──► Twitch chat velocity + recent keywords + sentiment  │
│  Pusher WS ──► Kick chat (opcional)                                 │
│                              │                                      │
│                              ▼                                      │
│  Context Buffer (Supabase Realtime channel `stream:<id>:context`)   │
│  { audio_30s, frame, chat_velocity, viewers, sentiment, ts }        │
│  broadcast cada 1s                                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (broadcast)
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 3 · NEGOCIACIÓN AGENTIC                                       │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│  8 BRAND-AGENTS HUNTERS (cada uno en su edge function)              │
│   ├─ adidas, nike, quilmes, mp, steam, rappi, globant, cocacola     │
│   ├─ subscriben al context channel                                  │
│   ├─ evalúan contra mandate (LLM Claude 4.6) → decisión HUNT/SKIP   │
│   └─ los que HUNT mandan initial offer firmado (sealed bid)         │
│                                                                     │
│  STREAMER-AGENT (defensor reactivo)                                 │
│   ├─ tiene mandate firmado del creator (inventory + prefs)          │
│   ├─ recibe N initial offers en paralelo                            │
│   └─ por cada uno decide:                                           │
│      • ACCEPT → cierra round 1 directo                              │
│      • COUNTER → abre round 2 multi-turn (3 turnos máx)             │
│      • REJECT → descarta el canal                                   │
│                                                                     │
│   ┌──────────────────────────────────────────────────────┐          │
│   │  Round 2 — Negotiation (multi-turn)                  │          │
│   │  brand → streamer → brand → close OR walk-away       │          │
│   │  cap: 3 turnos · timeout: 4s por canal               │          │
│   └──────────────────────────────────────────────────────┘          │
│                                                                     │
│  RESOLUCIÓN: gana el agreed más alto entre los canales que cerraron.│
│  Si ninguno cerró agreed → fallback al initial offer más alto       │
│  (marcado como timeout-fallback). Demo nunca se queda sin placement.│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ ("adidas ganó $2.20 / lower_third / 6s")
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 4 · PLACEMENT ASSEMBLY VIA x402 (paralelo)                    │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│  brand-agent (adidas) ejecuta 4 acciones on-chain en paralelo:      │
│                                                                     │
│   1. AtrioEscrow.lock(placementId, coscu_addr, 2.20 USDC)           │
│      ⚡ tx_hash 0xAAA en basescan                                   │
│                                                                     │
│   2. POST /agents/voice/run { brand_id, moment_type }               │
│      ← 402 Payment Required (quote 0.012 USDC)                      │
│      → X-Payment header (EIP-3009 sig)                              │
│      ← 200 + audio_url (MP3 que adidas subió en su brand kit)       │
│      ⚡ tx 0xBBB                                                    │
│                                                                     │
│   3. POST /agents/visual/run { brand_id, moment_type, zone }        │
│      ← 402 Payment Required (quote 0.05 USDC)                       │
│      → X-Payment header                                             │
│      ← 200 + visual_url (asset que adidas subió en su brand kit)    │
│      ⚡ tx 0xCCC                                                    │
│                                                                     │
│   4. POST /agents/qr/run { tracking_url, brand_kit }                │
│      ← 402 Payment Required (quote 0.002 USDC)                      │
│      → X-Payment header                                             │
│      ← 200 + QR PNG con tracking_id único (este sí se genera)       │
│      ⚡ tx 0xDDD                                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 5 · APPROVE + RENDER + RELEASE                                │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│  Plataforma arma placement assembly:                                │
│    { audio_url, visual_url, qr_url, overlay_text, duration }        │
│                                                                     │
│  ───► Push al OBS Browser Dock del creator                          │
│       (preview con countdown 2s, botones Aprobar/Rechazar/Skip)     │
│                              │                                      │
│                              ▼                                      │
│       Si aprueba → push al Browser Source overlay                   │
│       Si rechaza → AtrioEscrow.refund(placementId) ⚡ tx 0xEEE      │
│                              │                                      │
│                              ▼                                      │
│  ───► Browser Source renderiza sobre el stream:                     │
│         <video> o <img> con asset de la marca                       │
│         <audio> con jingle/voz de la marca                          │
│         <img> QR esquina derecha                                    │
│         framer-motion fade-in                                       │
│                                                                     │
│       Twitch viewers + jueces ven el placement durante 6s           │
│                              │                                      │
│                              ▼ (placement termina)                  │
│  ───► AtrioEscrow.release(placementId)                              │
│       2.20 USDC encerrados → coscu wallet                           │
│       ⚡ tx_hash 0xFFF en basescan                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Latencia end-to-end realista:** ~7-8 segundos del momento épico al placement on-screen, +2s del preview humano.

---

## 3. Diagrama de flujo — vida de un placement (timeline realista)

```
─────────────────────────────────────────────────────────────────────
T+0.0s    Coscu mete gol en FIFA, grita "¡GOLAZO!"
─────────────────────────────────────────────────────────────────────
T+0.5s    OBS encode → RTMP packet llega a nginx-rtmp localhost
T+0.7s    ffmpeg pipe extrae audio + frame
─────────────────────────────────────────────────────────────────────
T+1.2s    Deepgram transcribe "GOLAZO"
T+1.3s    Gemini Flash describe frame: "FIFA replay celebration"
T+1.5s    tmi.js detecta chat velocity 12→180 msg/s
T+1.5s    context buffer broadcast a brand-agents subscritos
─────────────────────────────────────────────────────────────────────
T+2.0s    LLM call paralela en 8 brand-agents (~500ms cada una)
          → adidas: HUNT (FIFA epic, audience LATAM, budget OK)
          → nike: HUNT
          → quilmes: HUNT (contextual social moment)
          → rappi: SKIP (no es contexto food)
          → mp: HUNT weak
          → steam: SKIP (no gaming relevant)
          → globant: SKIP (audience no es devs)
          → cocacola: HUNT
─────────────────────────────────────────────────────────────────────
T+2.5s    5 brand-agents mandan initial offers (sealed bids round 1):
            adidas:   $2.00 / lower_third / 6s
            nike:     $1.50 / lower_third / 5s
            quilmes:  $1.20 / lower_third / 8s
            mp:       $0.30 / corner / 30s
            cocacola: $1.80 / lower_third / 4s
─────────────────────────────────────────────────────────────────────
T+2.7s    Streamer-agent recibe 5 ofertas. Decide por cada una en paralelo:
            adidas:   COUNTER (pide $2.40 por contexto premium)
            nike:     ACCEPT directo ($1.50 ok)              → CLOSED round 1
            quilmes:  COUNTER (pide $1.50)
            mp:       ACCEPT directo ($0.30 corner)          → CLOSED round 1
            cocacola: COUNTER (pide $2.20)
─────────────────────────────────────────────────────────────────────
T+3.0s -  Round 2 multi-turn corre en paralelo para los 3 que counterearon.
T+5.5s    Cada canal tiene cap 3 turnos × ~600-800ms con jitter LLM:
            adidas:   brand sube a $2.20 → streamer accept   → CLOSED $2.20
            quilmes:  brand walk-away en $1.30              → CLOSED no-deal
            cocacola: timeout sin convergencia              → fallback $1.80
─────────────────────────────────────────────────────────────────────
T+5.7s    Subasta resuelve. Candidatos cerrados:
            adidas $2.20 (round 2 agreed)
            nike $1.50 (round 1 accept)
            mp $0.30 (round 1 accept)
            cocacola $1.80 (timeout-fallback)
          Streamer-agent compara por USD/sec en zona premium + brand fit:
          GANA ADIDAS $2.20.
─────────────────────────────────────────────────────────────────────
T+6.0s    adidas-agent ejecuta 4 acciones on-chain en PARALELO:
          ⚡ escrow.lock(2.20 USDC)               [tx 0xAAA]
          ⚡ x402 voice-agent (0.012 USDC)         [tx 0xBBB]  ← lookup MP3 de adidas
          ⚡ x402 visual-agent (0.05 USDC)         [tx 0xCCC]  ← lookup video/img de adidas
          ⚡ x402 qr-agent (0.002 USDC)            [tx 0xDDD]  ← genera QR único
─────────────────────────────────────────────────────────────────────
T+7.0s    Plataforma arma placement assembly
T+7.0s    Push preview al OBS Browser Dock
T+7.0s-9.0s   Coscu ve preview, tiene 2s para aprobar
─────────────────────────────────────────────────────────────────────
T+9.0s    Approved → push al Browser Source overlay
T+9.05s   Overlay renderiza sobre stream:
          • <video> o <img> con asset de adidas (subido en su brand kit)
          • <audio> con jingle de adidas (subido en su brand kit)
          • <img> QR único trackeable
          • framer-motion fade-in
─────────────────────────────────────────────────────────────────────
T+15.0s   Placement termina (duración 6s)
T+15.1s   AtrioEscrow.release(placementId) ⚡ [tx 0xFFF]
          → 2.20 USDC va al wallet de Coscu
─────────────────────────────────────────────────────────────────────

5 transacciones on-chain visibles en basescan por placement.
End-to-end: ~7s del gol al render + 6s placement = ~13s desde el momento al cierre con USDC.
```

---

## 4. Sub-agents detallados (la cadena x402)

### 🎙 voice-agent

**Responsabilidad:** servir el audio que la marca subió en su brand kit, correspondiente al moment_type.

**Tech:** lookup contra Supabase Storage / Vercel Blob. **Cero generación.**

**Input:**
```json
{ "brand_id": "adidas", "moment_type": "epic_goal" }
```

**Output:**
```json
{ "audio_url": "https://atrio.app/kits/adidas/epic_goal.mp3",
  "duration_ms": 6000 }
```

**Latency:** ~50ms (lookup).

**Pricing:** 0.012 USDC por placement (cubre storage + CDN + margen).

**Por qué es agent separado:** mañana puede haber un voice-agent que **sí genere runtime** con TTS (ElevenLabs Flash, Cartesia, OpenAI). Las marcas eligen calidad/precio. Mercado abierto. En el MVP del hackatón es lookup puro.

---

### 🎨 visual-agent

**Responsabilidad:** servir el asset visual (imagen o video corto) que la marca subió en su brand kit, correspondiente al moment_type y zona.

**Tech:** lookup contra Supabase Storage / Vercel Blob. **Cero generación.**

**Input:**
```json
{ "brand_id": "adidas", "moment_type": "epic_goal", "zone": "lower_third" }
```

**Output:**
```json
{ "visual_url": "https://atrio.app/kits/adidas/epic_goal_lower_third.mp4",
  "media_type": "video/mp4",
  "duration_ms": 6000,
  "loop": true,
  "overlay_text_zones": [{ "x": 1280, "y": 50, "width": 600 }] }
```

**Latency:** ~50ms.

**Pricing:** 0.05 USDC por placement.

**Por qué es agent separado:** mañana puede haber un visual-agent que **genere imágenes runtime con AI** (Flux Schnell ~1s) o use video gen real-time. El brand-agent elige cuál usar. En el MVP es lookup puro.

**Estrategia de brand kits para el demo (CRÍTICA, ver §5):**
- 8 brands × 4 moment_types × 2 zones = **64 assets de marca** subidos por nosotros pre-demo.
- Sourced de material público (logos reales, clips de spots reales, imágenes hero de producto). No hay generación, solo curación/edición ligera.
- Hosted en Supabase Storage o Vercel Blob.

---

### 🖨 qr-agent

**Responsabilidad:** generar QR code branded único + tracking URL. **Este sí genera** (es trivial server-side).

**Tech:** lib `qrcode` server-side + redirect server con DB.

**Input:**
```json
{ "url": "https://adidas.com.ar/predator",
  "brand_kit": { "colors": { "primary": "#000", "accent": "#E32B2B" } },
  "placement_id": "0xabc123..." }
```

**Output:**
```json
{ "qr_data_url": "data:image/png;base64,iVBORw0KGgo...",
  "tracking_url": "https://atrio.app/q/abc123?placement_id=...&campaign=..." }
```

**Latency:** ~50ms.

**Pricing:** 0.002 USDC por placement.

**Por qué es agent separado:** tracking de conversiones es la métrica que justifica que las marcas paguen premium. QR único = analytics granular. Mañana puede haber qr-agent con deep links + AR triggers.

---

## 5. Brand kits (assets que las marcas suben)

### Modelo

En producción, cuando una marca crea su mandate, sube:
- **Audio (MP3 o WAV)** por moment_type. Su jingle, voice-over, o clip de spot.
- **Visual (PNG, GIF, MP4)** por moment_type × zona. Su logo, hero image, video corto.
- **Logo + colores + tagline** estructurados (parte del mandate YAML).

Los sub-agents `voice-agent` y `visual-agent` hacen lookup de estos assets en runtime y los sirven vía x402.

**Cero generación de audio/video.** Si el día de mañana queremos generar, se agrega como sub-agent diferente (los brand-agents eligen cuál llamar). No es scope del MVP.

### Para el hackatón: curación de 8 brand kits mock

Dev 4 (o quien tenga menos carga) prepara los brand kits durante el sábado. Es **curación, no generación**:

| Asset | Fuente para el demo |
|---|---|
| Logos de marca | Sitios oficiales / Wikipedia (logos públicos) |
| Audios | Clips de spots reales de YouTube (cortados a 4-6s) o grabados rápido por el equipo |
| Visuales (lower_third) | Composición simple en Figma o Canva: logo + tagline + producto sobre fondo branded, exportado como MP4 corto loop |
| Visuales (corner) | Logo PNG con fondo transparente |

**Volumen mínimo viable para el demo:** 4 brands completas (adidas, nike, quilmes, cocacola) × 2 moment_types (epic_goal, calm_chat) × 2 zonas = **16 assets bien hechos**. Suficiente para los actos del demo.

**Fallback CSS-only:** si un brand_id × moment_type no tiene asset cargado, el visual-agent devuelve un asset CSS-rendered (banda con logo + tagline + colores). Demo nunca se queda sin placement.

### Cronograma de curación

- **Sábado 18:00 → 22:00:** Dev 4 arma los 16 assets prioritarios mientras los otros tres devs avanzan en sus tracks.
- Storage: Supabase Storage bucket `brand-kits/{brand_id}/{moment_type}_{zone}.{ext}`.
- Output: `assets-manifest.json` con `{brand_id, moment_type, zone, url, duration_ms}` por entry.

---

## 6. Stack tecnológico

| Pieza | Tech | Por qué |
|---|---|---|
| Framework web | **Next.js 16** App Router | RSC, edge functions, viable en Vercel free |
| Auth + DB | **Supabase** (Postgres + Realtime + Auth + Storage) | Realtime channels para context buffer + Postgres para metadata + Storage para brand kits |
| Smart wallets | **Privy** (ERC-4337 embedded) | Email login sin seed phrase. Server wallets para brand-agents. |
| Blockchain | **Base mainnet** | Gas barato (~$0.001/tx), USDC nativo, EVM estándar |
| Stablecoin | **USDC** (`0x833589fCD6...`) | Liquidez, integración trivial con viem |
| Smart contract | **AtrioEscrow.sol** (Foundry) | ~80 líneas: lock/release/refund |
| Web3 client | **viem** | Type-safe Ethereum interactions |
| x402 protocol | EIP-3009 `transferWithAuthorization` over HTTP | Pago en mismo request, no necesita 2 txs separadas |
| Stream ingest | **nginx-rtmp** Docker | Latencia <1s, control total |
| Multi-streaming | OBS plugin "Multiple RTMP Outputs" | Stream simultáneo a Twitch + Kick + nuestro RTMP |
| Audio STT | **Deepgram Nova streaming** | <500ms partial transcripts, $0.0043/min |
| Vision tagging | **Gemini 2.5 Flash multimodal** | Más rápido para visión, free tier 1M tokens/día |
| Brand-agent + streamer-agent LLM | **Anthropic Claude 4.6 Sonnet** via Vercel AI Gateway | Mejor calidad para razonamiento de negociación |
| Voice playback | `<audio>` HTML5 + asset de Supabase Storage | Cero generación, lookup puro |
| Visual playback | `<video>` / `<img>` HTML5 + asset de Supabase Storage | Cero generación, lookup puro |
| QR generation | `qrcode` npm | Server-side, customizable colors |
| Twitch chat | **tmi.js** | IRC anonymous read, cero auth, real-time |
| Kick chat | `@nekiro/kick-api` (Pusher WS) | Para paridad multi-platform |
| Frontend | **Next.js + Tailwind + framer-motion** | OBS Browser Source + Browser Dock |

**Removido del stack:** ElevenLabs (cualquier producto), runtime audio gen, runtime video gen, offline video gen. **Las marcas suben sus assets, fin.**

---

## 7. Estructura del proyecto

```
atrio/                                  ← repo nuevo standalone
├── apps/
│   └── web/                            ← Next.js app principal
│       ├── src/
│       │   ├── app/
│       │   │   ├── overlay/[id]/       ← Browser Source overlay
│       │   │   ├── dock/               ← OBS Browser Dock UI
│       │   │   ├── settings/
│       │   │   │   ├── inventory/      ← Inventory editor
│       │   │   │   └── preferences/    ← Brands aprobadas, keywords
│       │   │   ├── demo-display/       ← Pantalla principal del demo (jueces)
│       │   │   └── api/
│       │   │       ├── stream/         ← webhooks nginx-rtmp
│       │   │       ├── auctions/       ← endpoint negotiation
│       │   │       ├── placements/     ← decide approve/reject
│       │   │       ├── agents/
│       │   │       │   ├── voice/      ← x402 voice-agent (lookup)
│       │   │       │   ├── visual/     ← x402 visual-agent (lookup)
│       │   │       │   └── qr/         ← x402 qr-agent (genera)
│       │   │       └── streamers/      ← inventory CRUD, full-break, force-event
│       │   ├── components/
│       │   │   ├── overlay/            ← PlacementRenderer, zonas
│       │   │   ├── dock/               ← Incoming, Balance, FullBreak
│       │   │   ├── settings/           ← InventoryEditor
│       │   │   └── demo/               ← BidLeaderboard, NegotiationChat, TxFeed
│       │   └── lib/
│       │       ├── agents/
│       │       │   ├── brand/          ← brand-agent runner (hunter)
│       │       │   ├── streamer/       ← streamer-agent runner (defender)
│       │       │   ├── negotiation/    ← multi-turn orchestrator
│       │       │   ├── safety/         ← brand-safety auto-pull
│       │       │   ├── brands/         ← 8 brand mandates starter
│       │       │   └── types.ts        ← Mandate, BrandKit, BidContract
│       │       ├── pipeline/
│       │       │   ├── rtmp.ts         ← orchestrator
│       │       │   ├── audio.ts        ← Deepgram
│       │       │   ├── vision.ts       ← Gemini Flash
│       │       │   ├── chat-twitch.ts  ← tmi.js
│       │       │   └── context.ts      ← buffer aggregator
│       │       ├── x402/
│       │       │   ├── eip3009.ts      ← sign/verify
│       │       │   ├── server.ts       ← 402 middleware
│       │       │   └── client.ts       ← caller helper
│       │       ├── chain/
│       │       │   ├── viem.ts         ← public/wallet clients
│       │       │   ├── escrow.ts       ← AtrioEscrow bindings
│       │       │   └── privy.ts        ← embedded wallets helper
│       │       ├── kits/
│       │       │   ├── manifest.ts     ← lookup brand kits
│       │       │   └── fallback.ts     ← CSS-only render si no hay asset
│       │       └── theme.ts            ← design tokens
│       └── package.json
│
├── contracts/                          ← Foundry project
│   ├── src/AtrioEscrow.sol
│   ├── test/AtrioEscrow.t.sol
│   ├── script/Deploy.s.sol
│   └── foundry.toml
│
├── infra/                              ← Docker + RTMP (Laptop B + Cloudflare Tunnel)
│   ├── docker-compose.yml
│   ├── nginx-rtmp.conf
│   └── cloudflared.yml
│
├── supabase/migrations/                ← schema versioning
│   ├── 0001_init.sql
│   └── 0002_inventory.sql
│
├── scripts/
│   ├── seed-wallets.ts                 ← genera 11 smart wallets demo
│   ├── seed-inventory.ts               ← inventario del creator demo
│   ├── seed-mandates.ts                ← 8 brand mandates
│   ├── seed-brand-kits.ts              ← sube 16-32 assets mock a Supabase Storage
│   └── smoke-e2e.ts                    ← test integration completo
│
├── public/
│
├── .env.example
└── README.md
```

---

## 8. Estrategia de ramas y asignaciones

### Ramas

```
main                         ← integraciones, mergeos en checkpoints
├── track/a-onchain          ← Dev 1 (ON-CHAIN)
├── track/b-pipeline         ← Dev 2 (PIPELINE)
├── track/c-agents           ← Dev 3 (AGENTS)
└── track/d-ui               ← Dev 4 (UI)
```

**Rules:**
- Cada dev pushea solo a su rama durante Phase 1.
- Merge a `main` en checkpoints (T+12h, T+18h).
- Conflict resolution: el dev que mergea último resuelve.
- **Cero force-pushes.** Si algo se rompe, nuevo commit que arregla.

### Asignaciones detalladas

#### 🔗 Dev 1 — Track A — ON-CHAIN

**Owns:**
- Foundry project + AtrioEscrow.sol + tests + deploy a Base mainnet
- Privy setup + 11 smart wallets generadas (8 brand + 3 sub-agent)
- Fondear las 8 brand wallets con $5 USDC cada una (~$40 total recuperable)
- viem client + escrow bindings
- Tx feed component que escucha `Locked` / `Released` / `Refunded` events
- Integración con cadena x402 (EIP-3009 verify)

**Files que toca:**
- `contracts/**`
- `apps/web/src/lib/chain/**`
- `apps/web/src/lib/x402/eip3009.ts`
- `apps/web/src/components/demo/TxFeed.tsx`
- `scripts/seed-wallets.ts`

**Skills requeridas:** Solidity básico, viem, ERC-20, ERC-4337 con Privy.

#### 🎬 Dev 2 — Track B — PIPELINE + INFRA DEPLOY

**Owns:**
- Docker nginx-rtmp localhost (Laptop B)
- ffmpeg pipes (audio + frames)
- Deepgram WebSocket client
- Gemini Flash multimodal client
- tmi.js Twitch chat reader
- Context buffer (aggregator + Realtime push)
- Webhooks `on_publish` / `on_publish_done`
- (Opcional) Kick chat con Pusher
- **Cloudflare Tunnel setup en Laptop B → URL HTTPS pública para que Vercel + sub-agents alcancen el RTMP/orchestrator hook**
- (Stretch H 18-20) mover el `docker-compose` a Fly.io para eliminar la laptop del setup

**Files que toca:**
- `infra/**`
- `apps/web/src/lib/pipeline/**`
- `apps/web/src/app/api/stream/**`
- `scripts/smoke-pipeline.ts`

**Skills requeridas:** ffmpeg, WebSocket clients, Node child_process, Supabase Realtime, Docker, Cloudflare Tunnel.

#### 🤖 Dev 3 — Track C — AGENTS

**Owns:**
- 8 brand mandate templates (YAML)
- brand-agent runner (hunter logic, evaluación contra context)
- streamer-agent runner (defender logic, decisión accept/counter/reject por initial offer)
- negotiation orchestrator (round 1 sealed-bid, round 2 multi-turn paralelo, fallback a highest sealed bid)
- subasta engine (compara closed deals)
- Sub-agents endpoints: voice (lookup), visual (lookup), qr (gen)
- x402 server middleware (verify EIP-3009, ejecutar tx)
- x402 client helper (firma + retry con X-Payment)
- Brand-safety listener (auto-pull + refund trigger)

**Files que toca:**
- `apps/web/src/lib/agents/**`
- `apps/web/src/lib/x402/server.ts`
- `apps/web/src/lib/x402/client.ts`
- `apps/web/src/app/api/agents/**`
- `apps/web/src/app/api/auctions/**`
- `scripts/seed-mandates.ts`

**Skills requeridas:** AI SDK (Vercel), Anthropic Claude, prompt engineering, async orchestration, qrcode lib.

#### 🎨 Dev 4 — Track D — UI + BRAND KITS

**Owns:**
- Tailwind theme + design tokens
- Browser Source overlay (`/overlay/[id]`) con animaciones framer-motion
- Browser Dock (`/dock`) con preview + approve/reject + balance
- Settings + Inventory editor (`/settings/inventory`)
- Demo Display (`/demo-display`) con leaderboard + tx feed + chat de negociación
- FullBreakButton + force-event hotkey
- **Curación de los 16-32 brand kits mock (sábado tarde, antes que los otros tracks lo necesiten)**
- assets-manifest.json + cache lookup logic + CSS fallback

**Files que toca:**
- `apps/web/src/app/{overlay,dock,settings,demo-display}/**`
- `apps/web/src/components/**`
- `apps/web/src/lib/kits/**`
- `apps/web/src/app/globals.css`
- `scripts/seed-brand-kits.ts`

**Skills requeridas:** Next.js App Router, Tailwind, framer-motion, Supabase Realtime client, Figma/Canva para los assets mock.

---

## 9. Cronograma 24 horas

```
SÁBADO
─────────────────────────────────────────────────────────────────────
T+0h   16:00   Setup compartido (Phase 0):
                • Crear repo + Next.js scaffold
                • API keys de todos los providers
                • Supabase project + schema inicial + Storage bucket
                • Foundry init
                • Docker nginx-rtmp probado
                • Cloudflare Tunnel probado en Laptop B
                • 8 brand mandates definidos
                • Tailwind theme

T+2h   18:00   ✅ CHECKPOINT 1 — Phase 0 completa, todos arrancan tracks

T+2h-12h        Phase 1 — TRACKS PARALELOS
─────────────────────────────────────────────────────────────────────
                Dev 1 (ON-CHAIN):
                  • AtrioEscrow.sol + 6 tests Foundry
                  • Deploy a Base mainnet
                  • Privy provider + 11 wallets
                  • Fondear 8 brand wallets
                  • viem + escrow bindings
                  • TxFeed component

                Dev 2 (PIPELINE):
                  • nginx-rtmp Docker + Cloudflare Tunnel funcionando
                  • ffmpeg pipes (audio + frames)
                  • Deepgram WS client
                  • Gemini Flash client
                  • tmi.js + chat velocity
                  • Context buffer
                  • on_publish webhooks

                Dev 3 (AGENTS):
                  • 8 brand mandates
                  • brand-agent runner (hunter)
                  • streamer-agent runner (defender)
                  • negotiation engine round 1 + round 2 + fallback
                  • Sub-agents: voice, visual, qr
                  • x402 server + client
                  • Brand-safety listener

                Dev 4 (UI + KITS):
                  • Curar 16 brand kits prioritarios (T+2h-6h)
                  • Browser Source overlay + zonas
                  • Browser Dock (preview/approve)
                  • Settings + Inventory editor
                  • Demo Display
                  • FullBreakButton + force-event
─────────────────────────────────────────────────────────────────────
T+12h  04:00   ✅ CHECKPOINT 2 — Tracks individuales done, merge a main

T+12h-18h       Phase 2 — INTEGRACIÓN
─────────────────────────────────────────────────────────────────────
                Dev 1+3 (par): negociación → escrow.lock → cadena x402
                Dev 2+4 (par): pipeline → context buffer → dock preview
                Todos: end-to-end smoke test con 1 streamer + 1 brand
                Dev 4: completar 16 brand kits restantes a 32 si hay tiempo
─────────────────────────────────────────────────────────────────────
T+18h  10:00   ✅ CHECKPOINT 3 — End-to-end completo, merge final

DOMINGO
T+18h-22h       Phase 3 — POLISH + DEMO
─────────────────────────────────────────────────────────────────────
                Todos: scripting demo flow, hotkeys, brand-safety triggers,
                       coalición visible, FULL BREAK premium auction,
                       cash-out con basescan, backup VOD pre-grabado,
                       pitch slides (3 max), 2 ensayos completos.
                Stretch (Dev 2): migrar Docker compose de Laptop B a Fly.io
─────────────────────────────────────────────────────────────────────
T+22h  14:00   ✅ CHECKPOINT 4 — Demo grabable lista

T+22h-24h       Phase 4 — FINAL
─────────────────────────────────────────────────────────────────────
                Sleep + shower + arrive at venue + ensayo técnico final.
─────────────────────────────────────────────────────────────────────
T+24h  16:00   DEMO LIVE 🎤
```

---

## 10. Demo choreography (5-7 minutos)

### Setup físico

- **Laptop A — streamer** — uno del equipo, OBS abierto, juego corriendo, micro y cámara, segunda pantalla con OBS Dock visible. Browser Source y Browser Dock apuntando a URLs de Vercel.
- **Laptop B — ingest worker** — Docker compose con nginx-rtmp + ffmpeg pipes + chat ingest, expuesto a internet vía **Cloudflare Tunnel** (HTTPS automático, sin abrir puertos del venue). OBS de Laptop A pushea RTMP a la IP local de Laptop B sobre el hotspot del equipo.
- **Laptop presenter** — controla pantalla principal proyectada con la vista `/demo-display` (Vercel).
- **Hotspot 4G** del cel del jefe como red dedicada del equipo (NO el WiFi del venue).
- **Backup VOD** pre-grabado en standby por si todo se rompe.

### Deployment al momento del demo

- Smart contract: Base mainnet (link basescan disponible)
- Web app + sub-agents + orchestrator: Vercel (`atrio.app` o `*.vercel.app`)
- DB + Storage + Realtime: Supabase managed
- Smart wallets: Privy embedded
- Ingest pipeline: Laptop B (Cloudflare Tunnel) — única pieza local, plomería de baja latencia
- Si stretch alcanzó: ingest pipeline en Fly.io

### Acto 1 (45s) — Setup narrativo

> *"Esto es Atrio. 8 brand-agents corriendo, cada uno con wallet USDC propia y mandate firmado. Coscu — uno del equipo — está streameando FIFA en vivo a Twitch desde su OBS. Cuando aparezca un momento, los brand-agents lo van a cazar y el streamer-agent lo va a defender. Vamos a leer la negociación en tiempo real arriba a la derecha."*

### Acto 2 (90s) — Primer momento épico + negociación visible

Streamer mete gol → pipeline detecta → brand-agents inician sealed bids → streamer-agent decide accept/counter/reject → demo display muestra columnas de chat → adidas gana en round 2 → cadena x402 visible (4 txs en feed) → preview en dock → approve → render con asset de adidas (audio + visual subidos en su brand kit) + QR único.

### Acto 3 (30s) — Brand safety pull

Streamer dice palabra prohibida → fade out automático en 200ms → escrow.refund visible en feed → marcas demuestran protección on-chain.

### Acto 4 (90s) — FULL BREAK premium

Streamer aprieta botón "FULL BREAK NOW" → subasta especial fullscreen_takeover → Coca-Cola gana $5.20 → 30 segundos de takeover con video premium (asset que Coca-Cola subió) + audio + QR.

### Acto 5 (45s) — Cash-out

Stream cierra con balance acumulado en wallet de Coscu → presenter abre basescan → muestra historial completo de las 5+ txs por placement → "todo verificable, todo on-chain, todo en los últimos 5 minutos. USDC ya está en el wallet de Coscu, sin esperar payout, sin Stripe, sin contratos".

### Acto 6 (Q&A devs, opcional 30s)

Pantalla técnica con `curl` mostrando flow `402 → X-Payment → 200`.

---

## 11. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Wifi del venue se cae | Alta | Hotspot 4G dedicado del equipo. Stack 100% en localhost menos LLM/STT APIs. |
| Brand kits no se ven profesionales | Media | Logos reales + composición simple en Figma. Si un asset queda flojo, fallback CSS-only (logo + tagline + colores en banda). |
| Negociación no cierra (los agents no convergen en round 2) | Media | **Fallback automático al initial offer más alto del round 1** (sealed bid). Demo nunca se queda sin placement. |
| LLM produce JSON malformado en negociación | Media | Structured output (function calling) + Zod validation + reintento 1x con temperature=0. Si falla 2x → fallback sealed bid. |
| Round 2 toma >5s | Media | Hard timeout server-side por canal. Cualquier turno >1.5s aborta. Fallback sealed bid. |
| Streamer no produce momento épico real | Media | Hotkey "FORCE EVENT" en dock dispara epic_moment manual. |
| Deepgram WebSocket cae | Baja | Reconnect + skip step si falla (agents bidean solo con chat + frame). |
| Gemini Flash rate-limit | Baja | Pre-cargar quota + Claude Vision como fallback. |
| Cloudflare Tunnel inestable | Baja | Restart automático. Fallback: Laptop B expone IP del hotspot vía port forwarding manual. |
| Tx on-chain se atora | Muy baja | Base es rápido (~2s). Si tarda >5s, mostrar "pending" y seguir. |
| Smart wallet de un agent sin gas | Baja | Pre-fondear con $0.10 ETH cada una. |
| Demo total se rompe | Muy baja | Backup VOD pre-grabado con un ensayo completo. Switch invisible. |

---

## 12. Fuera de scope (YAGNI explícito)

- ❌ **Cero off-ramp fiat. Cero MP, cero Stripe, cero SMS de cobro.** USDC nativo en Base, fin. Acreditación instantánea por micropayments — el creator ve su balance subir en su wallet en tiempo real, basta. Off-ramp Lemon/Belo es link externo (v2).
- ❌ **Cero generación de audio/video** runtime ni offline. Las marcas suben sus assets en su brand kit, fin.
- ❌ Cero Twitch Extension oficial — solo OBS Browser Dock. Twitch Extension queda v2.
- ❌ Cero TikTok Live (API cerrada).
- ❌ Cero YouTube Live discovery (quotas) — solo OAuth manual del streamer.
- ❌ Cero browser extension propia (para Kick embebida) — v2.
- ❌ Cero mobile app — web responsive.
- ❌ Cero brand onboarding flow real — 8 brand-agents pre-cargados con kits curados por nosotros.
- ❌ Cero KYC — Privy lo cubre.
- ❌ Cero pricing dinámico complejo del lado del streamer-agent — multiplier por contexto premium suficiente.
- ❌ Cero disputas / refunds automatizados — manual desde admin.
- ❌ Cero analytics dashboard para brands — solo logs JSON + basescan.
- ❌ Cero internacionalización del UI — copy en español puro para el demo.
- ❌ Cero zonas avanzadas (`top_banner`, `side_panel`, `picture_in_picture`) — solo `lower_third`, `bottom_right_corner`, `fullscreen_takeover`.

---

## 13. Pitch en una línea

> **Atrio convierte cada momento de un stream en una negociación entre dos agents AI. El brand-agent caza, el streamer-agent defiende, cierran en lenguaje natural — directo o tras 2-3 turnos — liquidan en USDC vía x402, ensamblan el placement con los assets que la marca ya subió en su brand kit, renderizan sobre el stream. El long tail de creators finalmente monetiza con micropagos instantáneos en stablecoin — agents hablando, agents pagando, on-chain.**

---

## 14. Decisiones cerradas

| Decisión | Resultado |
|---|---|
| Producto | **Atrio** — agentic ad-tech para streams, on-chain |
| Crypto / wallets | **USDC en Base + smart wallets ERC-4337** (Privy embedded) |
| Cash-out / acreditación | **USDC nativo, instantáneo en wallet del creator. Cero fiat off-ramp en MVP, cero MP, cero SMS.** |
| Streamer UI | **OBS Browser Dock universal** (Twitch + Kick + YouTube + vMix) |
| Stream pipeline | **RTMP propio + multi-streaming a Twitch + Kick** |
| Demo type | **Live real**, backup VOD pre-grabado en standby |
| Use case marquee | **Gaming (FIFA) + brand-safety pull + coalición + FULL BREAK** |
| Vertical primario | Gaming streams LATAM, Coscu como persona |
| Modelo de agentes | **Brand-agents hunters + streamer-agent defender, ambos server-side, ambos con mandate firmado por su humano-principal** |
| Pricing model | **Negociación en 2 rondas: round 1 sealed-bid (initial offer del hunter) + round 2 multi-turn (3 turnos máx, paralelo por canal). Fallback al sealed bid más alto si round 2 no converge.** |
| Streamer-agent decisión por oferta | **Accept directo (cierra round 1), counter (abre round 2), reject (descarta canal)** |
| Voice del placement | **Audio que la marca subió en su brand kit. Lookup vía x402, cero generación.** |
| Visual del placement | **Imagen o video corto que la marca subió en su brand kit. Lookup vía x402, cero generación.** |
| QR del placement | **Generado runtime por qr-agent, único trackeable, vía x402.** |
| Audio analysis live | **Sí** — Deepgram Nova streaming |
| Vision analysis live | **Sí** — Gemini 2.5 Flash multimodal @ 1fps |
| x402 implementation | **On-chain real** vía EIP-3009 sobre USDC en Base |
| Sub-agents | **3** — voice (lookup), visual (lookup), qr (gen). Cada uno con wallet propia. |
| Demo display | **Pantalla split** — stream + bid leaderboard + tx feed + balance counter + chat de negociación |
| **Deployment topology** | **Path B (primary): Vercel (todo el Next.js + x402 + agents + orchestrator) + Supabase (DB + Realtime + Storage) + Base mainnet + Laptop B en venue para nginx-rtmp/ffmpeg/chat ingest expuesta vía Cloudflare Tunnel. Path A (stretch H 18-20): mover Docker de Laptop B a Fly.io.** |
| **Discurso de deployment para el jurado** | "Contrato en Base mainnet, web app y sub-agents en Vercel, escrow on-chain, DB + Storage en Supabase. La pipeline de ingesta RTMP corre en Docker — para el demo en una laptop del equipo por baja latencia, mismo `docker compose` corre idéntico en Fly.io / Hetzner". |

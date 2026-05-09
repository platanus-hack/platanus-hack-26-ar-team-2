# Addie — Diseño Final

**Fecha:** 2026-05-09
**Hackatón:** Platanus Hack BSAS · track *agent money*
**Demo:** domingo 2026-05-10
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
│    ├─ audio @16kHz ──► Deepgram Nova ──► transcript rolling 30s     │
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
│   AddieEscrow.lock(placementId, coscu_addr, 1.80 USDC)              │
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
│  CAPA 5 · APPROVE + RENDER + RELEASE                                │
│  ───────────────────────────────────────────────────────────        │
│                                                                     │
│   Push preview al OBS Browser Dock del creator                      │
│   (countdown 2s, botones Aprobar/Rechazar)                          │
│                              │                                      │
│              ┌───────────────┴───────────────┐                      │
│              ▼                               ▼                      │
│         Aprueba                          Rechaza                    │
│              │                               │                      │
│              ▼                               ▼                      │
│   Push al Browser Source overlay    AddieEscrow.refund              │
│   <video src={ad_url}>              ⚡ tx #2 (refund)                │
│   <img src={qr_dynamic}>            USDC vuelve a brand-agent       │
│   framer-motion fade-in                                             │
│              │                                                      │
│   Twitch viewers + jueces ven                                       │
│   el placement durante 6s                                           │
│              │                                                      │
│              ▼ (placement termina)                                  │
│   AddieEscrow.release(placementId)                                  │
│   ⚡ tx #2 (release): 1.80 USDC → coscu wallet                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Latencia end-to-end:** ~6-8 segundos del momento épico al placement on-screen. **2 txs por placement** (lock + release).

---

## 3. Diagrama de flujo — vida de un placement

```
T+0.0s    Coscu mete gol en FIFA
─────────────────────────────────────────────────────────────────────
T+0.5s    OBS encode → RTMP llega a nginx-rtmp
T+1.2s    Deepgram transcribe "GOLAZO"
T+1.3s    Gemini Flash describe frame: "FIFA replay celebration"
T+1.5s    tmi.js detecta chat velocity 12→180 msg/s
T+1.5s    Context broadcast a brand-agents
─────────────────────────────────────────────────────────────────────
T+2.0s    LLM call paralela en 8 brand-agents:
          → adidas: HUNT con "epic_goal_lower" (FIFA + epic + audience match)
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
T+6.0s    adidas-agent ejecuta: ⚡ escrow.lock(1.80 USDC)  [tx 0xAAA]
─────────────────────────────────────────────────────────────────────
T+6.2s    Plataforma arma placement assembly:
          { ad_url: "https://addie-cdn/.../adidas/epic_goal_lower.mp4",
            qr_url: "addie.app/q/abc123?placement=...",
            duration_ms: 6000, zone: "lower_third" }
─────────────────────────────────────────────────────────────────────
T+6.5s    Push preview al OBS Browser Dock de Coscu
T+6.5s-8.5s   Coscu tiene 2s para aprobar
─────────────────────────────────────────────────────────────────────
T+8.5s    Aprobado → push al Browser Source overlay
T+8.55s   Overlay renderiza:
          <video autoplay src={ad_url}>     ← ad de adidas (con voz baked-in)
          <img class="qr-corner" src={qr_dynamic}>
          framer-motion fade-in
─────────────────────────────────────────────────────────────────────
T+14.5s   Placement termina (duración 6s)
T+14.6s   ⚡ AddieEscrow.release(placementId)  [tx 0xBBB]
          → 1.80 USDC al wallet de Coscu
─────────────────────────────────────────────────────────────────────

2 transacciones on-chain por placement (lock + release).
Demo de 5 min con ~6 placements = ~12 txs visibles en basescan.
```

---

## 4. Brand Console — donde las marcas suben sus ads

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
  opening_message: "Coscu! Gol épico. Ofrezco $1.50 por mi ad 
                    'Epic Goal Lower' en lower_third 6s." }
```

El brand-agent NO genera nada. Solo elige.

---

## 5. Pre-generación de la biblioteca de ads (para el demo)

Las marcas reales generarían sus ads con sus agencias / herramientas. Para el demo, **nosotros pre-generamos la biblioteca de las 8 brands con ElevenLabs Creative**, una sola vez antes del demo.

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

## 6. Las tres patas del track *agent money*

| Pata | Cómo se manifiesta |
|---|---|
| **Negociación** | Brand-agents y streamer-agent regatean en lenguaje natural multi-turno. Brand-agent inicia con offer + ad variant, streamer-agent contraoferta basado en mandate del creator + pricing dinámico contextual. Cap 3 turnos. |
| **Know Your Agent** | Cada brand-agent tiene **mandate firmado EIP-712** del humano-marca: budget en USDC, contextos permitidos/prohibidos, keywords-pull, performance bonus. Wallet pública en Base. Auditable, revocable on-chain. |
| **Transacciones** | **USDC nativo en Base.** AddieEscrow contract: `lock` al ganar, `release` al renderizar exitosamente, `refund` si brand-safety pull. Cada placement = 2 txs visibles en basescan. Settlement instantáneo, sin Stripe, sin payouts mensuales. |

---

## 7. Stack tecnológico

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
| Audio STT | Deepgram Nova streaming | <500ms latency, $0.0043/min |
| Vision tagging | Gemini 2.5 Flash multimodal | Free tier 1M tokens/día |
| Brand-agent + streamer-agent LLM | Anthropic Claude 4.6 Sonnet | Mejor razonamiento de negociación |
| Twitch chat | tmi.js IRC | Anonymous read, real-time, free |
| Ad creative pre-gen (offline, una vez) | ElevenLabs Creative | Video + voz + música en una API |
| Asset storage | Vercel Blob | CDN incluido, integración con Next.js |
| QR generation (runtime) | `qrcode` npm | Server-side, ~50ms |
| Frontend | Next.js + Tailwind + framer-motion | Overlay + Dock + Console |

---

## 8. Estructura del proyecto

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
│       │       │   ├── brands/         ← 8 mandate templates
│       │       │   └── types.ts
│       │       ├── pipeline/
│       │       │   ├── rtmp.ts         ← orchestrator
│       │       │   ├── audio.ts        ← Deepgram client
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
│   └── 0003_ads.sql
├── scripts/
│   ├── seed-wallets.ts                 ← genera 9 smart wallets (8 brand + 1 platform)
│   ├── seed-mandates.ts                ← 8 brand mandates iniciales
│   ├── seed-inventory.ts               ← inventario del creator demo
│   ├── pregen-brand-ads.ts             ← genera 32 ads con ElevenLabs Creative
│   └── smoke-e2e.ts                    ← test integration
├── public/
└── README.md
```

---

## 9. Estrategia de ramas + asignaciones

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
- Privy setup + 9 smart wallets (8 brand + 1 platform owner del escrow)
- Fondear las 8 brand wallets con $5 USDC cada una
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
- Deepgram WebSocket client
- Gemini Flash multimodal client
- tmi.js Twitch chat
- Context buffer + Supabase Realtime push
- Webhooks `on_publish` / `on_publish_done`

**Files:**
- `infra/**`
- `apps/web/src/lib/pipeline/**`
- `apps/web/src/app/api/stream/**`

**Skills:** ffmpeg, WebSocket clients, Node child_process, Supabase Realtime.

#### 🤖 Dev 3 — AGENTS

**Owns:**
- 8 brand mandate templates (YAML)
- brand-agent runner (hunter logic — pickea ad variant + bid amount)
- streamer-agent runner (defender logic — accept/counter/reject)
- negotiation orchestrator (multi-turn paralelo, timeout 5s)
- subasta engine (compara closed deals)
- Brand-safety listener (auto-pull + escrow.refund trigger)
- QR generation server-side + tracking redirect (`/api/q/[placement]`)

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
- Browser Dock (`/dock`) con preview + approve/reject + balance + FULL BREAK button
- Settings + Inventory editor (`/settings/inventory`)
- **Brand console** (`/brands/[brandId]`) con upload de ads + ad library viewer
- Demo Display (`/demo-display`) con bid leaderboard + tx feed + negotiation chat
- **Pre-generación de ads sábado de noche** (`scripts/pregen-brand-ads.ts`) con ElevenLabs Creative

**Files:**
- `apps/web/src/app/{overlay,dock,settings,brands,demo-display}/**`
- `apps/web/src/components/**`
- `apps/web/src/lib/ads/**`
- `apps/web/src/app/globals.css`
- `scripts/pregen-brand-ads.ts`

**Skills:** Next.js App Router, Tailwind, framer-motion, ElevenLabs Creative API, Supabase Realtime client.

---

## 10. Cronograma 24 horas

```
SÁBADO
─────────────────────────────────────────────────────────────────────
T+0h   16:00   Phase 0 — Setup compartido
                • Repo + Next.js scaffold
                • API keys (Anthropic, Gemini, Deepgram, ElevenLabs, Privy, Supabase, Alchemy)
                • Supabase project + schema
                • Foundry init
                • Docker nginx-rtmp probado
                • 8 brand mandates definidos
                • Tailwind theme

T+2h   18:00   ✅ CHECKPOINT 1 — Phase 0 completa, todos arrancan tracks

T+2h-12h        Phase 1 — TRACKS PARALELOS
                Cada dev en su rama, sin tocar a otros.

T+12h  04:00   ✅ CHECKPOINT 2 — Tracks individuales done, merge a main

T+12h-18h       Phase 2 — INTEGRACIÓN
                Dev 1+3 (par): negociación → escrow.lock → render → release
                Dev 2+4 (par): pipeline → context → dock preview
                Dev 4: PRE-GEN ADS con ElevenLabs Creative (en background, ~1.5 hs)

T+18h  10:00   ✅ CHECKPOINT 3 — End-to-end completo, merge final

T+18h-22h       Phase 3 — POLISH + DEMO
                Scripting demo flow, hotkeys (FORCE EVENT, FULL BREAK),
                brand-safety triggers, coalición visible, cash-out con SMS,
                backup VOD pre-grabado, pitch slides, 2 ensayos completos.

DOMINGO
T+22h  14:00   ✅ CHECKPOINT 4 — Demo grabable lista

T+22h-24h       Phase 4 — FINAL
                Sleep + shower + arrive at venue + ensayo técnico final.

T+24h  16:00   DEMO LIVE 🎤
```

---

## 11. Demo choreography (5-7 minutos)

### Setup físico

- **Laptop streamer** — uno del equipo, OBS, juego, micro/cámara, segunda pantalla con OBS Dock visible.
- **Laptop presenter** — controla pantalla principal con `/demo-display` proyectada.
- **Servidor backend** — laptop o VPS Hetzner.
- **nginx-rtmp** en localhost de laptop streamer.
- **Hotspot 4G** como backup wifi.
- **Backup VOD** pre-grabado en standby.

### Acto 1 (45s) — Setup narrativo

> *"Esto es Addie. 8 brand-agents corriendo, cada uno con USDC propio en Base, mandate firmado, y biblioteca de ads que la marca ya subió. Coscu — del equipo — está streameando FIFA en vivo a Twitch."*

### Acto 2 (90s) — Primer momento épico + negociación visible

Streamer mete gol → pipeline detecta → brand-agents inician negociaciones paralelas → demo display muestra 4 columnas de chat negociación EN ESPAÑOL → adidas gana con su ad "epic_goal_lower" → escrow.lock visible → preview en dock → approve → render del video adidas (con voz baked-in) + QR dinámico encima.

> *"Los agents pelearon en lenguaje natural por el momento. Adidas eligió SU ad de su biblioteca, no algo generado en runtime. La marca es la dueña de su arte. Addie decide cuándo y dónde aparecer."*

### Acto 3 (30s) — Brand safety pull

Streamer dice palabra prohibida → fade out automático en 200ms → escrow.refund visible en feed → marcas demuestran protección on-chain.

### Acto 4 (90s) — FULL BREAK premium

Streamer aprieta "FULL BREAK NOW" → subasta especial fullscreen_takeover → Coca-Cola gana $5.20 con su ad "premium_takeover" → 30s de video premium con voz + música → escrow.release visible.

### Acto 5 (45s) — Cash-out

Stream cierra con balance acumulado en wallet de Coscu. Presenter abre basescan, muestra historial de las ~12 txs del demo (6 placements × 2 txs cada uno).

> *"Coscu cobró $X.XX USDC en 5 minutos. Sin Stripe, sin payouts mensuales, sin contratos. Verificable acá en basescan en este momento."*

### Acto 6 (Q&A devs, opcional 30s)

Pantalla técnica con `curl` mostrando endpoint de auctions + AddieEscrow.sol explorer.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Wifi del venue se cae | Hotspot 4G activo. Stack 100% en localhost menos LLM/STT/TTS APIs. |
| Pre-gen de ads no termina a tiempo | CSS fallback automático para combinaciones faltantes. Demo no se rompe. |
| Negociación no cierra | Cap 3 turnos + timeout 5s + fallback a mejor offer parcial. |
| Streamer no produce momento épico | Hotkey "FORCE EVENT" en dock dispara epic_moment manual. |
| Deepgram WS cae | Reconnect + skip step si falla. Agents bidean solo con chat + frame. |
| Gemini Flash rate-limit | Pre-cargar quota + Claude Vision como fallback. |
| Tx on-chain se atora | Base es rápido (~2s). Si tarda >5s, mostrar "pending" y seguir. |
| Smart wallet sin gas | Pre-fondear con $0.10 ETH cada una. |
| Demo total se rompe | Backup VOD pre-grabado de un ensayo completo. Switch invisible. |

---

## 13. Fuera de scope (YAGNI)

- ❌ Cero off-ramp fiat — USDC nativo, fin.
- ❌ Cero Twitch Extension oficial — solo OBS Browser Dock.
- ❌ Cero TikTok Live (API cerrada).
- ❌ Cero YouTube Live discovery.
- ❌ Cero browser extension propia.
- ❌ Cero mobile app.
- ❌ Cero brand onboarding flow real para humanos — 8 brand-agents pre-cargados con ads pre-generadas.
- ❌ Cero KYC.
- ❌ Cero pricing dinámico complejo del streamer-agent.
- ❌ Cero disputas/refunds automatizados — manual desde admin.
- ❌ Cero analytics dashboard para brands más allá de stats simples.
- ❌ Cero internacionalización del UI.
- ❌ Cero zonas avanzadas (`top_banner`, `side_panel`, `picture_in_picture`) — solo `lower_third`, `bottom_right_corner`, `fullscreen_takeover`.
- ❌ **Cero generación runtime de creative** — todo pre-subido por la marca.
- ❌ **Cero sub-agents x402** — los servicios de QR/render son internos, no agents.

---

## 14. Pitch line

> **Las marcas suben sus ads pre-producidos a Addie. El brand-agent decide cuándo aparecer, contra qué streamer, con qué variante de su biblioteca. Negocia con el agent del creator en lenguaje natural. Cierran en USDC vía smart contract en Base. El long tail de creators monetiza atención sin contratos, sin equipos de ventas, sin esperas. Agents hablando, agents pagando, on-chain, en tiempo real.**

---

## 15. Decisiones cerradas finales

| Decisión | Resultado |
|---|---|
| Producto | **Addie** — agentic ad-tech para streams |
| Crypto | **USDC en Base + smart wallets ERC-4337** (Privy) |
| Cash-out | **USDC nativo** + off-ramp link externo (v2) |
| Streamer UI | **OBS Browser Dock universal** |
| Stream pipeline | **RTMP propio + multi-streaming a Twitch** |
| Demo | **Live real**, backup VOD en standby |
| Use case marquee | **FIFA + brand-safety pull + coalición + FULL BREAK** |
| Vertical primario | Gaming streams LATAM (Coscu como persona) |
| Pricing | **Negociación multi-turno** brand-agent vs streamer-agent |
| **Creative** | **Brands suben sus ads. Cero generación runtime. Pre-gen offline con ElevenLabs Creative para el demo.** |
| **Sub-agents** | **Cero. Solo brand-agents y streamer-agent.** |
| Voice/Visual en placement | **Bake-in en el ad subido por la marca** |
| QR | **Server-side dynamic con tracking_id por placement** |
| On-chain txs por placement | **2** (lock + release). Demo de 5 min × 6 placements = 12 txs. |
| Brand-safety | **Auto-pull con escrow.refund automático** |

---

## Referencias

- Plan de implementación detallado: [`docs/superpowers/plans/2026-05-09-atrio-implementation.md`](../plans/2026-05-09-atrio-implementation.md) (renombrar a `addie` cuando se mueva al repo nuevo)
- Spec previa con sub-agents x402 (descartada): [`docs/superpowers/specs/2026-05-09-atrio-design.md`](./2026-05-09-atrio-design.md)
- Spec original (AgentVille, descartada): [`docs/superpowers/specs/2026-05-08-agentville-design.md`](./2026-05-08-agentville-design.md)

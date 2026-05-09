# Addie — TODO

Lista viva de tareas para llegar al demo del **2026-05-10 12:00**. Referencia maestra de diseño: [`DESIGN.md`](./DESIGN.md). Protocolo de coordinación: [`CLAUDE.md`](./CLAUDE.md).

## Cómo se usa este archivo

1. **Antes de programar:** firmá tu claim en la tabla *Currently working on* abajo con tu nombre, ID de tarea, scope corto y timestamp. Push del claim a `main` = lock adquirido. Detalles en [`CLAUDE.md` § Flow de claim](./CLAUDE.md#flow-de-claim-cada-vez-que-arranc%C3%A1s-algo-nuevo).
2. **Mientras laburás:** cambiá el estado de la tarea a 🟡.
3. **Al terminar:** marcá ✅, eliminá tu fila del WIP, y **FF-mergeá tu track branch a `main`** — no esperes al checkpoint. Detalles en [`CLAUDE.md` § Flow de cierre](./CLAUDE.md#flow-de-cierre-cada-vez-que-termin%C3%A1s-un-todo).
4. **Si te trabás:** marcá 🚧 con una línea de qué falta.

Las **tracks A/B/C/D del §10 DESIGN.md son guía**, no obligatorias. Si terminás antes lo tuyo, agarrá la siguiente tarea libre del board y respetá las dependencias.

Convención de estado: ⬜ no empezada · 🟡 en progreso · ✅ hecha · 🚧 bloqueada
Las tareas con `[INFRA]` son cuentas / deploys / fondos / hardware — hacelas **apenas las necesite** la siguiente tarea del flujo, no antes.

> **Merge cadence:** cada TODO ✅ entra a `main` por FF apenas está listo. Los checkpoints (T+2h, T+12h, T+18h, T+22h) son anchors de fase / sync ritual, **no** gates de merge.

---

## Currently working on

| Dev | Task ID | Scope | Started |
|---|---|---|---|
| Andy | POC-NEG | Multi-agent negotiation POC bajo `poc/negotiation/` (foundation para C-08..C-13: valuation CPM-based, concession curves Faratin, AC_combi gate, BATNA, multi-issue exclusivity) | 2026-05-09 |
| Lucas | POC-PIPE | Pipeline POC standalone bajo `poc/pipeline/` (foundation para B-01..B-07: docker-compose nginx-rtmp + webhooks on_publish/on_publish_done + ffmpeg audio/frames + tmi.js chat + context tick en terminal) | 2026-05-09 |
| Franco | A-01 | `contracts/src/AddieEscrow.sol` ~80 LoC — `lock(placementId, payee, amount)` / `release` / `refund` + eventos `Locked`/`Released`/`Refunded`, USDC en Base | 2026-05-09 09:33 |
| Franco | A-02 | Tests Foundry happy path + reverts en `contracts/test/AddieEscrow.t.sol` (mock USDC, lock/release/refund + revert paths + event asserts) | 2026-05-09 09:48 |

---

## Phase 0 — Setup compartido (T+0..+2h · sáb 06-08hs)

Bloqueador absoluto de todo lo demás. Apuntar a Checkpoint 1 a las **08:00 sábado**.

### Repo y scaffolding

- ✅ **P0-01** Next.js 16 App Router scaffold dentro de `apps/web/` (TS, ESLint, Tailwind 4, src/ dir, App Router, RSC default)
- ✅ **P0-02** Tailwind theme + design tokens base (`apps/web/src/lib/theme.ts`, `globals.css`) — deps: P0-01
- ✅ **P0-03** Foundry init en `contracts/` (`forge init`, `foundry.toml`, remappings, basic CI hint)
- ⬜ **P0-04** Migración inicial `supabase/migrations/0001_init.sql` con tablas `accounts`, `streams`, `mandates`
- ⬜ **P0-05** Llenar `platanus-hack-project.json` con `project-name`, oneliner, descripción
- ⬜ **P0-06** Reescribir `README.md` con stack + quick-start + link a `DESIGN.md` y `TODO.md`

### Infra de cuentas y API keys

- ⬜ **P0-07** `[INFRA]` Cuenta Anthropic + key Claude 4.6 Sonnet → `ANTHROPIC_API_KEY`
- ⬜ **P0-08** `[INFRA]` Google AI Studio + key Gemini 2.5 Flash → `GEMINI_API_KEY`
- ⬜ **P0-09** `[INFRA]` Deepgram + key streaming Nova → `DEEPGRAM_API_KEY`
- ⬜ **P0-10** `[INFRA]` ElevenLabs + key Creative → `ELEVENLABS_API_KEY` (necesario para pre-gen ads §6)
- ⬜ **P0-11** `[INFRA]` App Privy con embedded smart wallets en Base → `PRIVY_APP_ID`, `PRIVY_APP_SECRET`
- ⬜ **P0-12** `[INFRA]` Proyecto Supabase + URL + service-role + anon key
- ⬜ **P0-13** `[INFRA]` App Alchemy en Base mainnet → `ALCHEMY_RPC_URL`
- ⬜ **P0-14** `[INFRA]` Vercel Blob token (CDN para assets de ads + clips de auditoría) → `BLOB_READ_WRITE_TOKEN`
- ⬜ **P0-15** `[INFRA]` Cuenta Twitch para Coscu-test (stream key + channel name para tmi.js)
- ⬜ **P0-16** `.env.example` con todas las vars + `.env.local` cargado (no commitear)

### Infra local + chain

- ⬜ **P0-17** `[INFRA]` Docker compose con `nginx-rtmp` (localhost:1935 RTMP + 8080 HTTP control + volumen para `record`)
- ⬜ **P0-18** `[INFRA]` OBS publica al RTMP local con un test stream (verificar con `ffprobe rtmp://localhost/live/test`)
- ⬜ **P0-19** `[INFRA]` Plugin OBS *Multiple RTMP Outputs* instalado para multi-stream local + Twitch
- ⬜ **P0-20** `[INFRA]` Conseguir 50–100 USDC en Base (treasury del equipo) para fondear escrow + 8 brand wallets a $5 c/u
- ⬜ **P0-21** `[INFRA]` ~$1 ETH en Base para gas de las 9 wallets

### Diseño compartido

- ⬜ **P0-22** Definir 8 brand mandates en YAML (adidas, nike, quilmes, mp, steam, rappi, globant, cocacola) — drafts iniciales en `apps/web/src/lib/agents/brands/*.yaml`. **mp con `always_bid_floor: true`** (default bidder al floor §4)

✅ **Checkpoint 1 — sáb 08:00:** Phase 0 cerrada, todos arrancan tracks paralelos.

---

## Phase 1 — Tracks paralelos (T+2..+12h · sáb 08hs..sáb 18hs)

### Track A · On-chain (sugerido: Franco)

- 🟡 **A-01** `contracts/src/AddieEscrow.sol` (~80 LoC) con `lock(placementId, payee, amount)`, `release(placementId)`, `refund(placementId)` + eventos `Locked`/`Released`/`Refunded` — deps: P0-03
- 🟡 **A-02** Tests Foundry happy path + reverts en `contracts/test/AddieEscrow.t.sol` — deps: A-01
- ⬜ **A-03** `contracts/script/Deploy.s.sol` + deploy a Base mainnet — deps: A-02, P0-13, P0-21
- ⬜ **A-04** `[INFRA]` Anotar address del contrato deployed en `apps/web/src/lib/chain/escrow.ts` como const + verificar en basescan — deps: A-03
- ⬜ **A-05** `scripts/seed-wallets.ts` — genera 9 Privy smart wallets (8 brand + 1 platform owner) y persiste addresses en `accounts` — deps: P0-11, P0-12, P0-04
- ⬜ **A-06** `[INFRA]` Fondear las 8 brand wallets con $5 USDC y ~$0.10 ETH cada una — deps: A-05, P0-20, P0-21
- ⬜ **A-07** Cliente viem en `apps/web/src/lib/chain/viem.ts` (publicClient + walletClient factory por brand) — deps: A-04
- ⬜ **A-08** Bindings escrow en `apps/web/src/lib/chain/escrow.ts` (`lockEscrow`, `releaseEscrow`, `refundEscrow`, watchers de eventos) — deps: A-07
- ⬜ **A-09** Helper Privy server-side en `apps/web/src/lib/chain/privy.ts` (sign + send tx por brand id) — deps: A-05, A-07
- ⬜ **A-10** Componente `TxFeed` (`apps/web/src/components/demo/TxFeed.tsx`) escuchando eventos on-chain con links a basescan — deps: A-08, P0-02

### Track B · Pipeline (sugerido: Lucas)

- ⬜ **B-01** `infra/docker-compose.yml` con nginx-rtmp + puertos + volume para `record` — deps: P0-17
- ⬜ **B-02** `infra/nginx-rtmp.conf` con `application live` + webhooks `on_publish` / `on_publish_done` apuntando a `apps/web/src/app/api/stream/*` (usar `host.docker.internal:3000` desde Docker en Mac) — deps: B-01
- ⬜ **B-03** Endpoint `POST /api/stream/on-publish` que crea fila en `streams` y arranca el orchestrator del pipeline — deps: B-02, P0-04
- ⬜ **B-04** Audio pipe: `ffmpeg` child_process → 16kHz PCM stream → Deepgram WS, transcript rolling 30s en buffer — deps: B-03, P0-09
- ⬜ **B-05** Vision pipe: `ffmpeg` frames @1fps → Gemini Flash multimodal (frame summary + tags) cada 1s — deps: B-03, P0-08
- ⬜ **B-06** Twitch chat: tmi.js client conectado al canal de demo, calcula `chat_velocity`, `sentiment`, `recent_keywords` — deps: P0-15
- ⬜ **B-07** Context buffer combinador (`apps/web/src/lib/pipeline/context.ts`): merge `audio_30s + frame + chat_vel + viewers + sentiment` y broadcast cada 1s a Supabase Realtime channel — deps: B-04, B-05, B-06, P0-12
- ⬜ **B-08** Audit clip · etapa 1: nginx-rtmp `record` con segmentos de 1s en buffer circular ~60s — deps: B-02
- ⬜ **B-09** Audit clip · etapa 2: ffmpeg `cliprange` T-10s..T+20s del stream crudo cuando llega evento de placement — deps: B-08
- ⬜ **B-10** Audit clip · etapa 3: segundo ffmpeg con overlay del ad video + QR en zona/timestamp del placement → mp4 final — deps: B-09, C-13
- ⬜ **B-11** Audit clip · etapa 4: upload mp4 a Vercel Blob → escribir `placements.clip_url` y `context_snapshot` — deps: B-10, P0-14, C-15
- ⬜ **B-12** `POST /api/stream/on-publish-done` que cierra la fila de `streams` y limpia recursos — deps: B-03

### Track C · Agents (sugerido: Andy)

- ⬜ **C-01** Tipos comunes (`Mandate`, `BrandAgentDecision`, `NegotiationTurn`, `StandingOffer`, `SoftHold`) en `apps/web/src/lib/agents/types.ts`
- ⬜ **C-02** 8 mandate templates YAML en `apps/web/src/lib/agents/brands/*.yaml` + loader — deps: P0-22, C-01
- ⬜ **C-03** Migración `0002_inventory.sql` (zonas, floors, max_duration por creator) — deps: P0-04
- ⬜ **C-04** Migración `0003_ads.sql` (tabla `ads` ver §5 DESIGN.md) — deps: P0-04
- ⬜ **C-05** Migración `0004_placements.sql` (tabla `placements` con audit fields: `clip_url`, `context_snapshot`, `agent_reasoning`, `negotiation_transcript`, `lock/release/refund_tx_hash`) — deps: P0-04
- ⬜ **C-06** `scripts/seed-mandates.ts` — inserta mandates + firma EIP-712 dummy por brand — deps: C-02, A-05
- ⬜ **C-07** `scripts/seed-inventory.ts` — inventario del creator demo — deps: C-03
- ⬜ **C-08** brand-agent runner (`apps/web/src/lib/agents/brand/`): subscribe al context channel, prompt a Claude con mandate + balance + ads disponibles, output `{should_bid, ad_id, bid_usdc_cents, zone, opening_message}` — deps: C-01, C-02, B-07, P0-07
- ⬜ **C-09** streamer-agent runner (`apps/web/src/lib/agents/streamer/`): recibe ofertas, evalúa contra mandate del creator, contraoferta o accept — deps: C-01, P0-07
- ⬜ **C-10** Negotiation orchestrator (`apps/web/src/lib/agents/negotiation/`): subasta multi-turno paralela, 3 turnos cap, **5s hard deadline**, standing offers actualizadas turno a turno — deps: C-08, C-09
- ⬜ **C-11** Soft hold ledger off-chain en memoria (`apps/web/src/lib/agents/negotiation/holds.ts`): refresca holds cada turno, expone `available_balance = on_chain - Σ(holds_propios)` al LLM — deps: C-10, A-08
- ⬜ **C-12** Settlement engine: al T+5s pickea **single winner** mejor standing ≥ floor a través de TODAS las zonas competidoras (single-ad-per-moment §4), fallback a default bidder si nadie pasa el floor, fallback a runner-up si lock falla — deps: C-10, C-11, A-08
- ⬜ **C-13** Default bidder al floor para mp (`always_bid_floor: true`): siempre emite floor offer si el contexto no es brand-unsafe; garantiza fill cuando ningún brand premium bidea — deps: C-08
- ⬜ **C-14** Endpoint `POST /api/auctions/run` que dispara la subasta cuando llega un epic moment + emite evento de placement con `{ad_url, qr_url, duration_ms, zone, placement_id}` — deps: C-10, C-12
- ⬜ **C-15** Brand-safety listener (`apps/web/src/lib/agents/safety/`) que monitorea audio + chat durante el render y dispara `escrow.refund` si hay keyword pull — deps: C-14, A-08, B-04, B-06
- ⬜ **C-16** Persistir audit metadata al settlement: `agent_reasoning` (output LLM ganador) + `negotiation_transcript` (todos los turnos) + `winning_offer` en `placements` — deps: C-14, C-05
- ⬜ **C-17** QR generator server-side + endpoint `GET /api/q/[placement]/route.ts` que redirige a `tracking_url` y registra el scan — deps: C-05

### Track D · UI (sugerido: Jere)

- ✅ **D-01** Browser Source overlay `apps/web/src/app/overlay/[id]/page.tsx`: `<video autoplay>` + `<img class="qr-corner">` + framer-motion fade-in — deps: P0-02
- ⬜ **D-02** PlacementRenderer component que consume placement events vía Supabase Realtime y renderiza — deps: D-01, C-14
- ✅ **D-03** Browser Dock `apps/web/src/app/dock/page.tsx`: balance del creator + recent placements + hotkeys (FORCE EVENT, FULL BREAK) — deps: P0-02, A-08
- ⬜ **D-04** Inventory editor `apps/web/src/app/settings/inventory/page.tsx` (CRUD zonas/floors/max_duration) — deps: P0-02, C-03
- ✅ **D-05** Preferences `apps/web/src/app/settings/preferences/page.tsx` (brands aprobadas, brand-safety keywords) — deps: P0-02
- ⬜ **D-06** Brand console `apps/web/src/app/brands/[brandId]/page.tsx`: saldo, library viewer, mandate editor, performance stats — deps: P0-02, C-04, A-05
- ⬜ **D-07** Ad uploader `apps/web/src/components/brands/AdUploader.tsx` (form + Vercel Blob upload + insert en `ads`) — deps: D-06, P0-14, C-04
- ⬜ **D-08** Audit log panel en brand console: lista placements + `<video src={clip_url}>` + viewer JSON de `agent_reasoning` + transcript de negociación + export CSV/JSON — deps: D-06, C-05, B-11
- ⬜ **D-09** Demo Display `apps/web/src/app/demo-display/page.tsx`: bid leaderboard + tx feed + negotiation chat con standing offers actualizándose en vivo — deps: P0-02, A-10, C-10
- ⬜ **D-10** `scripts/pregen-brand-ads.ts` — genera 32 ads (8 brands × 4 variants) con ElevenLabs Creative + insert en `ads` — deps: P0-10, C-04, P0-14
- ⬜ **D-11** Correr el script de pre-gen el sábado de noche (~1.5 hs en background, paralelo con cualquier track) — deps: D-10
- ⬜ **D-12** CSS fallback render (banda negra + logo + colores corporativos) si un ad no tiene `asset_url` — deps: D-02

✅ **Checkpoint 2 — sáb 18:00:** sync ritual — verificar que todos los tracks A/B/C/D arrancaron y que los TODOs cerrados ya están en `main`. Identificar bloqueos antes de Phase 2.

---

## Phase 2 — Integración (T+12..+18h · sáb 18hs..dom 00hs, cruza medianoche)

Pares trabajando juntos para conectar cabos.

- ⬜ **I-01** Happy path end-to-end: stream → context → subasta → `escrow.lock` → render → `escrow.release` — deps: A-08, B-07, C-14, D-02
- ⬜ **I-02** Brand-safety pull integrado: keyword detect → fade out 200ms → `escrow.refund` visible — deps: I-01, C-15
- ⬜ **I-03** Audit clip compuesto e2e: post-placement → clip 30s con overlay → upload Vercel Blob → visible en brand console — deps: I-01, B-11, D-08
- ⬜ **I-04** Standing offers + holds + settlement testeado bajo concurrencia (4 brand-agents paralelos) — deps: C-10, C-11, C-12
- ⬜ **I-05** House bidder demuestra que llena gaps cuando ningún premium bidea — deps: I-04, C-13
- ⬜ **I-06** TxFeed + Demo Display sincronizados con eventos reales del escrow — deps: A-10, D-09
- ⬜ **I-07** `[INFRA]` Deploy Vercel del Next.js (preview o prod) con env vars cargadas; decidir si en demo se corre `pnpm dev` local o tunnel a Vercel para alcanzar nginx-rtmp — deps: P0-16, I-01
- ⬜ **I-08** `scripts/smoke-e2e.ts` que dispara epic moment fake → verifica las 2 txs en basescan — deps: I-01
- ⬜ **I-09** Ensayo técnico interno (sin pitch, solo mecánica) — deps: I-01..I-06

✅ **Checkpoint 3 — dom 00:00 (medianoche):** sync ritual — happy path end-to-end ya en `main` (I-01 ✅), brand-safety integrado, audit clip e2e funcionando.

---

## Phase 3 — Polish + demo prep (T+18..+22h · dom 00-04hs)

- ⬜ **PD-01** Hotkey *FORCE EVENT* en dock que dispara epic_moment manual — deps: D-03, B-07
- ⬜ **PD-02** Hotkey *FULL BREAK* en dock que arranca subasta especial fullscreen_takeover — deps: D-03, C-14
- ⬜ **PD-03** Brand-safety triggers ensayados (palabras concretas que disparan refund visible) — deps: C-15
- ⬜ **PD-04** Cash-out con SMS al final del demo (script real o mock visible) — deps: A-10
- ⬜ **PD-05** `[INFRA]` Backup VOD pre-grabado del demo end-to-end (mp4 standby para switch invisible si algo se rompe en vivo)
- ⬜ **PD-06** `[INFRA]` Hotspot 4G testeado como red backup
- ⬜ **PD-07** Pitch slides (max 5 slides para 5 min)
- ⬜ **PD-08** Ensayo completo 1 (full demo + pitch) — deps: PD-01..PD-04, PD-07
- ⬜ **PD-09** Ensayo completo 2 con tweaks — deps: PD-08

✅ **Checkpoint 4 — dom 04:00:** demo grabable y robusto.

---

## Phase 4 — Final (T+22..+30h · dom 04-12hs · 8h con buffer)

- ⬜ **F-01** Power nap (~3-4h, dom 04-08hs)
- ⬜ **F-02** Shower + desayuno + último review del flow demo
- ⬜ **F-03** Llegar al venue + setup físico (laptops, micro, cámara, OBS, Browser Dock visible)
- ⬜ **F-04** `[INFRA]` Test final de wifi del venue + switch a hotspot 4G si pierde paquetes — deps: PD-06
- ⬜ **F-05** Ensayo técnico final en venue (~30 min antes)
- ⬜ **F-06** Demo en vivo 🎤 (dom 12:00)

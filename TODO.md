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
| Lucas | POC-PIPE | Pipeline POC standalone bajo `poc/pipeline/` (foundation para B-01..B-07: docker-compose nginx-rtmp + webhooks on_publish/on_publish_done + ffmpeg audio/frames + tmi.js chat + context tick en terminal) | 2026-05-09 |
| Lucas | B-08..B-11 | Audit clip composite (nginx record buffer + ffmpeg cliprange + ad/QR overlay + Vercel Blob upload). Endpoint POST /api/audit/clip que recibe placement metadata y devuelve URL del mp4. | 2026-05-09 |
| Jere | C-02 | 8 mandate templates YAML (brands/*.yaml) + loader TypeScript | 2026-05-09 |
| Andy | C-08m | Manager-worker en `apps/manager-worker/` — subscribe a `context_chunks` via Supabase Realtime postgres_changes, semantic Stage1 filter (audio_intent/mentions/viewers_delta) + Stage2 Claude Haiku con scores moment_quality/brand_match, POST a `/api/creators/<id>/render` con message text (placeholder hasta C-14). DRY_RUN flag para correr sin ANTHROPIC_API_KEY. + migración `0009_realtime_context_chunks.sql` (ADD context_chunks A LA publication supabase_realtime). | 2026-05-09 |

---

## Phase 0 — Setup compartido (T+0..+2h · sáb 06-08hs)

Bloqueador absoluto de todo lo demás. Apuntar a Checkpoint 1 a las **08:00 sábado**.

### Repo y scaffolding

- ✅ **P0-01** Next.js 16 App Router scaffold dentro de `apps/web/` (TS, ESLint, Tailwind 4, src/ dir, App Router, RSC default)
- ✅ **P0-02** Tailwind theme + design tokens base (`apps/web/src/lib/theme.ts`, `globals.css`) — deps: P0-01
- ✅ **P0-03** Foundry init en `contracts/` (`forge init`, `foundry.toml`, remappings, basic CI hint)
- ✅ **P0-04** Migración inicial `supabase/migrations/0001_init.sql` con tablas `accounts`, `streams`, `mandates`
- ✅ **P0-05** Llenar `platanus-hack-project.json` con `project-name`, oneliner, descripción
- ✅ **P0-06** Reescribir `README.md` con stack + quick-start + link a `DESIGN.md` y `TODO.md`

### Infra de cuentas y API keys

- ⬜ **P0-07** `[INFRA]` Cuenta Anthropic + key Claude 4.6 Sonnet → `ANTHROPIC_API_KEY`
- ❌ **P0-08** ~~Google AI Studio + key Gemini 2.5 Flash~~ — **deprecado**. B-05 usa **Vercel AI Gateway** con `AI_GATEWAY_API_KEY` apuntando a `google/gemini-2.5-flash` — sin Gemini key directa.
- ❌ **P0-09** ~~Deepgram + key streaming Nova~~ — **deprecado** ([commit 992e5a1](../../commit/992e5a1)). El POC usa ElevenLabs Scribe v2 realtime, que va con la misma key del P0-10.
- ✅ **P0-10** `[INFRA]` ElevenLabs + key → `ELEVENLABS_API_KEY` confirmada en `apps/web/.env.local` (Vercel) y en `poc/pipeline/.env`. Una sola cuenta cubre **Scribe v2 realtime para STT** §3 + Creative para pre-gen ads §6 + TTS §6.
- ✅ **P0-11** `[INFRA]` App Privy con embedded smart wallets en Base (Kernel implementation) → `PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` cargados en `apps/web/.env.local`. Smoke test OK: `POST /v1/wallets` devolvió address válido (ver `tmp/test-privy.sh`, gitignored).
- ✅ **P0-12** `[INFRA]` Proyecto Supabase + URL + service-role + anon key
- ✅ **P0-13** `[INFRA]` App Alchemy en Base mainnet → `ALCHEMY_RPC_URL`
- ⬜ **P0-14** `[INFRA]` **(Andy)** Vercel Blob token (CDN para assets de ads + clips de auditoría) → `BLOB_READ_WRITE_TOKEN`
- ⬜ **P0-15** `[INFRA]` Cuenta Twitch para Coscu-test (stream key + channel name para tmi.js)
- ✅ **P0-16** `.env.example` con todas las vars + `.env.local` cargado (no commitear)

### Infra local + chain

- ⬜ **P0-17** `[INFRA]` Docker compose con `nginx-rtmp` (localhost:1935 RTMP + 8080 HTTP control + volumen para `record`)
- ⬜ **P0-18** `[INFRA]` OBS publica al RTMP local con un test stream (verificar con `ffprobe rtmp://localhost/live/test`)
- ⬜ **P0-19** `[INFRA]` Plugin OBS *Multiple RTMP Outputs* instalado para multi-stream local + Twitch
- ✅ **P0-20** `[INFRA]` $30 USDC depositados de Lemon → owner wallet vía Base (red nativa, no bridge). Fee Lemon ~$0 (ofreció Base directo). Owner wallet `0x7e6685A241278d83068f8Cfb0Dd145F62cb17914` post-deposit: 30.0008 USDC (los 0.0008 son dust de spam previo). Streamer-team y platform owner no requieren USDC.
- ✅ **P0-21** `[INFRA]` ~$1 ETH en Base para gas — alcanza de sobra para las 5 wallets que firman txs (4 brands + platform owner). La streamer-team wallet no firma nada, no necesita ETH.

### Diseño compartido

- ✅ **P0-22** Definir brand mandates en YAML — drafts iniciales en `apps/web/src/lib/agents/brands/*.yaml`. **MVP scope final: 4 brands fictional** (post-pivote a meta-streaming, ver `docs/PITCH.md` Bloque 2 + C-02e): **CafetITO** (premium episodic, mood `high_energy`), **TermoFlex** (`always_bid_floor: true` default bidder §4), **Pancho Rex** (niche lunch/late daypart), **MateBros** (community/`casual_chat`). Los YAMLs reales se renombran en C-02e. El código es brand-count-agnóstico.

✅ **Checkpoint 1 — sáb 08:00:** Phase 0 cerrada, todos arrancan tracks paralelos.

---

## Phase 1 — Tracks paralelos (T+2..+12h · sáb 08hs..sáb 18hs)

### Track A · On-chain (sugerido: Franco)

- ✅ **A-01** `contracts/src/AddieEscrow.sol` (~80 LoC) con `lock(placementId, payee, amount)`, `release(placementId)`, `refund(placementId)` + eventos `Locked`/`Released`/`Refunded` — deps: P0-03
- ✅ **A-02** Tests Foundry happy path + reverts en `contracts/test/AddieEscrow.t.sol` — deps: A-01
- ✅ **A-02b** Audit gate de `AddieEscrow.sol` antes de FF a `main` y de A-03: correr `/security-review` sobre el diff de `track/a-onchain`. Checklist (lo que el gate **debe** cubrir cada corrida):
  - **Reentrancy** en `lock` / `release` / `refund` — CEI antes de cualquier external call; payee y token maliciosos.
  - **Access control** — `release` / `refund` `onlyOwner`, owner `immutable`, sin proxy / upgradeability.
  - **State machine** `None → Locked → {Released, Refunded}` terminal — sin double-release, double-refund ni replay de `placementId`.
  - **ERC20 return values** chequeados con `require(...)` (o `SafeERC20` si se cambia el token / se agrega soporte multi-token).
  - **Constructor invariants** — zero-address checks en `owner_` y `usdc_`.
  - **ETH handling** — sin `payable` / `receive` / `fallback` (USDC-only).
  - **`placementId` front-running / squatting** — impacto griefing-only aceptable; re-evaluar si el id deja de ser unguessable.
  - **USDC quirks** — fee-on-transfer / rebasing n/a en Base mainnet hoy; re-evaluar si se cambia el token.
  - **Arithmetic** — Solidity 0.8+ built-in checks.
  - **Signatures / replay** — n/a hoy; re-evaluar si se introduce EIP-712 (mandate signing, etc.).

  Si findings críticos → fix + `forge test` verde + re-audit. Si clean o nits → FF cierre de A-01 + A-02 + A-02b a `main`. **Mismo gate aplica a todo cambio futuro de `AddieEscrow.sol`.** — deps: A-02
- ✅ **A-03** `contracts/script/Deploy.s.sol` + deploy a Base mainnet @ [`0x8300B9Bd1B6a18163EBd5fB9e0EFa1b7Fd99bCfE`](https://basescan.org/address/0x8300B9Bd1B6a18163EBd5fB9e0EFa1b7Fd99bCfE) (verified, owner `0x7e6685A241278d83068f8Cfb0Dd145F62cb17914`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- ✅ **A-04** `[INFRA]` Anotar address del contrato deployed en `apps/web/src/lib/chain/escrow.ts` como const + verificar en basescan — deps: A-03
- ✅ **A-05** `apps/web/scripts/seed-wallets.ts` — generó **5 Privy smart wallets** (4 brands: CafetITO `0x7529…2099` / TermoFlex `0x599e…EA25` / Pancho Rex `0xad1b…FA88` / MateBros `0x96D2…087D` + streamer-team `0x8B0d…374c`) y persistió addresses en `accounts` con `metadata.privy_wallet_id`. Idempotente (re-run → skip). Mismo patrón que `db-migrate.mjs` (pg directo + `POSTGRES_URL_NON_POOLING`). La platform owner (`0x7e6685A241278d83068f8Cfb0Dd145F62cb17914`) NO se genera vía Privy — es owner inmutable de `AddieEscrow`.
- ✅ **A-06** `[INFRA]` 4 brand wallets fondeadas con 5 USDC + 0.0001 ETH c/u vía `apps/web/scripts/fund-brands.mts` (idempotente, lee balances + skipea brands sobre threshold; reusa Foundry keystore `addie-treasury` extraída one-shot a `OWNER_PRIVATE_KEY` env var). Owner post: ~10 USDC + 0.00164 ETH. Streamer-team intencionalmente sin fondos. **Audit**: CafetITO USDC [`0x208641…`](https://basescan.org/tx/0x20864169e828054ff04565999dccf682a4832ea9d02906fe52bcae4c10e0ef16) · TermoFlex USDC [`0xeedc36…`](https://basescan.org/tx/0xeedc367dade38415c284d6e95b37668e62038bfdc701d112c47b6a1e174ae0d4) + ETH [`0xa1d232…`](https://basescan.org/tx/0xa1d232e8c64daeef8490b617f18be35f1ee25fc5f13c25958a80b68e3de1d250) · Pancho Rex USDC [`0x66a19d…`](https://basescan.org/tx/0x66a19dc871a4fc284a3a439abf5c43027b6aa157e8ac9e889973145bf0220feb) + ETH [`0x6c8c5e…`](https://basescan.org/tx/0x6c8c5e99f922b0f63041968f4e7c59814ced9547b064395adcf7082c76fde161) · MateBros USDC [`0x99264f…`](https://basescan.org/tx/0x99264f7994c89ab6d999ba3d6e74fbac5c2a8a29c7108dfc82a2e4e8cede21c3) + ETH [`0x2bafb8…`](https://basescan.org/tx/0x2bafb8570fa3c729290aa0fc9703731cfe71349ecb000dddba29936c691c6081). CafetITO ETH ya tenía 0.0001 (Privy creation), no requirió tx. — deps: A-05, P0-20, P0-21
- ✅ **A-07** Cliente viem en `apps/web/src/lib/chain/viem.ts` (publicClient + walletClient factory por brand) — deps: A-04
- ✅ **A-08** Bindings escrow en `apps/web/src/lib/chain/escrow.ts` (`lockEscrow`, `releaseEscrow`, `refundEscrow`, watchers de eventos) + helper `approveUsdcForEscrow` (USDC approve para que la brand wallet pueda hacer `transferFrom` desde el lock) + smoke `apps/web/scripts/smoke-escrow.mts` que valida ABI/RPC contra Base mainnet (verificado: owner/usdc/placements). — deps: A-07
- ✅ **A-09** Helper Privy server-side en `apps/web/src/lib/chain/privy.ts` — `getBrandWallet(slug)` + `getBrandWalletClient(slug)` (factoría de viem WalletClient vía `createViemAccount` de `@privy-io/server-auth/viem`) + wrappers `signApproveUsdc` / `signLockEscrow`. Smoke `apps/web/scripts/smoke-privy-sign.mts` (`pnpm smoke:privy`) verifica end-to-end: lookup → sign EIP-191 → recover address matches `accounts.wallet_address` → read USDC allowance contra Base mainnet (gas-free). Solo cubre brand wallets — la owner key (release/refund) no vive en Privy, va a usar `privateKeyToAccount` cuando esa firma haga falta. — deps: A-05, A-07
- ✅ **A-10** Componente `TxFeed` (`apps/web/src/components/demo/TxFeed.tsx`) escuchando eventos on-chain con links a basescan via `watchEscrowEvents`. Client Component standalone — `useEffect` subscribe en mount, unwatch en unmount. Cap configurable (`maxItems`, default 20), backfill opcional (`fromBlock`), labels por address (`addressLabels`) para mostrar brand names en lugar de hex truncado. Cada row: icono + tipo (LOCK/RELEASE/REFUND) + counterparty + monto USDC formateado + hash truncado clickeable a `basescan.org/tx/<hash>`. Animaciones framer-motion (entrada slide-down) consistentes con `DemoDisplay`. — deps: A-08, P0-02
- ✅ **A-11** `[INFRA]` Sincronizadas las 4 env vars de runtime del Track A en Vercel (Production + Preview + Development): `ALCHEMY_RPC_URL`, `PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`. Redeploy a prod hecho — verificado HTTP 200 en `/`, `/o/coscu-test`, `/api/auth/get-session` + 307 en `/dashboard` unauth. El team puede bajar el set completo con `cd apps/web && vercel env pull .env.local`.
- ✅ **A-12** Kill-switch `CHAIN_LIVE_TXS` (default `false`) bloquea broadcast on-chain en 4 wrappers: `signApproveUsdc` + `signLockEscrow` (privy.ts) y `releaseEscrow` + `refundEscrow` (escrow.ts). Helper en `apps/web/src/lib/chain/env.ts` (`isChainLiveTxsEnabled` / `assertChainLiveTxsEnabled`) — acepta `true|TRUE|1|yes|on` (case-insensitive, trim); cualquier otra cosa o unset → false. Error claro: `"CHAIN_LIVE_TXS=false — broadcast blocked (A-12 kill-switch). Set CHAIN_LIVE_TXS=true to enable on-chain writes."`. Smoke `pnpm smoke:killswitch` (sin red, 15/15 pass) cubre el helper + integration de los 4 wrappers (cortan antes de tocar Privy/Supabase). Scripts admin (`fund-brands.mts` usa `transfer` directo + `Deploy.s.sol` es Solidity) NO pasan por estos wrappers, no afectados. Var agregada a `.env.example` con default `false`. Se flippea a `true` en F-05 (A-12b queda armado para removerlo). — deps: ninguna
- ⬜ **A-12b** Remover el kill-switch `CHAIN_LIVE_TXS` (delete A-12) en F-05 cuando arranquemos el ensayo final del demo. Quitar las guard checks de privy.ts + cualquier wrapper de owner. Confirmar con el team antes de mergear (es el momento donde el sistema empieza a mover plata real en cada lock). — deps: A-12, F-05

### Track B · Pipeline (sugerido: Lucas)

> **POC funcionando en `poc/pipeline/`** ([branch `track/b-pipeline`](../../tree/track/b-pipeline/poc/pipeline)). B-01..B-07 + B-07b + B-12 verificados end-to-end con OBS + voz humana real. **Track B cerrado salvo audit clip (B-08..B-11) que es post-MVP**. Falta portear a `apps/web/` cuando arranque esa fase: la lógica de cada módulo se reusa tal cual, solo cambia el host (Express POC → Next.js route handlers; chunkWriter ya escribe directo a Supabase con stream_id NULL, hay que llenar el FK al crear fila en `streams`).
>
> **Contrato con Track C — Andy lee esto antes de arrancar C-08m / C-08:**
> - **Pull (cada 30-60s, sin LLM)**: `SELECT * FROM context_chunks WHERE stream_key = X ORDER BY ts_start DESC LIMIT 1`. Cada row tiene audio_text + scene + mood + on_screen_text + chat_velocity_avg/peak + chat_recent_keywords + sentiment_avg + viewers + game_category + stream_title.
> - **Push (cada 1s, latencia <1s)**: `supabase.channel('context:<stream_key>').on('broadcast', { event: 'tick' }, ...)`. El payload del tick crudo incluye los mismos campos pero con velocity_now (5s window), audio_partial actual, frame fresco. Sin scoring derivado — el manager-worker decide si gastar LLM.
> - Schema completo y código de ejemplo en [`poc/pipeline/README.md`](./poc/pipeline/README.md#contrato-con-track-c-agents--andy).

- ✅ **B-01** docker-compose con nginx-rtmp + puertos. POC en [`poc/pipeline/docker-compose.yml`](./poc/pipeline/docker-compose.yml). Record desactivado en POC — lo re-habilita B-08 con permisos de volume mount correctos.
- ✅ **B-02** `nginx-rtmp.conf` con `application live` + webhooks `on_publish`/`on_publish_done` + **`worker_processes=1`** (con auto-workers `/stat` devuelve datos inconsistentes entre workers). POC en [`poc/pipeline/nginx-rtmp.conf`](./poc/pipeline/nginx-rtmp.conf). En `apps/web/` los webhooks van a apuntar a `apps/web/src/app/api/stream/*` con `host.docker.internal:3000`.
- ✅ **B-03** Endpoint `POST /api/stream/on-publish` (Express en POC) que crea sesión y arranca orchestrator (polling `/stat` cada 1s + audio pipe en paralelo). POC en [`poc/pipeline/src/server.ts`](./poc/pipeline/src/server.ts) + [`orchestrator.ts`](./poc/pipeline/src/orchestrator.ts). Falta swap a route handler de Next.js + crear fila en `streams` (Supabase). — deps: B-02, P0-04
- ✅ **B-04** Audio pipe: `ffmpeg` child_process → 16kHz PCM mono → ElevenLabs **Scribe v2 realtime** WS (VAD auto-commit, lang `es`, soporte de keyterms para slang argentino), transcript rolling 30s + partial actual. Verificado end-to-end con OBS + voz humana: capturó `"¿Dónde va a ir? ¿Va, va a parar?"` con tildes y signos invertidos correctos. POC en [`poc/pipeline/src/transcribe.ts`](./poc/pipeline/src/transcribe.ts). — deps: B-03, P0-10
- ✅ **B-05** Vision pipe: ffmpeg long-lived que pulla el RTMP y tira N JPEGs/seg concatenados a stdout, parser SOI/EOI markers, cola tamaño 1 (descarta intermedios si el modelo está procesando). LLM call con **Vercel AI Gateway + Gemini 2.5 Flash** (model como string `'google/gemini-2.5-flash'`, NO hace falta `@ai-sdk/google`). Schema Zod agnóstico al contenido: `scene_type` (libre), `energy_level` (calm/medium/high/epic), `mood_tags` (max 5), `on_screen_text`, `summary`. Prompt explícito para NO asumir gaming. POC en [`poc/pipeline/src/frame.ts`](./poc/pipeline/src/frame.ts). — deps: B-03, AI_GATEWAY_API_KEY (P0-08 reemplazado por gateway de Vercel)
- ✅ **B-06** Twitch chat: tmi.js anonymous IRC al canal de Twitch (TWITCH_CHANNEL). Buffer rolling de mensajes en memoria, ventanas configurables velocity (5s default) y keywords (30s), baseline aprendido en los primeros 60s. Calcula `velocity_now/avg/peak/baseline`, `recent_keywords` (top N con tokenizer + stopwords ES/EN), `sentiment` heurístico (positive/neutral/negative/hype) con listas curadas de palabras y emotes. Read-only sin auth. POC en [`poc/pipeline/src/chat.ts`](./poc/pipeline/src/chat.ts). — deps: P0-15
- ✅ **B-07** Context broadcaster: en cada tick (1s), broadcast a Supabase Realtime channel `context:<stream_key>` con el payload completo crudo (audio + frame + chat + twitch). Sin scoring derivado — el manager-worker decide si gastar LLM. POC en [`poc/pipeline/src/realtimeBus.ts`](./poc/pipeline/src/realtimeBus.ts). Falta swap del `stream_key` por `stream_id` UUID cuando se portee a apps/web. — deps: B-04, B-05, B-06, P0-12
- ❌ **B-07a** ~~Salience scorer en pipeline orchestrator~~ — **DEPRECATED 2026-05-09 post-B-07c.** El audio summary IA por chunk reemplaza el `cheap_intensity` numérico con señal **semántica** (más útil + interpretable + sin pesos para tunear). El manager-worker (C-08m) filtra ahora con `audio_intent IN ('reaction','recommendation') OR audio_mentions.length > 0 OR viewers_delta_30s > 100` + cooldown 30s post-auction — ver C-08m updated. Sin necesidad de heurística numérica brittle.
- ✅ **B-07b** Chunk writer + Twitch Helix metrics + persistencia en `context_chunks`. **Complementa B-07** (no lo reemplaza): mientras B-07 broadcastea cada 1s al Realtime channel para el manager-worker, B-07b consolida cada 30s y persiste en DB para que los brand-agents pollen + audit trail post-stream. Migration en [`supabase/migrations/0005_context_chunks.sql`](./supabase/migrations/0005_context_chunks.sql), módulos en [`poc/pipeline/src/chunkWriter.ts`](./poc/pipeline/src/chunkWriter.ts) + [`twitch.ts`](./poc/pipeline/src/twitch.ts). Twitch Helix usa Client Credentials grant (gratis, 800 req/min) para `viewer_count + game_name + title`. — deps: B-04, B-05, P0-12
- ✅ **B-07c** **Audio summary IA por chunk.** Pre-procesa el `audio_text` de cada ventana de 30s con Gemini Flash-Lite (provider directo Google AI Studio, no AI Gateway) ANTES del INSERT a `context_chunks`, y persiste 4 columnas nuevas: `audio_summary` (1-2 oraciones es-AR), `audio_topics[]` (categorías amplias tipo `["fútbol","cerveza"]`), `audio_mentions[]` (entidades concretas tipo `["Quilmes","Messi"]`), `audio_intent` (enum `discussion|recommendation|complaint|question|reaction|silence`). **Reemplaza B-07a** — los brand-agents y el manager-worker filtran sobre estos campos semánticos en lugar de re-procesar el transcript crudo. Migration en [`supabase/migrations/0008_audio_summary.sql`](./supabase/migrations/0008_audio_summary.sql), módulos en [`poc/pipeline/src/audioSummary.ts`](./poc/pipeline/src/audioSummary.ts) + [`aiModel.ts`](./poc/pipeline/src/aiModel.ts) (decide entre `GEMINI_API_KEY` directo y AI Gateway). Smoke test [`scripts/smoke-summary.ts`](./poc/pipeline/scripts/smoke-summary.ts) capturó 4/4 entidades en transcript fake con voseo argentino. **Heads up Track C:** `FRAME_FPS` bajado a 0.5 (1 frame cada 2s) para caber en 15 RPM del free tier de Google AI Studio cuando suma frame analysis + audio summary. — deps: B-07b
- ⬜ **B-08** **Audit clip · scope reducido 2026-05-09**: ffmpeg long-lived que escribe el stream a 4 segmentos rotativos de 5s cada uno (`-f segment -segment_time 5 -segment_wrap 4`) → siempre tenés los últimos 15-20s en disco sin necesidad de cron cleanup. Vive como `poc/pipeline/src/recorder.ts`, arrancado por el orchestrator junto con transcribe/frame/chat. **Reemplaza** la idea original de re-habilitar `record on` de nginx-rtmp (más control + menos permission pain con volume mounts). — deps: B-02, B-03
- ❌ **B-09** ~~ffmpeg cliprange T-10s..T+20s~~ — **DEPRECATED 2026-05-09.** El scope se redujo a "últimos 10s del stream" (no T-10..T+20). El concat de los 2 segmentos rotativos más recientes lo hace `auditClip.ts` directamente — no se necesita cliprange separado.
- ❌ **B-10** ~~ffmpeg overlay ad+QR~~ — **DEPRECATED 2026-05-09.** El audit clip ahora es solo el highlight del stream del creator (10s) — sin overlay del ad encima. La marca igual ve qué pasaba en el momento del placement, que es lo que importa para auditoría. Si en el futuro queremos "ad sobre stream" para promo material, se reactiva como B-10b.
- ⬜ **B-11** **Endpoint `POST /api/audit/clip` + Vercel Blob upload.** Recibe `{ stream_key, placement_id, duration_s? }`, ffmpeg concat los 2 segmentos rotativos más recientes (10s del stream del creator), sube a Vercel Blob si `BLOB_READ_WRITE_TOKEN` está cargada, fallback a `/tmp/addie-clips/` local si no. Devuelve `{ clip_url, size_bytes, duration_s, source: 'vercel-blob' | 'local' }`. apps/web (C-14) hace el POST después del INSERT a placements y después UPDATE-ea `placements.clip_url`. Vive como `poc/pipeline/src/auditClip.ts` + handler en `server.ts`. — deps: B-08, P0-14 (Andy)
- ✅ **B-12** `POST /api/stream/on-publish-done` cierra polling, mata ffmpeg, cierra WS de ElevenLabs, loggea resumen (duración + total_bytes_in). POC en [`poc/pipeline/src/server.ts`](./poc/pipeline/src/server.ts) + [`orchestrator.ts`](./poc/pipeline/src/orchestrator.ts). Falta swap a route handler de Next.js + cerrar fila en `streams`. — deps: B-03

### Track C · Agents (sugerido: Andy)

- ✅ **C-01** Tipos comunes (`Mandate`, `BrandAgentDecision`, `NegotiationTurn`, `StandingOffer`, `SoftHold`) en `apps/web/src/lib/agents/types.ts`
- 🟡 **C-02** Mandate templates YAML en `apps/web/src/lib/agents/brands/*.yaml` + loader. **MVP scope reducido a 2 brands** (adidas + mp, ver P0-22). Loader tiene que parsear el nuevo `prompt` field de `BrandPrompt` (ver `apps/web/src/lib/agents/types.ts`) — system_persona / voice_examples / dont_say / dont_do — y el seed-mandates.ts (C-06) inserta en `mandates.prompt` jsonb (columna nueva, migration `0005_mandates_prompt.sql`). — deps: P0-22, C-01
- ⬜ **C-02b** Extender `BrandMandate` (types.ts) + YAML schema con campos opcionales para gate ladder: `event_filters` (required_any_tag, preferred_categories, min_viewers, required_chat_keyword_any), `brand_safety` adicional (blocked_categories, blocked_competitor_brands), `dayparts.active`, `ideal_contexts[]` (free-text para embeddings de gate2). Backwards-compatible — si los campos no existen, el gate correspondiente se saltea. Spec en `docs/GATES.md §3`. — deps: C-02
- ⬜ **C-02c** Stream metadata schema + loader para `apps/web/src/lib/streams/<stream_id>.yaml` (categorías del stream, audience profile, tags activos del momento). Lo consume gate1 al match contra `event_filters` del brand. Spec en `docs/GATES.md §5`. — deps: C-02b
- ⬜ **C-02d** **Calibrar** los 4 mandates fictional (CafetITO/TermoFlex/Pancho Rex/MateBros) + streamer-team mandate al **formato meta-streaming del pitch de 3 min** (ver `docs/PITCH.md` Bloque 3 + `docs/DEMO_RUNBOOK.md`). Ajustar `event_filters.required_any_tag`, `dayparts.active`, `target_moods` para que las trigger words ensayadas (ÉPICO/CLUTCH/TRANQUI/FOGÓN) produzcan al menos 2 matches de marcas distintas durante los 85s del Bloque 3. CafetITO debe matchear con `mood: high_energy`, MateBros con `mood: casual_chat`; Pancho Rex y MateBros respectivamente skipean en cada momento para mostrar el matcher win-win. Stream metadata se calibra al canal Twitch del equipo (no al de un talento externo). — deps: C-02b, C-02c, PD-07b
- ⬜ **C-02e** Renombrar los YAMLs reales (adidas/nike/quilmes/mp/etc.) a las marcas fictional del demo: `cafetito.yaml` (premium episodic), `termoflex.yaml` (`always_bid_floor: true` default bidder, ex-mp), `pancho-rex.yaml` (niche lunch/late), `matebros.yaml` (community/casual_chat). Mandates con personality humorística. Mantener el shape — solo cambian display_name + tracking_url + persona + `target_moods/avoid_moods`. Ver `docs/PITCH.md` Bloque 3 + `docs/GATES.md §4`. — deps: C-02
- ✅ **C-03** Migración `0002_inventory.sql` (zonas, floors, max_duration por creator) — deps: P0-04
- ✅ **C-04** Migración `0003_ads.sql` (tabla `ads` ver §5 DESIGN.md) — deps: P0-04
- ✅ **C-05** Migración `0004_placements.sql` (tabla `placements` con audit fields: `clip_url`, `context_snapshot`, `agent_reasoning`, `negotiation_transcript`, `lock/release/refund_tx_hash`) — deps: P0-04
- ⬜ **C-06** `scripts/seed-mandates.ts` — inserta mandates + firma EIP-712 dummy por brand — deps: C-02, A-05
- ⬜ **C-07** `scripts/seed-inventory.ts` — inventario del creator demo — deps: C-03
- ⬜ **C-08** brand-agent runner (`apps/web/src/lib/agents/brand/`): instanciado por `/api/auctions/run` (NO subscribe al context channel — ver DESIGN.md §4 manager-worker es el subscriber). Prompt a Claude Haiku con mandate + balance + ads + market_signals + manager_decision, output `BrandAgentDecision` con `valuation_breakdown` auditable. — deps: C-01, C-02, P0-07
- 🟡 **C-08m** **Manager-agent worker** (`apps/manager-worker/`, ~30 LoC). Proceso Node standalone que se subscribe a `context_chunks` via Supabase realtime postgres_changes (`{ event: 'INSERT', table: 'context_chunks' }`) — **NO al tick channel de 1s**. Filtra **semánticamente** sobre los campos del audio summary que B-07c populó: `audio_intent IN ('reaction','recommendation') OR audio_mentions.length > 0 OR viewers_delta_30s > 100`, + cooldown 30s post-auction. Si pasa el filtro, llama `managerDecide()` (Claude Haiku — `apps/web/src/lib/agents/manager/decide.ts`), y POSTea `/api/auctions/run` con `{ chunk, manager_decision }`. Fail-closed si LLM falla. **Cambio post-B-07c:** chunk-based en lugar de tick-based — el manager toma decisión cada 30s en lugar de cada 1s, lo cual es semánticamente correcto (un brand no quiere bidear sobre 1s aislado, quiere bidear sobre un momento de 30s). Ver DESIGN.md §4 Tres agentes + Event flow. — deps: B-07c, C-14, P0-07, P0-12
- ⬜ **C-08a** **Gate1 — mandate determinístico** (`apps/web/src/lib/agents/brand/gates/gate1Mandate.ts`). Función pura que recibe `(BrandMandate, StreamMetadata, ContextTick)` → `{ pass: boolean, skip_reason?: GateSkipReason }`. Chequea `event_filters` (required_any_tag, preferred_categories, min_viewers, required_chat_keyword_any), `dayparts.active`, `brand_safety.blocked_keywords` contra `audio_30s/recent_keywords`, `blocked_competitor_brands` contra brands ya pautadas en últimos 5 min. Bypass para brands con `always_bid_floor: true` (skip gate2/3/4). Emite `GateSkipReason` con `human_message` es-AR. ~100 LoC, sin LLM. Spec en `docs/GATES.md §2-§3`. — deps: C-02b, C-02c
- ⬜ **C-08b** **Gate2 — embedding similarity** (`apps/web/src/lib/agents/brand/gates/gate2Embeddings.ts`). Función `(BrandMandate.ideal_contexts[], ContextTick.audio_30s + frame_summary) → cosine_score`. Embeddings vía API (OpenAI `text-embedding-3-small` ~$0.00002/embed o Gemini `text-embedding-004` free tier). Cache de embeddings de `ideal_contexts` (no cambian) en memoria; embed del contexto fresh cada tick (~10ms). Threshold configurable por mandate (`gate2_min_similarity`, default 0.65). Decision: pgvector vs in-memory ANN — para 4 brands × 3 ideal_contexts = 12 vectores, in-memory es trivial. Marcar como tech-debt revisitar si crece. Spec en `docs/GATES.md §2`. — deps: C-08a, P0-07
- ⬜ **C-08c** **Gate3 — Haiku triage** (`apps/web/src/lib/agents/brand/gates/gate3Haiku.ts`). Llamada barata a Claude Haiku con prompt mínimo: `{mandate.persona, recent_context, gate2_similarity}` → `{should_proceed: bool, skip_reason?: string}`. ~150 tokens IN, ~50 tokens OUT, ~$0.0008 por call, ~200ms p95. Lo importante es filtrar momentos que el embedding aprueba pero no calzan en voice/persona del brand (ej. CafetITO premium en clutch épico que también tiene chat tóxico). Spec en `docs/GATES.md §2`. — deps: C-08b, P0-07
- ⬜ **C-08d** **Gate4 — Sonnet decision integration**. Modificar `huntForBrand()` (C-08) para que reciba `gate1_pass + gate2_score + gate3_reasoning` como context al prompt de Sonnet. Sonnet ahora solo se llama si los 3 gates anteriores pasaron — emite `BrandAgentDecision` con bid + opening_message. Logging del path de gates en `agent_reasoning` para audit. Spec en `docs/GATES.md §2 + §6`. — deps: C-08, C-08c
- ⬜ **C-09** streamer-agent runner (`apps/web/src/lib/agents/streamer/`): recibe ofertas, evalúa contra mandate del creator, contraoferta o accept — deps: C-01, P0-07
- ⬜ **C-10** Negotiation orchestrator (`apps/web/src/lib/agents/negotiation/`): subasta multi-turno paralela, 3 turnos cap, **5s hard deadline**, standing offers actualizadas turno a turno — deps: C-08, C-09
- ⬜ **C-11** Soft hold ledger off-chain en memoria (`apps/web/src/lib/agents/negotiation/holds.ts`): refresca holds cada turno, expone `available_balance = on_chain - Σ(holds_propios)` al LLM — deps: C-10, A-08
- ⬜ **C-12** Settlement engine: al T+5s pickea **single winner** mejor standing ≥ floor a través de TODAS las zonas competidoras (single-ad-per-moment §4), fallback a default bidder si nadie pasa el floor, fallback a runner-up si lock falla — deps: C-10, C-11, A-08
- ⬜ **C-13** Default bidder al floor para mp (`always_bid_floor: true`): siempre emite floor offer si el contexto no es brand-unsafe; garantiza fill cuando ningún brand premium bidea — deps: C-08
- ✅ **C-13a** **Event broadcast foundation** — pattern reusable de "API POST → row en `render_events` table + pg `NOTIFY` → SSE handler hace `LISTEN` y push al iframe del creator". Pivot desde Supabase Realtime broadcast a SSE + pg LISTEN/NOTIFY (decisión 2026-05-09): queremos audit trail + capa de logic intermedia. Implementado: migration `0007_render_events.sql` + `POST /api/creators/[creator_id]/render` + `GET /api/creators/[creator_id]/stream` (SSE) + `/o/[creator_id]` iframe page + `apps/web/src/lib/pg.ts` shared pool. Verificado live en prod (curl POST → SSE receives). MVP: solo `message` text. C-14 lo reusa con `{ asset_url, asset_type, duration_ms, zone, ... }` cuando los assets en S3 estén. — deps: P0-12
- ⬜ **C-14** Endpoint `POST /api/auctions/run` que recibe `{ tick, manager_decision }` del manager-worker y corre la subasta sincrónica (~5-8s): `computeMarketSignals(tick)` → 8 brand-agents `huntForBrand()` paralelo → orchestrator multi-turno con AC_combi + curva de concesión → `pickWinner()` → INSERT placements → `escrow.lock()` → llama `POST /api/creators/[creator_id]/render` (C-13a) con asset metadata para emitir el placement al iframe del creator. Durante la subasta, broadcast `auction:<auction_id>:turn` por cada turno para el demo display (también vía C-13a pattern, channel separado). — deps: C-10, C-12, C-13a
- ⬜ **C-15** Brand-safety listener (`apps/web/src/lib/agents/safety/`) que monitorea audio + chat durante el render y dispara `escrow.refund` si hay keyword pull — deps: C-14, A-08, B-04, B-06
- ⬜ **C-16** Persistir audit metadata al settlement: `agent_reasoning` (output LLM ganador) + `negotiation_transcript` (todos los turnos) + `winning_offer` en `placements` — deps: C-14, C-05
- ⬜ **C-17** QR generator server-side + endpoint `GET /api/q/[placement]/route.ts` que redirige a `tracking_url` y registra el scan — deps: C-05

### Track D · UI (sugerido: Jere)

- ✅ **D-01** Browser Source overlay `apps/web/src/app/overlay/[id]/page.tsx`: `<video autoplay>` + `<img class="qr-corner">` + framer-motion fade-in — deps: P0-02
- ⬜ **D-02** PlacementRenderer component que consume placement events vía Supabase Realtime y renderiza — deps: D-01, C-14
- ✅ **D-03** Browser Dock `apps/web/src/app/dock/page.tsx`: balance del creator + recent placements + hotkeys (FORCE EVENT, FULL BREAK) — deps: P0-02, A-08
- ✅ **D-04** Inventory editor `apps/web/src/app/settings/inventory/page.tsx` (CRUD zonas/floors/max_duration) — deps: P0-02, C-03
- ✅ **D-05** Preferences `apps/web/src/app/settings/preferences/page.tsx` (brands aprobadas, brand-safety keywords) — deps: P0-02
- ✅ **D-06** Brand console `apps/web/src/app/brands/[brandId]/page.tsx`: saldo, library viewer, mandate editor, performance stats — deps: P0-02, C-04, A-05
- ⬜ **D-07** Ad uploader `apps/web/src/components/brands/AdUploader.tsx` (form + Vercel Blob upload + insert en `ads`) — deps: D-06, P0-14, C-04
- ⬜ **D-08** Audit log panel en brand console: lista placements + `<video src={clip_url}>` + viewer JSON de `agent_reasoning` + transcript de negociación + export CSV/JSON — deps: D-06, C-05, B-11
- ✅ **D-09** Demo Display `apps/web/src/app/demo-display/page.tsx`: bid leaderboard + tx feed + negotiation chat con standing offers actualizándose en vivo — deps: P0-02, A-10, C-10
- ⬜ **D-09a** **Gate-skip didactic feed** en `/demo-display`: panel lateral que se subscribe al topic `auction:<auction_id>:gate-skip` y muestra cada decisión MATCH/SKIP de cada brand con su `human_message` en es-AR ("☕ CafetITO → SKIP gate1: este momento no es para mí, hoy no hay clutch"). Color por brand, ícono por gate (gate1 ⛔ / gate2 🧭 / gate3 🤔 / gate4 ✅). Esencial para que el jurado entienda visualmente el matcher win-win — ver `docs/DEMO_RUNBOOK.md` Acto 3 + `docs/PITCH.md` Bloque 4. — deps: D-09, C-08a, C-08b, C-08c, C-08d
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
- ⬜ **PD-07** Pitch slides (cold open caption + logo flash + 3 patas + cierre — 4 slides para 3 min)
- ⬜ **PD-07a** Asignar speakers a cada bloque de `docs/PITCH.md` (Bloque 1-5) y a cada rol de `docs/DEMO_RUNBOOK.md` (speaker principal + speaker secundario opcional + operador dashboard + operador stream/OBS). Reemplazar TBDs en ambos docs.
- ⬜ **PD-07b** Setup del meta-streaming: canal Twitch del equipo creado, viewer-bot pre-conectado posteando 2-3 msgs/s, **botón debug "Trigger context tick"** wirado en `/demo-display` (operador dispara manual si el sistema no produce match en 5s post-trigger word), 6 escenas OBS configuradas (`STREAM_LIVE`, `BRAND_CONSOLE`, `DASHBOARD_CENTER`, `SLIDE_3_PATAS`, `SLIDE_CLOSE`, `BACKUP_VOD`) según `docs/DEMO_RUNBOOK.md` Hardware/setup. Disparar C-02d apenas el setup esté listo. — deps: PD-07a
- ⬜ **PD-07c** Ensayar **trigger words** del Bloque 3 (ÉPICO/CLUTCH/TRANQUI/FOGÓN) con timing exacto: speaker dice la palabra con énfasis fuerte → 2s de silencio mirando dashboard → match aparece en log. 2 ensayos completos mínimo, midiendo tasa de match real. Si <80% de éxito, recalibrar mandates (C-02d). Grabar el ensayo 2 como **backup VOD** (`~/Desktop/addie-backup.mp4`) para el fallback nuclear. — deps: PD-07b, C-02d
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

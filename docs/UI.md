# UI — Track D execution spec

> Spec ejecutable por Claude Code. Cada tarea es self-contained: archivos, pasos, shapes, verificación.

- **Owner:** Jere ([@jeremybacher](https://github.com/jeremybacher))
- **Track:** D — UI · Branch: `track/d-ui`
- **Última actualización:** 2026-05-09 (T-27h al demo)
- **Refs:** [../CLAUDE.md](../CLAUDE.md), [../DESIGN.md §10 / §6 / §12](../DESIGN.md), [../TODO.md](../TODO.md)

---

## 0. Boot sequence — leer en orden antes de tocar nada

1. `../CLAUDE.md` — protocolo de claim (push-to-main lock)
2. `../TODO.md` — qué está libre, dependencias, claims activos
3. `../DESIGN.md` §10 (Track D scope), §6 (no runtime creative), §12 (demo plan)
4. Este doc: §2 (rules) → §4 (paths) → §5 (shapes) → tarea asignada

---

## 1. Claim protocol (obligatorio antes de programar)

```bash
git checkout main
git pull --rebase origin main
# editar ../TODO.md:
#   - estado del task: ⬜ → 🟡
#   - agregar fila a "Currently working on" (Jere · D-XX · scope · timestamp)
git add ../TODO.md
git commit -m "claim: Jere arranca D-XX — <scope corto>"
git push origin main      # push exitoso = lock adquirido
git checkout track/d-ui   # ahora sí, programar
```

Si el push falla por race: `git pull --rebase origin main` → resolver conflicto en la tabla → `git push origin main`.

**Cierre (cuando termina la tarea):**

```bash
git checkout track/d-ui
git pull --rebase origin main
# editar ../TODO.md: 🟡 → ✅, sacar fila de "Currently working on"
git add ../TODO.md
git commit -m "D-XX ✅: <scope>"
git checkout main
git pull --rebase origin main
git merge --ff-only track/d-ui
git push origin main
git push origin track/d-ui
```

---

## 2. Hard rules

### NO

- ❌ shadcn / Radix / HeadlessUI / Lucide
- ❌ SWR / React Query / zustand / jotai
- ❌ generar creatives en runtime (DESIGN.md §6)
- ❌ `--page` en superficies OBS (transparente only)
- ❌ floats para USDC (cents bigint en DB, dollars solo en render)
- ❌ `git push --force` a `main`
- ❌ `--no-verify` en commits
- ❌ commitear `.env*` o secrets

### SÍ

- ✅ Server components fetchean con `pg` vía `apps/web/src/lib/db.ts`
- ✅ Client state: `useReducer` (cero state-libs)
- ✅ Animación: **framer-motion** para mount/unmount + `AnimatePresence`, reusar `FADE_MS=300` de `PlacementOverlay`
- ✅ Animación: **[GSAP](https://gsap.com/)** cuando hace falta timeline secuenciada, stagger sobre N elementos, o coreografía teatral (demo display, replay mode). No usar GSAP para mount/unmount triviales — ahí pesa más framer-motion
- ✅ Realtime: SSE primero (patrón en `OverlayClient`), Supabase Realtime solo cuando SSE no alcanza
- ✅ Helpers de formato → `apps/web/src/lib/format.ts` (D-15)
- ✅ Brand metadata → `apps/web/src/lib/brands.ts` (D-14)
- ✅ FF-only merge a `main` por cada tarea ✅
- ✅ Mergear apenas terminás (no esperes al checkpoint)

---

## 3. Stack

| Pieza | Versión |
|---|---|
| Next.js | 16.2.6 (App Router, RSC) |
| React | 19.2.4 |
| Tailwind | 4 (PostCSS, sin config custom) |
| framer-motion | 12.38.0 — mount/unmount + `AnimatePresence` |
| GSAP | [gsap.com](https://gsap.com/) — timelines complejos, stagger, secuencias teatrales del demo display |
| Better Auth | 1.6.9 (email + password) |
| `@privy-io/server-auth` | 1.32.5 (deps presente, UI no integrada) |
| viem | 2.48.11 (read-only del Escrow) |
| `pg` | Supabase Postgres (`POSTGRES_URL_NON_POOLING`) |
| Fonts | Geist Sans + Geist Mono (`next/font`) |
| Component lib | **ninguna** — Tailwind crudo + SVG inline |

---

## 4. Path reference

### Rutas

| Path | Archivo | Auth | Estado | Rol en demo |
|---|---|---|---|---|
| `/` | `app/page.tsx` | público | ✅ | landing con cards |
| `/login` | `app/login/page.tsx` | público | ✅ | acceso del team |
| `/signup` | `app/signup/page.tsx` | público | ✅ | onboarding creators |
| `/dashboard` | `app/dashboard/page.tsx` | 🔒 | ✅ | hub creators |
| `/demo-display` | `app/demo-display/page.tsx` | público (`?demo=1`) | ✅ / 🟡 falta D-09a | **pantalla principal del demo** |
| `/dock` | `app/dock/page.tsx` | público (`?demo=1`) | ✅ / 🟡 PD-01/02 | OBS dock del streamer |
| `/overlay/[id]` | `app/overlay/[id]/page.tsx` | público | ✅ / ⬜ D-02 | overlay transparente OBS |
| `/o/[creator_id]` | `app/o/[creator_id]/page.tsx` | 🔒 | ✅ SSE texto | overlay alt vía SSE |
| `/settings/preferences` | `app/settings/preferences/page.tsx` | 🔒 | ✅ | brand approval + safety |
| `/settings/inventory` | `app/settings/inventory/page.tsx` | 🔒 | ✅ | zonas + floors |
| `/brands/[brandId]` | `app/brands/[brandId]/page.tsx` | público | ✅ / ⬜ D-07/08/20 | consola por brand |

### Componentes (todos en `apps/web/src/components/`)

| Archivo | Rol | Patrón a copiar |
|---|---|---|
| `LoginForm.tsx` / `SignupForm.tsx` | auth forms | Better Auth client |
| `DashboardClient.tsx` | sign-out | — |
| `ThemeProvider.tsx` / `ThemeToggle.tsx` | dark/light vía `data-theme` + `localStorage("addie-theme")` | `useSyncExternalStore` |
| `DockClient.tsx` | reducer placements + balance + feed + hotkeys | **patrón useReducer + mock `?demo=1`** |
| `DockWrapper.tsx` | server fetch inicial | `lib/db.ts` |
| `DemoDisplay.tsx` | leaderboard + chat + tx feed | **patrón AnimatePresence + [GSAP](https://gsap.com/) timelines** para coreografía teatral del demo |
| `TxFeed.tsx` | viem `watchEscrowEvents` + basescan link | `lib/onchain` |
| `BrandConsoleClient.tsx` | mandate + stats + ad library; tiene `BRAND_REGISTRY` (8 brands) | — |
| `SettingsNav.tsx` | tabs + theme toggle | — |
| `PreferencesClient.tsx` | brand checkboxes + safety keywords; tiene `ALL_BRANDS` (duplicado) | `POST /api/settings/preferences` |
| `InventoryClient.tsx` | zonas + floor + max duration + reducer | `POST /api/settings/inventory` |
| `PlacementOverlay.tsx` | `<video>`/`<img>` con fade `FADE_MS=300` por zona | **patrón animación overlay — huérfano hoy** |
| `OverlayClient.tsx` | `EventSource` a `/api/creators/[id]/stream`, badge connecting/open/error/closed; renderiza solo `message` (MVP) | **patrón SSE consumption** |

### Otros files clave

- `apps/web/src/lib/db.ts` — pool `pg`, helpers de query
- `apps/web/src/app/globals.css` — design tokens (CSS vars)
- `apps/web/src/app/api/creators/[id]/stream/route.ts` — SSE endpoint (postgres LISTEN/NOTIFY)
- `apps/web/src/app/api/creators/[id]/render/route.ts` — POST que dispara NOTIFY
- `apps/web/src/app/api/settings/{preferences,inventory}/route.ts` — upserts de settings
- `apps/web/src/app/api/brands/[brandId]/mandate/route.ts` — upsert mandate JSONB

---

## 5. Data shapes

```typescript
// SSE render event — apps/web/src/app/api/creators/[id]/stream/route.ts
// Hoy: solo { message, delivered_at }. D-13 lo extiende.
type RenderEvent = {
  message: string
  delivered_at: string
  // D-13+ extensions:
  zone?: 'lower_third' | 'corner' | 'fullscreen'
  asset_url?: string
  asset_type?: 'video' | 'image'
  duration_ms?: number
  qr_url?: string
}

// Realtime placement (D-02) — topic: `placements:${creator_id}`
type PlacementEvent = {
  placement_id: string
  zone: 'lower_third' | 'corner' | 'fullscreen'
  asset_url: string
  asset_type: 'video' | 'image'
  duration_ms: number
  brand_id: string
  qr_url?: string
}

// Gate-skip didactic (D-09a) — topic: `auction:${auction_id}:gate-skip`
type GateSkipEvent = {
  brand_id: string
  gate: 1 | 2 | 3 | 4
  decision: 'MATCH' | 'SKIP'
  human_message: string  // español
}

// Brand registry (D-14)
type Brand = {
  id: string                  // 'adidas' | 'nike' | 'quilmes' | 'mp' | 'steam' | 'rappi' | 'globant' | 'coca-cola'
  display_name: string
  brand_color: string         // hex
  logo_url: string
  default_persona: string
}

// Escrow events (Track A → TxFeed)
type EscrowEvent =
  | { type: 'Locked'; placementId: string; payer: \`0x${string}\`; amount: bigint }
  | { type: 'Released'; placementId: string; payee: \`0x${string}\`; amount: bigint }
  | { type: 'Refunded'; placementId: string; payer: \`0x${string}\`; amount: bigint }
```

### Design tokens (CSS vars en `globals.css`)

```
--page    dark #0a0a0f / light #f5f5ff   fondo página
--card    dark #111118 / light #ffffff   superficies
--card-2 / --card-3                       superficies anidadas
--line    dark #2a2a38 / light #d8d8ea   bordes
--text / --text-2..5                     jerarquía tipográfica
--p       #6366f1 (indigo)               brand primary
--a       #22d3ee (cyan)                 accent
--ok / --warn / --err                    estados
--usdc    #2775ca                        dinero on-chain
```

Transiciones de color en 0.15s ease, **excepto** elementos con `data-motion` (framer-motion).

---

## 6. Data contracts (qué le pedís a cada track)

| Fuente | Canal | Estado |
|---|---|---|
| Escrow (Track A) | viem `watchEscrowEvents` | ✅ live |
| Render events (Track C → UI) | SSE `/api/creators/[id]/stream` (LISTEN/NOTIFY sobre `render_events`) | ✅ live (texto) / ⏳ extender payload (D-13) |
| Settings save | `POST /api/settings/{preferences,inventory}` | ✅ live |
| Mandate save | `POST /api/brands/[brandId]/mandate` | ✅ existe, sin UI edit |
| Auction leaderboard | Realtime `auction:<id>` | ⏳ stub (mock `?demo=1`) |
| Negotiation transcript | `placements.negotiation_transcript` JSONB + Realtime | ⏳ stub |
| Gate-skip | Realtime `auction:<id>:gate-skip` | ⏳ depende C-08a..d |
| Pipeline context (Track B) | `context_chunks` table + Realtime tick | 🔄 POC |
| Audit clip | `placements.clip_url` (Vercel Blob mp4 30s) | ⏳ depende B-11 |
| Wallet balance | viem `readContract` USDC `balanceOf` | ⏳ no consumido (D-20) |
| Brand assets | Vercel Blob `ads.asset_url` | 🔄 tabla existe, pre-gen pendiente (D-10/D-11) |

---

## 7. Tasks — orden de ejecución

### D-15 · Helpers format · [XS] · deps: ninguna

**Por qué primero:** desbloquea D-08, D-13, D-20.

**Files:**
- crear `apps/web/src/lib/format.ts`
- editar `apps/web/src/components/DockClient.tsx`
- editar `apps/web/src/components/TxFeed.tsx`
- editar `apps/web/src/components/DemoDisplay.tsx`

**Steps:**
1. crear `lib/format.ts` con:
   - `formatUsdc(cents: bigint | number): string` → `"$12.34"`
   - `truncateAddress(addr: \`0x${string}\`): string` → `"0xabcd…ef01"`
   - `truncateTxHash(hash: \`0x${string}\`): string` → `"0xabcd…ef01"`
   - `basescanUrl(value: string, kind: 'address' | 'tx'): string`
2. grep `formatUsdc\|truncateAddress\|truncateTxHash\|basescan` en `apps/web/src/components/` y reemplazar inline-defs por imports
3. `pnpm typecheck`

**Acceptance:**
- `pnpm typecheck` ok
- `grep -rn "function formatUsdc\|function truncateAddress\|function truncateTxHash" apps/web/src/components/` → 0 matches
- `/dock`, `/demo-display`, `/brands/adidas` siguen rendering iguales

---

### D-14 · Brand registry · [S] · deps: ninguna

**Por qué:** elimina duplicado `BRAND_REGISTRY` (BrandConsoleClient) ↔ `ALL_BRANDS` (PreferencesClient). Habilita D-09a + D-12.

**Files:**
- crear `apps/web/src/lib/brands.ts`
- editar `apps/web/src/components/BrandConsoleClient.tsx`
- editar `apps/web/src/components/PreferencesClient.tsx`

**Steps:**
1. tomar `BRAND_REGISTRY` de `BrandConsoleClient.tsx` como source of truth (tiene los 8: adidas, nike, quilmes, mp, steam, rappi, globant, coca-cola)
2. crear `lib/brands.ts`:
   ```typescript
   export type Brand = { id: string; display_name: string; brand_color: string; logo_url: string; default_persona: string }
   export const BRANDS: readonly Brand[] = [...]
   export const getBrand = (id: string): Brand | undefined => BRANDS.find(b => b.id === id)
   ```
3. importar `BRANDS` / `getBrand` en ambos clients
4. eliminar `BRAND_REGISTRY` y `ALL_BRANDS` (si tienen shape distinta, normalizar al type `Brand`)

**Acceptance:**
- `pnpm typecheck` ok
- `grep -rn "BRAND_REGISTRY\|ALL_BRANDS" apps/web/src/` → 0 matches fuera de `lib/brands.ts`
- `/brands/adidas` y `/settings/preferences` siguen mostrando los 8 brands

---

### D-13 · Wire `PlacementOverlay` vía SSE · [S] · deps: D-15 (opcional)

**Por qué:** `PlacementOverlay.tsx` está construido pero huérfano. `OverlayClient` solo renderiza texto. Sin esto el overlay del demo no muestra videos. **Shim corto antes de D-02 (Realtime).**

**Files:**
- editar `apps/web/src/app/api/creators/[id]/render/route.ts` (extender payload del NOTIFY)
- editar `apps/web/src/app/api/creators/[id]/stream/route.ts` (passthrough del payload extendido)
- editar `apps/web/src/components/OverlayClient.tsx`

**Steps:**
1. extender el body del POST a `/render` para aceptar `{ message?, zone?, asset_url?, asset_type?, duration_ms?, qr_url? }`
2. el endpoint hace `pg_notify` con el payload completo (JSON)
3. el SSE pasa el payload tal cual al cliente (typed como `RenderEvent` de §5)
4. en `OverlayClient.tsx`: si `event.asset_url` está presente → render `<PlacementOverlay zone asset_url asset_type duration_ms />`; si no → fallback al `<div>{message}</div>` actual
5. importar `PlacementOverlay` (no recrear su animación)

**Acceptance:**
- `curl -X POST http://localhost:3000/api/creators/<id>/render -H 'content-type: application/json' -d '{"zone":"lower_third","asset_url":"https://example.com/test.mp4","asset_type":"video","duration_ms":8000}'` → el `<video>` aparece en `/o/<id>` con fade
- `pnpm typecheck` ok
- el path texto-only sigue funcionando si el POST manda `{message:"..."}`

---

### D-12 · Fallback CSS si falta `asset_url` · [S] · deps: D-13, D-14

**Por qué:** defensivo — si un ad no carga, el overlay no se ve roto.

**Files:**
- editar `apps/web/src/components/PlacementOverlay.tsx`

**Steps:**
1. agregar prop opcional `brand_id?: string`
2. si `!asset_url` o `<video>/<img>` dispara `onError` → render `<div>` con `background: getBrand(brand_id)?.brand_color`, logo SVG inline (de `lib/brands.ts`), display_name centrado
3. mantener el mismo `FADE_MS=300` y timing por zona

**Acceptance:**
- POST a `/render` sin `asset_url` pero con `brand_id:"adidas"` → overlay muestra fallback con `#000000` (color Adidas)
- POST con `asset_url:"https://broken.example/x.mp4"` → fallback dispara después de `onError`
- `pnpm typecheck` ok

---

### D-20 · Wallet display + basescan link · [XS] · deps: D-15

**Por qué:** DESIGN.md §10 lo lista, hoy `BrandConsoleClient.tsx` no lo renderiza.

**Files:**
- editar `apps/web/src/components/BrandConsoleClient.tsx`

**Steps:**
1. asumir que `accounts.wallet_address` está poblado (Track A — A-05)
2. en el header del brand console: `<a href={basescanUrl(walletAddress, 'address')}>{truncateAddress(walletAddress)}</a>` (ambos de `lib/format.ts`)
3. si `wallet_address` es null → mostrar `"⚠️ wallet not provisioned"`

**Acceptance:**
- `/brands/adidas` muestra `"0xab…cd"` con link a `https://basescan.org/address/0xab...cd`
- click abre en nueva tab
- `pnpm typecheck` ok

---

### D-10 · Pre-gen 32 ads script · [M] · deps: P0-10, C-04, P0-14

**Files:**
- crear `apps/web/scripts/pregen-brand-ads.ts`

**Steps:**
1. importar `BRANDS` de `lib/brands.ts` (D-14)
2. por cada brand × 4 variants:
   - construir prompt según `default_persona` + variant_name (ej. "epic_moment", "chill_break", "product_focus", "audience_chant")
   - llamar ElevenLabs Creative API (key en `ELEVENLABS_API_KEY`)
   - upload mp4/png/gif a Vercel Blob (`@vercel/blob` `put`)
   - `INSERT INTO ads (brand_id, variant_name, format, duration_ms, mood_tags, asset_url) VALUES (...)` vía `lib/db.ts`
3. log progreso por brand + retry simple (3 intentos por variant)

**Acceptance:**
- `pnpm tsx apps/web/scripts/pregen-brand-ads.ts` corre end-to-end
- `SELECT count(*) FROM ads;` → 32
- cada `asset_url` es una URL pública de Vercel Blob

---

### D-11 · Correr pre-gen sábado de noche · [XS] · deps: D-10

**Steps:**
1. setear env vars (`ELEVENLABS_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `POSTGRES_URL_NON_POOLING`)
2. `pnpm tsx apps/web/scripts/pregen-brand-ads.ts | tee tmp/pregen-$(date +%s).log`
3. validar `SELECT brand_id, count(*) FROM ads GROUP BY brand_id` → 8 rows × 4 cada uno

**Acceptance:**
- 32 rows en `ads` table, distribuidas 4 por brand
- todos los `asset_url` responden `200`

---

### D-02 · `PlacementRenderer` vía Supabase Realtime · [M] · deps: D-13, C-14

**Por qué:** upgrade de D-13 (SSE) a Realtime cuando C-14 esté listo.

**Files:**
- crear `apps/web/src/components/PlacementRenderer.tsx`
- editar `apps/web/src/app/overlay/[id]/page.tsx`

**Steps:**
1. en `PlacementRenderer.tsx`: cliente Supabase Realtime, suscribirse a topic `placements:${creator_id}`
2. payload entrante: `PlacementEvent` (§5)
3. delegar a `PlacementOverlay` con los props del event
4. fallback a `OverlayClient` (path SSE) si Realtime falla
5. en `/overlay/[id]/page.tsx`: usar `PlacementRenderer` en vez de `OverlayClient`

**Acceptance:**
- broadcast manual a `placements:test-creator` → overlay renderiza el ad
- killing Realtime → fallback SSE arranca sin reload
- `pnpm typecheck` ok

---

### D-09a · Gate-skip didactic feed · [M] · deps: D-09 ✅, D-14, C-08a..d

**Files:**
- editar `apps/web/src/components/DemoDisplay.tsx`

**Steps:**
1. cliente Supabase Realtime suscrito a `auction:${auction_id}:gate-skip` (`auction_id` viene como prop o `?auction=...`)
2. payload: `GateSkipEvent` (§5)
3. panel lateral en `DemoDisplay`: grid `brand × gate (1..4)`
4. cell coloreada con `getBrand(brand_id).brand_color`, ícono según gate (`⛔ 🧭 🤔 ✅`), `human_message` debajo
5. animación de entrada con [GSAP](https://gsap.com/) `stagger` cuando llega un batch de eventos (gate1→gate4 en cascada por brand). Para eventos sueltos posteriores, `gsap.from(cell, { scale: 0.8, opacity: 0, duration: 0.3, ease: "back.out(1.7)" })`

**Acceptance:**
- broadcast `{brand_id:"adidas", gate:1, decision:"SKIP", human_message:"audiencia no es target"}` → cell adidas/gate1 dibujada con color Adidas
- 32 cells (8 brands × 4 gates) renderizan sin layout shift
- batch entrante de 4 gates por brand entra con stagger visible (no todos a la vez)

---

### D-08 · Audit log panel en brand console · [L] · deps: D-15, B-11, C-05

**Files:**
- editar `apps/web/src/components/BrandConsoleClient.tsx` (o crear `BrandAuditLog.tsx` y mountarlo)

**Steps:**
1. server-fetch `SELECT * FROM placements WHERE brand_id = $1 ORDER BY delivered_at DESC LIMIT 50` vía `lib/db.ts`
2. por placement renderizar:
   - `<video src={clip_url} controls>` (ancho 320, fallback "clip pending" si null)
   - `<details><summary>reasoning</summary><pre>{JSON.stringify(agent_reasoning, null, 2)}</pre></details>`
   - transcript: lista de turnos en español de `negotiation_transcript`
   - tx refs: lock / release / refund con `truncateTxHash` + `basescanUrl(.., 'tx')`
   - métrica: `qr_scans` count
3. botones: "Export CSV" + "Export JSON" (descarga client-side via `Blob`)

**Acceptance:**
- `/brands/adidas` muestra al menos 1 placement con clip + reasoning + transcript + tx + qr_scans
- export CSV abre como tabla en Numbers/Excel
- `pnpm typecheck` ok

---

### D-07 · Ad uploader en brand console · [M] · deps: D-06 ✅, P0-14, C-04

**Si el tiempo aprieta, este es el primero que cae** (los 32 ads pre-gen ya cubren la demo).

**Files:**
- crear `apps/web/src/components/brands/AdUploader.tsx`
- editar `apps/web/src/components/BrandConsoleClient.tsx` (mount del trigger)
- crear `apps/web/src/app/api/brands/[brandId]/ads/route.ts` (POST)

**Steps:**
1. form con: `variant_name` (text), `format` (select: mp4/png/gif), `duration_ms` (number), `mood_tags` (chip input)
2. file input → `PUT` a Vercel Blob (`@vercel/blob/client` `upload`)
3. `POST /api/brands/[brandId]/ads` con metadata + `asset_url` → `INSERT INTO ads`
4. después del POST: refresh del ad library grid

**Acceptance:**
- subir un mp4 de 5MB → row nuevo en `ads`, aparece en grid sin reload
- validación: `format` mismatcheado con MIME del file → error inline

---

### PD-01 / PD-02 · Hotkeys dock · [polish] · deps: B-07, C-14

**Verificar (no implementar de cero):**

1. abrir `apps/web/src/components/DockClient.tsx`
2. confirmar que `FORCE EVENT` hace `POST` real al endpoint de pipeline (B-07) — no solo `dispatch` UI
3. confirmar que `FULL BREAK` hace `POST` al settlement engine (C-14)
4. si solo hay state UI: agregar el `fetch` real al handler

**Acceptance:**
- click FORCE EVENT → tick visible en logs del pipeline (Lucas confirma)
- click FULL BREAK → auction de `fullscreen_takeover` arranca en C-14 (Andy confirma)

---

### D-16 · Toast feedback al guardar settings · [S] · deps: ninguna

**Files:**
- crear `apps/web/src/components/Toast.tsx`
- editar `PreferencesClient.tsx` + `InventoryClient.tsx`

**Steps:**
1. `Toast.tsx`: single-instance, framer-motion fade in/out, props `{ kind: 'ok' | 'err'; message: string }`, auto-dismiss 2s
2. expose `useToast()` hook (context o `useSyncExternalStore`)
3. en ambos clients: después del `POST`, `toast.show({ kind: res.ok ? 'ok' : 'err', message: ... })`

**Acceptance:**
- save success → toast verde "Guardado" 2s
- save fail (mockear con devtools network throttle) → toast rojo

---

### D-17 · Empty + error states · [M] · deps: ninguna

**Files:**
- crear `apps/web/src/components/EmptyState.tsx`
- editar server pages: `app/brands/[brandId]/page.tsx`, `app/dock/page.tsx`, `app/demo-display/page.tsx`

**Steps:**
1. `EmptyState.tsx`: props `{ title, description, icon? }`
2. en cada server page: `try/catch` alrededor del fetch a `lib/db.ts`; en error → render `<EmptyState>` explícito (no hardcoded defaults)
3. branch para "0 rows": render `<EmptyState>` con CTA contextual

**Acceptance:**
- matar Postgres → cada page muestra mensaje claro, no "todo normal"
- `/brands/adidas` con 0 ads → empty state con "Subí el primer ad" link a D-07

---

### D-18 · Demo failure mode · [M] · deps: ninguna

**Files:**
- crear `apps/web/public/demo-fixtures/auction-replay.json`
- editar `apps/web/src/components/DemoDisplay.tsx`

**Steps:**
1. grabar 1 auction real → exportar JSON con timestamps relativos en `auction-replay.json`
2. en `DemoDisplay`: timer detecta inactividad >10s en Realtime → switch a fixture loop
3. orquestar el replay con un [GSAP](https://gsap.com/) `gsap.timeline()` que respete los timestamps relativos del fixture (`tl.add(eventFn, t / 1000)` por evento). Loop con `tl.repeat(-1)`. Pausar el timeline al volver a live
4. badge `"🟡 replay"` visible top-right durante el replay
5. si Realtime vuelve → `tl.kill()`, ocultar badge

**Acceptance:**
- desconectar Realtime → tras 10s arranca fixture loop con badge
- timeline respeta el spacing original (no se ven todos los eventos pegados)
- reconectar → live retoma sin reload, timeline killed

---

### D-19 · Verificación OBS Browser Source · [S] · deps: D-13

**Files:**
- crear `docs/OBS-SETUP.md` (cookbook con URLs + tamaños)

**Steps:**
1. abrir OBS Studio
2. agregar Browser Source con URL `http://localhost:3000/overlay/<creator_id>` + 1920×1080 + transparent
3. probar: scene-switch → EventSource reconecta? font renderiza? transparente real?
4. repetir para `/o/<creator_id>` y `/dock`
5. documentar URLs + tamaños + bugs encontrados en `docs/OBS-SETUP.md`

**Acceptance:**
- 3 URLs renderizan transparente en OBS
- scene-switch → SSE reconnect dentro de 3s
- doc cookbook con screenshots committeado

---

## 8. Demo-day checklist (T+0)

Correr **1h antes** del demo. Cualquier ítem en rojo → triage.

- [ ] `/overlay/[id]` carga transparente en OBS Browser Source (D-19)
- [ ] `/dock` FORCE EVENT dispara epic_moment real (PD-01)
- [ ] `/dock` FULL BREAK dispara auction fullscreen_takeover (PD-02)
- [ ] `/demo-display` leaderboard turn-by-turn (no solo `?demo=1`)
- [ ] `/demo-display` panel gate-skip MATCH/SKIP por brand (D-09a)
- [ ] `/brands/adidas` y `/brands/mp` muestran audit log con clip + JSON + tx (D-08)
- [ ] `TxFeed` muestra LOCK + RELEASE de la primera auction
- [ ] Theme toggle anda en `/dashboard` y `/settings`
- [ ] Fallback CSS dispara cuando un ad no tiene `asset_url` (D-12)
- [ ] 32 ads pre-gen en `ads` table (D-11)
- [ ] Demo failure mode armado (D-18)
- [ ] Basescan links abren correctamente (todos los `0x...`)

---

## 9. Cross-track deps

| Componente UI | Depende de | Track | Necesita |
|---|---|---|---|
| `BrandConsoleClient` (wallet) | A-05 + A-08 | A | `accounts.wallet_address` + `balanceOf` |
| `TxFeed` | A-09 | A | eventos `Locked/Released/Refunded` |
| `DemoDisplay` (leaderboard + chat) | C-10 | C | Realtime broadcasts standing offers |
| Gate-skip panel (D-09a) | C-08a..d | C | broadcast `auction:<id>:gate-skip` con `human_message` |
| `PlacementRenderer` (D-02) | C-14 | C | Realtime topic `placements:<creator_id>` con `asset_url` |
| Audit log (D-08) | B-11 + C-05 | B + C | `clip_url`, `agent_reasoning`, `negotiation_transcript` |
| Pre-gen ads (D-10) | C-04 + P0-14 | C + infra | persona/variants + ElevenLabs key |
| Hotkeys dock (PD-01/02) | B-07 + C-14 | B + C | endpoints `force` |

---

## 10. Comandos cheatsheet

```bash
# Dev
pnpm dev                                  # Next.js dev server
pnpm typecheck                            # tsc --noEmit
pnpm lint
pnpm tsx apps/web/scripts/<script>.ts

# Animación — instalar GSAP si todavía no está (revisar package.json antes)
pnpm --filter web add gsap                # https://gsap.com/docs/v3/Installation

# DB
psql "$POSTGRES_URL_NON_POOLING" -c "SELECT count(*) FROM ads;"
psql "$POSTGRES_URL_NON_POOLING" -c "SELECT brand_id, count(*) FROM ads GROUP BY brand_id;"

# Test render endpoint (para D-13)
curl -X POST http://localhost:3000/api/creators/<id>/render \
  -H 'content-type: application/json' \
  -d '{"zone":"lower_third","asset_url":"https://...","asset_type":"video","duration_ms":8000}'

# Verificación post-D-15
grep -rn "function formatUsdc\|function truncateAddress" apps/web/src/components/

# Verificación post-D-14
grep -rn "BRAND_REGISTRY\|ALL_BRANDS" apps/web/src/
```

---

## 11. Orden recomendado (camino crítico)

1. **D-15** helpers format · XS
2. **D-14** brand registry · S
3. **D-13** wire `PlacementOverlay` SSE · S
4. **D-12** fallback CSS · S
5. **D-20** wallet display · XS
6. **D-10 + D-11** pre-gen 32 ads · M (correr sábado de noche)
7. **D-02** PlacementRenderer Realtime · M (cuando C-14 esté)
8. **D-09a** gate-skip panel · M (cuando C-08* esté)
9. **D-08** audit log · L
10. **D-07** ad uploader · M (descartable si aprieta)
11. **D-16 / D-17 / D-18 / D-19** UX polish + failure mode + OBS · varios (antes de las 11:00 del domingo)

# AGENTS.md

Reglas y contexto para que cualquier agente (humano o LLM) pueda colaborar en este repo sin pisarse durante las 24h del hackatón.

## Qué es esto

**Addie** — agentic ad-tech para streams en vivo. Brand-agents pelean en lenguaje natural por momentos épicos del stream y pagan en USDC on-chain en Base.

- Track: 🤑 *Agentic Money* · Hackatón Platanus Hack BSAS
- Demo: **2026-05-10 12:00** (live)
- Repo: [`platanus-hack/platanus-hack-26-ar-team-2`](https://github.com/platanus-hack/platanus-hack-26-ar-team-2)

## Documentos clave

| Doc | Para qué |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Diseño completo: arquitectura, stack, demo, riesgos. **Empezá leyendo esto.** |
| [`TODO.md`](./TODO.md) | Tareas con dependencias + tabla de claims. **Antes de programar, firmá tu claim acá.** |
| [`README.md`](./README.md) | Quick-start del repo. |

## Equipo

| Nombre | GitHub | Track sugerido |
|---|---|---|
| Franco | [@francowini](https://github.com/francowini) | A — On-chain |
| Lucas | [@lucas-emartinez](https://github.com/lucas-emartinez) | B — Pipeline |
| Andy / Andrés | [@arvenz0210](https://github.com/arvenz0210) | C — Agents |
| Jere / Jeremy | [@jeremybacher](https://github.com/jeremybacher) | D — UI |

Las tracks A/B/C/D del [§10 DESIGN.md](./DESIGN.md) son **guía**, no obligatorias. Si terminás antes lo tuyo, agarrá la siguiente tarea libre del [`TODO.md`](./TODO.md) respetando dependencias.

## Protocolo de claim — OBLIGATORIO antes de programar

Antes de tocar código en este repo, **declarás qué vas a hacer y firmás con tu nombre**. El **commit + push del claim sobre `main` es el lock distribuido** — quien pushea primero gana la tarea. Aplica a humanos y a agents (Codex, Cursor, etc.) que estén actuando en nombre de un dev.

### Flow de claim (cada vez que arrancás algo nuevo)

```bash
git checkout main
git pull --rebase origin main         # 1. sync con el lock actual

# 2. editá TODO.md:
#    - agregá tu fila a la tabla "Currently working on"
#      (nombre · task ID · scope corto · timestamp)
#    - cambiá el estado de la tarea de ⬜ a 🟡

git add TODO.md
git commit -m "claim: <Tu Nombre> arranca <Task-ID> — <scope>"
git push origin main                   # 3. push exitoso = adquirís el lock

# 4. si el push falla porque alguien commiteó antes:
#    git pull --rebase origin main     → resolvé conflictos en la tabla
#    git push origin main               → reintentá

# 5. lock adquirido → volvé a tu track branch para laburar:
git checkout track/a-onchain          # o b-pipeline / c-agents / d-ui
```

### Reglas del lock

- **Cada arranque exige push exitoso a `main`** del claim. No empieces a programar sin lock.
- Solo el `TODO.md` se commitea contra `main` durante el claim. **El código del laburo va en la branch del track** (`track/a-onchain`, `track/b-pipeline`, `track/c-agents`, `track/d-ui`) o en una feature branch (`feat/<short-desc>`) si es transversal.
- **Si te trabás:** cambiá el estado a 🚧 + nota corta en TODO.md, commit + push igual que un claim normal.
- **Al terminar la tarea:** seguí el [flow de cierre](#flow-de-cierre-cada-vez-que-termin%C3%A1s-un-todo) — ✅ + sacar fila de WIP + FF a `main` en el mismo push. **No esperes al checkpoint.**
- **Nunca hagas `git push --force` a `main`.**

### Flow de cierre (cada vez que terminás un TODO)

Cada TODO ✅ se mergea a `main` apenas está listo (FF-only). Los checkpoints quedan como anchors de fase / alignment ritual, **no** son gates de merge.

```bash
# 1. parate en tu track branch con el laburo terminado y commiteado
git checkout track/a-onchain          # (o el que sea)
git pull --rebase origin main         # absorber claims/cierres de otros

# 2. editá TODO.md:
#    - estado de la tarea: 🟡 → ✅
#    - sacá tu fila de la tabla "Currently working on"
git add TODO.md
git commit -m "<Task-ID> ✅: <scope corto>"

# 3. fast-forward main al tip de tu track branch y pusheá ambos
git checkout main
git pull --rebase origin main         # último sync defensivo
git merge --ff-only track/a-onchain
git push origin main
git push origin track/a-onchain       # mantener la track branch al día

# 4. si el push a main falla por race con otro cierre:
#    git checkout track/a-onchain
#    git pull --rebase origin main    → resolvé conflictos
#    repetí pasos 3
```

Reglas:
- **FF-only.** Si `git merge --ff-only` falla es porque tu track branch divergió de `main` — rebasá la track contra `main` y reintentá. Cero merge commits, historia lineal.
- **Un cierre por commit.** Si tenés varios TODOs listos en la track branch, mergealos uno por uno (commit por TODO) para mantener el `main` legible.
- **Nunca pushees a `main` código que no compila / no testea.** El cierre es también el merge — si algo se rompe, desbloqueás al resto.

**Si sos un agent (Codex u otro):** preguntale al humano que te invocó qué nombre del equipo (Franco / Lucas / Andy / Jere) usar antes de empezar. **No firmes como "Codex" ni con un nombre genérico** — el claim siempre va a nombre de un humano del team. Si no podés preguntarle, leé el git config / autor del último commit del usuario para inferirlo y confirmá.

## Reglas durante 24h

- ✅ Mergeá a `main` apenas un TODO está ✅ (ver [flow de cierre](#flow-de-cierre-cada-vez-que-termin%C3%A1s-un-todo)). Los checkpoints (T+2h, T+12h, T+18h, T+22h) son **anchors de fase / sync ritual**, no gates de merge.
- ✅ Cero `git push --force` a `main`. Cero `git reset --hard` sin confirmar.
- ✅ Nunca skipear pre-commit hooks (`--no-verify`) salvo acuerdo explícito del team.
- ✅ Nunca commitear secrets ni `.env*` (ya cubierto por `.gitignore` para `.Codex/`, agregar reglas si hace falta).
- ✅ `tmp/` está gitignored y es para scratch local (notas para mentor, drafts, debug). **Nada de `tmp/` se sube** — si algo merece persistir, movelo al doc correspondiente.
- ✅ Si algo de Phase 0 no está listo, fixearlo es prioridad sobre todo lo demás.
- ⛔ Cero features fuera del [§15 DESIGN.md](./DESIGN.md) (YAGNI duro durante 24h).
- ⛔ Cero generación de creative en runtime — todo pre-subido por la marca (ver §6 DESIGN.md).

## Stack — pointer rápido

Detalle completo en [§8 DESIGN.md](./DESIGN.md). En una línea:

> Next.js 16 + Tailwind 4 + Supabase + Privy smart wallets + Base + viem + nginx-rtmp + ffmpeg + Deepgram + Gemini Flash + Codex 4.6 Sonnet + ElevenLabs Creative (offline) + Vercel Blob.

## Branches

```
main                    ← integración. FF-merge por cada TODO ✅ (no se espera a checkpoint).
├── track/a-onchain     ← Franco
├── track/b-pipeline    ← Lucas
├── track/c-agents      ← Andy
└── track/d-ui          ← Jere
```

Si tu trabajo es transversal, creá `feat/<short-desc>` desde `main`.

## Comandos rápidos

> Estos van a estar disponibles a partir del scaffold de P0-01..P0-03. Antes de eso son placeholders.

```bash
# Web
pnpm dev                    # Next.js dev server
pnpm typecheck              # tsc --noEmit
pnpm lint

# Contracts
cd contracts && forge test
cd contracts && forge script script/Deploy.s.sol --rpc-url base --broadcast

# Pipeline
docker compose -f infra/docker-compose.yml up
```

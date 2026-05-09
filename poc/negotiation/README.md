# Addie · Negotiation POC

Standalone proof of concept of the multi-agent negotiation layer from [DESIGN.md](../../DESIGN.md). No streaming pipeline, no on-chain settlement, no UI overlay — just **8 brand-agents vs. 1 streamer-agent**, in your terminal, in real time.

## What it does

For one simulated `ContextTick` (e.g. "FIFA goal scored"):

1. **PHASE 1 — parallel hunt.** All 8 brand-agents (Claude Haiku 4.5) evaluate the context simultaneously and decide whether to bid, with which ad from their library, in which inventory zone, and at what USDC amount.
2. **PHASE 2 — multi-turn negotiation.** Brands that decided to bid open a session each. The streamer-agent (Claude Sonnet 4.6) replies to **all active sessions in one batched call**, so it can play bidders off each other ("nike just offered $1.80 for the same zone"). Up to 3 turns.
3. **PHASE 3 — winner selection.** The streamer-agent picks the final winners constrained by inventory slots (e.g. only 1 lower_third slot exists).

The whole thing prints colored, timestamped, typewriter-style output so you can watch it on a projector during the demo.

## Setup

```bash
cd poc/negotiation
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npm run demo                 # default: fifa_goal scenario
npm run demo:goal            # explicit fifa_goal
npm run demo:calm            # calm_chat — most brands should skip
npm run demo:rage            # rage_quit — brand-safety pressure
```

Or pick any scenario:

```bash
npx tsx src/index.ts --scenario=fifa_goal
```

## Tunables (env)

| Env | Default | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `ADDIE_BRAND_MODEL` | `claude-haiku-4-5-20251001` | model used by 8 brand-agents |
| `ADDIE_STREAMER_MODEL` | `claude-sonnet-4-6` | model used by streamer-agent |
| `ADDIE_TYPEWRITER_MS` | `8` | ms/char for agent message rendering. Set `0` to disable. |
| `ADDIE_PHASE_PAUSE_MS` | `400` | ms pause between phases for readability |

## Architecture

```
src/
├── types.ts            data model (BrandMandate, Inventory, Turn, ClosedDeal, …)
├── brands.ts           8 brand mandates + their ad libraries
├── inventory.ts        creator's inventory zones + streamer mandate
├── scenarios.ts        preset StreamContext scenarios
├── anthropic.ts        SDK wrapper, forces structured tool-use output
├── brandAgent.ts       Brand-agent: huntForBrand() + brandRespond()
├── streamerAgent.ts    Streamer-agent: streamerBatchReply() + pickWinners()
├── orchestrator.ts     NegotiationOrchestrator: turn loop, parallel sessions
├── log.ts              chalk-based terminal output (timestamps, typewriter, colors)
└── index.ts            main: phases 0 → 3
```

The split between `brandAgent.ts`, `streamerAgent.ts`, and `orchestrator.ts` mirrors the production target in [DESIGN.md §11](../../DESIGN.md): brand-agents and streamer-agent will each become real worker processes wired through a pub/sub bus; the orchestrator will live inside the streamer-worker. The data model and prompts here are designed to port over unchanged.

## LLM call accounting per round

With the FIFA-goal scenario (typically ~4 brands bid):

| Phase | Calls | Model |
|---|---|---|
| Hunt | 8 (one per brand) | Haiku |
| Streamer reply turn 1 | 1 (batched across all active) | Sonnet |
| Brand response turn 2 | up to 4 (parallel) | Haiku |
| Streamer reply turn 3 | up to 1 | Sonnet |
| Pick winners | 1 | Sonnet |
| **Total** | **~15** | — |

Approx cost per scenario at current pricing: **~$0.05-0.10**. Run it as many times as you want during dev.

## What's intentionally out of scope

- Real RTMP / Deepgram / Gemini pipeline — context comes from `scenarios.ts`.
- On-chain escrow / wallets — winner selection prints a "would call AddieEscrow.lock()" line and stops.
- UI overlay / Browser Source — terminal only.
- Brand console / ad upload — ad library is hardcoded in `brands.ts`.
- Multi-stream — single creator (Coscu), single context tick per run.
- Pub/sub bus — orchestrator calls agents directly in-process.

When porting to the real `agent-worker` / `streamer-worker` services, replace those direct calls with bus request/response, keep everything else.

# Addie

**Track:** 🤑 Agentic Money · Platanus Hack BSAS 2026

<img src="./project-logo.png" alt="Addie logo" width="200" />

## What it is

Autonomous brand-agents compete in natural language for epic moments in your stream and pay in USDC on-chain on Base. No middlemen. No opaque CPMs. Everything verifiable on basescan.

## Stack

Next.js 16 · Tailwind 4 · Supabase · Privy · Base · viem · Claude 4.6 Sonnet · Gemini Flash · Deepgram · ElevenLabs · nginx-rtmp · ffmpeg · Vercel Blob

## Quick start

```bash
# install dependencies
cd apps/web && pnpm install

# dev server
pnpm dev          # http://localhost:3000

# type check
pnpm typecheck

# lint
pnpm lint

# contracts
cd contracts && forge test
cd contracts && forge script script/Deploy.s.sol --rpc-url base --broadcast

# pipeline (docker)
docker compose -f infra/docker-compose.yml up
```

## Docs

| Doc | Purpose |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Full architecture, stack, demo, risks. Start here. |
| [`TODO.md`](./TODO.md) | Tasks + claims. Sign before touching code. |

## Team

| Name | GitHub | Track |
|---|---|---|
| Franco | [@francowini](https://github.com/francowini) | A — On-chain |
| Lucas | [@lucas-emartinez](https://github.com/lucas-emartinez) | B — Pipeline |
| Andy | [@arvenz0210](https://github.com/arvenz0210) | C — Agents |
| Jere | [@jeremybacher](https://github.com/jeremybacher) | D — UI |

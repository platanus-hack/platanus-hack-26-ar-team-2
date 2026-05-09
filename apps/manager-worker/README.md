# manager-worker (C-08m)

> **Two deployment modes ship in `main` — pick one:**
>
> | Mode | Where it runs | Latency | Setup |
> |---|---|---|---|
> | **Push (this folder)** | local laptop / Fly / Railway | <1s | `pnpm dev` |
> | **Pull (Vercel Cron, C-08m-cron)** | Vercel only, no extra host | 0–60s | `vercel.json` cron + `CRON_SECRET` |
>
> Same Stage 1 + Stage 2 logic in both. The Vercel-cron variant lives at [`apps/web/src/lib/manager/`](../web/src/lib/manager/) + route [`apps/web/src/app/api/internal/manager-tick/route.ts`](../web/src/app/api/internal/manager-tick/route.ts). It is currently active on prod (every minute).
>
> To **disable Vercel cron** and run only this push-based worker: remove the `crons[]` entry from [`apps/web/vercel.json`](../web/vercel.json) and redeploy.

Standalone Node process that:
1. Subscribes to `INSERT` on `context_chunks` via Supabase Realtime postgres_changes (filtered by `stream_key`).
2. Applies a 2-stage filter: semantic Stage 1 (no LLM), Claude Haiku Stage 2 (returns `moment_quality` + `brand_match` scores, both must clear thresholds).
3. POSTs `{ message }` to `/api/creators/<stream_key>/render` so the existing C-13a SSE pipe pushes it to the iframe at `/o/<stream_key>`.

MVP collapse — when the auction layer (C-14, C-10, C-11, C-12) lands, the POST target switches from `/render` to `/api/auctions/run` without changing the rest.

## Run

```bash
cd apps/manager-worker
cp .env.example .env.local       # fill in SUPABASE_*, ANTHROPIC_API_KEY, ADDIE_API_BASE_URL
pnpm install
pnpm dev                          # subscribes + listens forever
```

Without an `ANTHROPIC_API_KEY`, set `MANAGER_DRY_RUN=true` to use a heuristic stub picker instead.

## Smoke test

Terminal A:
```bash
pnpm dev
# wait for "[manager] realtime status: SUBSCRIBED"
```

Terminal B:
```bash
pnpm smoke                        # inserts a synthetic high-energy chunk
```

Terminal A should print `stage1:pass` then either an `EMIT` line (if Stage 2 passed) or a `skip:*` line. Verify the render event landed:

```sql
select id, message, created_at from render_events
  where creator_id = 'coscu-test'
  order by created_at desc limit 1;
```

## Tunables

| Env | Default | What it does |
|---|---|---|
| `MANAGER_STREAM_KEY` | `coscu-test` | Which stream to watch + emit to |
| `MANAGER_MOMENT_QUALITY_MIN` | `0.5` | Stage 2 cutoff for "is this moment interesting?" |
| `MANAGER_BRAND_MATCH_MIN` | `0.55` | Stage 2 cutoff for "does the picked brand fit?" |
| `MANAGER_COOLDOWN_S` | `30` | Min seconds between successful emits |
| `MANAGER_DRY_RUN` | `false` | Skip Claude, return heuristic pick |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Override to e.g. `claude-sonnet-4-6` |

/**
 * GET /api/internal/manager-tick
 *
 * Vercel-Cron-driven entrypoint for the manager (C-08m-cron). Runs the same
 * Stage1+Stage2 logic as the standalone worker — see `lib/manager/tick.ts`.
 *
 * Cadence: matches the pipeline's 30s chunk-write cadence. Vercel Cron's
 * minimum is 60s, so we self-pace within a single invocation: run tick,
 * wait MANAGER_INTERNAL_GAP_MS (default 30000ms), run tick again. Two
 * ticks per cron invocation = effective 30s cadence with 1 cron entry.
 *
 * Auth: if `CRON_SECRET` is set in env, the route requires
 *       `Authorization: Bearer <CRON_SECRET>`. Vercel Cron auto-attaches that
 *       header when `CRON_SECRET` is configured. Without the env var the
 *       route is publicly callable — only OK for local smoke / preview.
 *
 * Schedule: see apps/web/vercel.json `crons` (every minute on Pro plan).
 *
 * Stream key: `?key=<stream_key>` overrides `MANAGER_STREAM_KEY` env default.
 *
 * Returns the TickResult JSON — Vercel function logs become the audit trail.
 */

import { NextResponse } from "next/server";

import { configFromEnv, managerTick } from "@/lib/manager/tick";

export const runtime = "nodejs";          // pg requires Node, not Edge
export const maxDuration = 60;             // ample for 2 ticks + 30s gap + LLM
export const dynamic = "force-dynamic";    // never cache cron responses

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function gapMsFromEnv(): number {
  const v = process.env.MANAGER_INTERNAL_GAP_MS;
  if (!v) return 30_000;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

export async function GET(req: Request) {
  // Bearer auth (only enforced if CRON_SECRET is set)
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${expected}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }

  const url = new URL(req.url);
  const streamKey = url.searchParams.get("key") ?? process.env.MANAGER_STREAM_KEY ?? "coscu-test";
  const gapMs = gapMsFromEnv();

  try {
    const config = configFromEnv(streamKey);

    // Phase 1 — react immediately to whatever chunk is latest right now.
    const tick1 = await managerTick(config);
    console.log(JSON.stringify({ route: "manager-tick", phase: 1, ...tick1 }));

    // Wait, then run again — gives 30s effective cadence within Vercel's 60s
    // cron floor. Cooldown inside managerTick still prevents duplicate emits.
    if (gapMs > 0) await sleep(gapMs);

    const tick2 = await managerTick(config);
    console.log(JSON.stringify({ route: "manager-tick", phase: 2, ...tick2 }));

    return NextResponse.json({ tick1, tick2, gap_ms: gapMs });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ route: "manager-tick", decision: "error", stream_key: streamKey, error }));
    return NextResponse.json(
      { decision: "error" as const, stream_key: streamKey, error },
      { status: 500 },
    );
  }
}

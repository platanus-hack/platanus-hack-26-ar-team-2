/**
 * GET /api/internal/manager-tick
 *
 * Vercel-Cron-driven entrypoint for the manager (C-08m-cron). Runs the same
 * Stage1+Stage2 logic as the standalone worker — see `lib/manager/tick.ts`.
 *
 * Cadence: every tick emits a `raw_chunk` render_event with the full chunk
 * JSON, plus optionally a brand placement when Stage1+Stage2 pass.
 * Vercel Cron's minimum is 60s, so we self-pace inside a single invocation:
 * run tick, wait MANAGER_INTERNAL_GAP_MS (default 5000ms), repeat — until
 * we're close to maxDuration. ~11 ticks per cron invocation @ 5s gap.
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
 * Returns array of TickResults — Vercel function logs are the audit trail.
 */

import { NextResponse } from "next/server";

import { configFromEnv, managerTick } from "@/lib/manager/tick";
import type { TickResult } from "@/lib/manager/types";

export const runtime = "nodejs";          // pg requires Node, not Edge
export const maxDuration = 60;             // Vercel Pro hard cap
export const dynamic = "force-dynamic";    // never cache cron responses

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function envNum(name: string, fallback: number, min = 0): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // ?once=1 → single-tick mode (mock page / manual trigger), skips auth
  const singleTick = url.searchParams.get("once") === "1";

  // Bearer auth (only enforced if CRON_SECRET is set AND not single-tick mode)
  if (!singleTick) {
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const got = req.headers.get("authorization");
      if (got !== `Bearer ${expected}`) {
        return new NextResponse("unauthorized", { status: 401 });
      }
    }
  }

  const streamKey = url.searchParams.get("key") ?? process.env.MANAGER_STREAM_KEY ?? "coscu-test";
  const gapMs = envNum("MANAGER_INTERNAL_GAP_MS", 5_000);
  // Stop new ticks once we're within ~6s of maxDuration to leave room for
  // the last tick + response serialization. maxDuration=60s → deadline=54s.
  const deadlineMs = Date.now() + envNum("MANAGER_RUN_BUDGET_MS", 54_000);

  const ticks: TickResult[] = [];
  try {
    const config = configFromEnv(streamKey);

    while (Date.now() + gapMs < deadlineMs) {
      const result = await managerTick(config);
      ticks.push(result);
      console.log(
        JSON.stringify({
          route: "manager-tick",
          phase: ticks.length,
          ...result,
        }),
      );

      // Early-exit on errors — don't burn the rest of the budget retrying a broken state.
      if (result.decision === "error") break;

      // Single-tick mode: return immediately after the first tick.
      if (singleTick) break;

      if (Date.now() + gapMs < deadlineMs) await sleep(gapMs);
    }

    return NextResponse.json({ ticks, count: ticks.length, gap_ms: gapMs });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        route: "manager-tick",
        decision: "error",
        stream_key: streamKey,
        error,
        ticks_completed: ticks.length,
      }),
    );
    return NextResponse.json(
      { decision: "error" as const, stream_key: streamKey, error, ticks },
      { status: 500 },
    );
  }
}

/**
 * GET /api/internal/manager-tick
 *
 * Vercel-Cron-driven entrypoint for the manager (C-08m-cron). Runs the same
 * Stage1+Stage2 logic as the standalone worker — see `lib/manager/tick.ts`.
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
 * Returns the TickResult JSON — Vercel function logs become the audit trail
 * (filter by route name in the dashboard).
 */

import { NextResponse } from "next/server";

import { configFromEnv, managerTick } from "@/lib/manager/tick";

export const runtime = "nodejs";          // pg requires Node, not Edge
export const maxDuration = 60;             // ample for one chunk + Stage2 LLM call
export const dynamic = "force-dynamic";    // never cache cron responses

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

  try {
    const config = configFromEnv(streamKey);
    const result = await managerTick(config);
    // Single structured log line — `vercel logs --json` for easy filtering.
    console.log(JSON.stringify({ route: "manager-tick", ...result }));
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ route: "manager-tick", decision: "error", stream_key: streamKey, error }));
    return NextResponse.json(
      { decision: "error" as const, stream_key: streamKey, error },
      { status: 500 },
    );
  }
}

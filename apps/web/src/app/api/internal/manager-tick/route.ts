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

import { randomUUID } from "node:crypto";

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
  // invocation_id correlaciona todos los logs de una sola corrida del cron
  // (~11 ticks internos a 5s gap). Buscalo en Vercel logs para reconstruir
  // qué decidió cada tick dentro de un mismo minuto.
  const invocationId = randomUUID().slice(0, 8);
  const invocationStartedAt = Date.now();

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
  const deadlineMs = invocationStartedAt + envNum("MANAGER_RUN_BUDGET_MS", 54_000);

  console.log(
    JSON.stringify({
      tag: "cron:invocation_start",
      invocation_id: invocationId,
      stream_key: streamKey,
      gap_ms: gapMs,
      budget_ms: deadlineMs - invocationStartedAt,
      single_tick: singleTick,
    }),
  );

  const ticks: TickResult[] = [];
  try {
    const config = configFromEnv(streamKey);

    while (Date.now() + gapMs < deadlineMs) {
      const result = await managerTick(config);
      ticks.push(result);
      console.log(
        JSON.stringify({
          route: "manager-tick",
          invocation_id: invocationId,
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

    console.log(
      JSON.stringify({
        tag: "cron:invocation_end",
        invocation_id: invocationId,
        stream_key: streamKey,
        total_ticks: ticks.length,
        decisions: ticks.map((t) => t.decision),
        elapsed_ms: Date.now() - invocationStartedAt,
      }),
    );

    return NextResponse.json({
      invocation_id: invocationId,
      ticks,
      count: ticks.length,
      gap_ms: gapMs,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        tag: "cron:invocation_error",
        invocation_id: invocationId,
        route: "manager-tick",
        decision: "error",
        stream_key: streamKey,
        error,
        ticks_completed: ticks.length,
        elapsed_ms: Date.now() - invocationStartedAt,
      }),
    );
    return NextResponse.json(
      {
        invocation_id: invocationId,
        decision: "error" as const,
        stream_key: streamKey,
        error,
        ticks,
      },
      { status: 500 },
    );
  }
}

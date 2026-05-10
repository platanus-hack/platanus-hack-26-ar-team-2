/**
 * GET /api/internal/manager-tick
 *
 * Dos modos:
 *
 *   1. Cron (default) — Vercel cron firea cada minuto (apps/web/vercel.json).
 *      Self-pace adentro de la invocación: run tick, wait
 *      MANAGER_INTERNAL_GAP_MS (default 5s), repeat hasta MANAGER_RUN_BUDGET_MS
 *      (default 54s) → ~11 ticks por invocación. Safety net por si el webhook
 *      del pipeline falla, o para procesar chunks viejos que el agent no
 *      alcanzó cuando llegó el push.
 *
 *   2. Single-tick (push-based) — el chunkWriter (poc/pipeline) firea esto
 *      después de cada INSERT con `?single=1`. Corre UN tick (1-2s) y vuelve.
 *      Latencia agent baja a <2s desde el INSERT en lugar de los 0-6s del
 *      cron worst-case. Ver chunkWriter.ts:fireManagerWebhook().
 *
 * Auth: si `CRON_SECRET` está en env, requiere `Authorization: Bearer <secret>`.
 *       Vercel Cron lo attachea solo. El chunkWriter manda el mismo header
 *       desde MANAGER_WEBHOOK_SECRET. Sin la env var, el route es público
 *       (solo OK para local smoke / preview).
 *
 * Stream key: `?key=<stream_key>` (default MANAGER_STREAM_KEY env).
 *
 * Returns array of TickResults — Vercel function logs son el audit trail.
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
  const singleParam = url.searchParams.get("single");
  const single = singleParam === "1" || singleParam === "true";

  const config = configFromEnv(streamKey);

  // Single-tick mode (push del chunkWriter) — un solo tick, sin loop. Devuelve
  // en 1-2s. El cron sigue corriendo cada minuto como safety net por si el
  // webhook se pierde o queda algo en backlog.
  if (single) {
    try {
      const result = await managerTick(config);
      console.log(
        JSON.stringify({ route: "manager-tick", mode: "single", ...result }),
      );
      return NextResponse.json({ ticks: [result], count: 1, mode: "single" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          route: "manager-tick",
          mode: "single",
          decision: "error",
          stream_key: streamKey,
          error,
        }),
      );
      return NextResponse.json(
        { decision: "error" as const, stream_key: streamKey, error },
        { status: 500 },
      );
    }
  }

  // Cron mode — self-loop hasta agotar el budget.
  const gapMs = envNum("MANAGER_INTERNAL_GAP_MS", 5_000);
  // Stop new ticks once we're within ~6s of maxDuration to leave room for
  // the last tick + response serialization. maxDuration=60s → deadline=54s.
  const deadlineMs = Date.now() + envNum("MANAGER_RUN_BUDGET_MS", 54_000);

  const ticks: TickResult[] = [];
  try {
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

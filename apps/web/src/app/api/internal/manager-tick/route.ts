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
 * Auth: requiere `Authorization: Bearer <CRON_SECRET>` cuando CRON_SECRET existe,
 *       y exige CRON_SECRET en producción. En dev local sin secret queda abierto
 *       para smoke tests.
 *
 * Stream key: `?key=<stream_key>` (default MANAGER_STREAM_KEY env).
 *
 * Returns array of TickResults — Vercel function logs son el audit trail.
 */

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { configFromEnv, managerTick } from "@/lib/manager/tick";
import { requireInternalBearer } from "@/lib/route-security";
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
  // ?once=1 → single-tick mode (mock page / manual trigger)
  const singleTick = url.searchParams.get("once") === "1";

  const authError = requireInternalBearer(req);
  if (authError) return authError;

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
        { decision: "error" as const, stream_key: streamKey, error: "manager tick failed" },
        { status: 500 },
      );
    }
  }

  // Cron mode — self-loop hasta agotar el budget.
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
        error: "manager tick failed",
        ticks,
      },
      { status: 500 },
    );
  }
}

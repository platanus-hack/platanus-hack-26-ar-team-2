/**
 * POST /api/auctions/run — orquestador de subasta sincrónica (C-14).
 *
 * Recibe del manager (C-08m worker o cron tick) un par
 *   `{ tick: ContextChunk, manager_decision: ManagerDecisionSummary }`
 * y corre la cadena agent end-to-end:
 *
 *   hunt × N brands  →  runNegotiation (1-turn MVP, broadcast por turno)
 *                    →  streamerEvaluate (single-shot al deadline)
 *                    →  INSERT placements (best-effort) + escrow.lock
 *                    →  POST /render con asset metadata (visible en OBS)
 *
 * Runtime budget: ~5–8s (huntForBrand × 5 paralelo, ~3s; streamer Sonnet ~2s).
 *
 * Auth: Bearer `CRON_SECRET` (mismo pattern que /api/internal/manager-tick).
 *       Sin var → publicly callable (local smoke).
 */

import { NextResponse } from "next/server";

import { runAuction } from "@/lib/auctions/runAuction";
import { requireInternalBearer } from "@/lib/route-security";
import type { ContextChunk } from "@/lib/manager/types";
import type { ManagerDecisionSummary } from "@/lib/agents/brand/huntForBrand";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = {
  tick?: ContextChunk;
  manager_decision?: ManagerDecisionSummary;
  creator_id?: string;
  dry_run?: boolean;
};

export async function POST(req: Request) {
  const authError = requireInternalBearer(req);
  if (authError) return authError;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const { tick, manager_decision } = body;
  if (!tick || !tick.id || !tick.stream_key) {
    return NextResponse.json(
      { error: "missing required field tick (ContextChunk with id + stream_key)" },
      { status: 400 },
    );
  }
  if (!manager_decision || typeof manager_decision.should_emit !== "boolean") {
    return NextResponse.json(
      { error: "missing required field manager_decision (ManagerDecisionSummary)" },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dryRun = body.dry_run ?? !apiKey;

  try {
    const result = await runAuction({
      tick,
      manager_decision,
      creator_id: body.creator_id,
      base_url: resolveBaseUrl(req),
      cron_secret: process.env.CRON_SECRET,
      anthropic_api_key: apiKey,
      dry_run: dryRun,
    });
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ tag: "auctions:run:error", error }));
    return NextResponse.json({ error }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({
    endpoint: "POST /api/auctions/run",
    auth: "Bearer CRON_SECRET",
    body: {
      tick: "ContextChunk — required, must include id + stream_key",
      manager_decision: "ManagerDecisionSummary — required",
      creator_id: "string — optional, defaults to tick.stream_key",
      dry_run: "boolean — optional, defaults to !ANTHROPIC_API_KEY",
    },
  });
}

function resolveBaseUrl(req: Request): string {
  if (process.env.AUCTIONS_BASE_URL) return process.env.AUCTIONS_BASE_URL;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

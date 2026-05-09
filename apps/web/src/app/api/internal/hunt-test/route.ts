/**
 * GET/POST /api/internal/hunt-test  —  manual hunt-test entrypoint.
 *
 * Lets us validate `huntForBrand()` (C-08 + C-08d) against REAL chunks that
 * already live in `context_chunks`, without touching the cron flow. Pure
 * observation: nothing is inserted into `render_events` and `tick.ts` is
 * untouched. C-14 will replace this once `POST /api/auctions/run` lands.
 *
 * Auth: same Bearer pattern as `manager-tick` — required iff `CRON_SECRET`
 *       is set in env. Without that var the route is publicly callable
 *       (intended only for local smoke).
 *
 * Inputs (query string):
 *   - `chunk_id` (required) — UUID of a row in `context_chunks`. 404 if missing.
 *   - `brand_slug` (optional) — if present, run only that brand. Otherwise
 *     all brands from the YAML registry run in parallel.
 *
 * Output JSON:
 *   { chunk: <compact ContextChunk fields>, hunts: HuntDecisionRow[] }
 *
 *   HuntDecisionRow = { brand_slug, decision: BrandAgentDecision,
 *                       gate_path, latency_ms }
 *
 * Caveat: market_signals + manager_decision are MOCKED (constant values
 * defined below) until C-10 (real market signals from inventory) and the
 * Stage2 manager output is wired in. Documented in the response too via
 * `mocked_inputs.market_signals + mocked_inputs.manager_decision`.
 */

import { NextResponse } from "next/server";

import { getLoadedBrands } from "@/lib/manager/pickBrand";
import { pool } from "@/lib/pg";

import {
  huntForBrand,
  type GatePathEntry,
  type HuntForBrandArgs,
  type ManagerDecisionSummary,
  type MarketSignals,
} from "@/lib/agents/brand/huntForBrand";
import type { BrandAgentDecision } from "@/lib/agents/types";
import type { ContextChunk } from "@/lib/manager/types";

type HuntRow =
  | {
      brand_slug: string;
      available_balance_usdc: number;
      decision: BrandAgentDecision;
      gate_path: GatePathEntry[];
      latency_ms: number;
    }
  | {
      brand_slug: string;
      available_balance_usdc: number;
      error: string;
    };

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mocked inputs — replaced by real signals once C-10 + the manager Stage2
// payload pipeline land. Calibrated to a "lower_third / mid-energy moment"
// so gate1 + gate3 run with the same shape they'd see in production.
const MOCK_MARKET_SIGNALS: MarketSignals = {
  zone: "lower_third",
  zone_floor_usdc: 0.5,
  fair_value_usdc: 1.0,
  competitor_count: 3,
  suggested_duration_s: 8,
};

const MOCK_MANAGER_DECISION: ManagerDecisionSummary = {
  should_emit: true,
  moment_quality: 0.7,
  brand_match: 0.8,
  reason: "manual hunt-test invocation",
};

async function handle(req: Request): Promise<Response> {
  // Bearer auth (only enforced if CRON_SECRET is set)
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${expected}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }

  const url = new URL(req.url);
  const chunkId = url.searchParams.get("chunk_id");
  const brandSlug = url.searchParams.get("brand_slug");

  if (!chunkId) {
    return NextResponse.json(
      { error: "missing required query param chunk_id" },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY missing — hunt-test runs LIVE against Claude (no dryRun)",
      },
      { status: 500 },
    );
  }

  // 1. Load chunk by id.
  const client = await pool().connect();
  let chunk: ContextChunk | undefined;
  try {
    const res = await client.query<ContextChunk>(
      `select * from context_chunks where id = $1 limit 1`,
      [chunkId],
    );
    chunk = res.rows[0];
  } finally {
    client.release();
  }

  if (!chunk) {
    return NextResponse.json(
      { error: "chunk not found", chunk_id: chunkId },
      { status: 404 },
    );
  }

  // 2. Pick the brands to hunt with.
  const allBrands = getLoadedBrands();
  const brands = brandSlug
    ? allBrands.filter((b) => b.slug === brandSlug)
    : allBrands;

  if (brands.length === 0) {
    return NextResponse.json(
      {
        error: "no brands matched",
        brand_slug: brandSlug,
        registry: allBrands.map((b) => b.slug),
      },
      { status: 404 },
    );
  }

  // 3. Run hunts in parallel.
  const t0 = Date.now();
  const hunts: HuntRow[] = await Promise.all(
    brands.map(async (brand): Promise<HuntRow> => {
      const cap = brand.payload.daily_cap_usdc;
      const spent = brand.payload.spent_today_usdc ?? 0;
      const available_balance_usdc = Math.max(0, cap - spent);

      const args: HuntForBrandArgs = {
        brand,
        context: chunk!,
        stream: null,
        market_signals: MOCK_MARKET_SIGNALS,
        manager_decision: MOCK_MANAGER_DECISION,
        available_balance_usdc,
        apiKey,
        dryRun: false,
      };

      try {
        const result = await huntForBrand(args);
        return {
          brand_slug: brand.slug,
          available_balance_usdc,
          decision: result.decision,
          gate_path: result.gate_path,
          latency_ms: result.latency_ms,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          brand_slug: brand.slug,
          available_balance_usdc,
          error,
        };
      }
    }),
  );
  const totalMs = Date.now() - t0;

  const bidCount = hunts.filter(
    (h): h is Extract<HuntRow, { decision: BrandAgentDecision }> =>
      "decision" in h && h.decision.should_bid,
  ).length;
  const skipCount = hunts.length - bidCount;

  console.log(
    JSON.stringify({
      tag: "hunt-test:summary",
      chunk_id: chunk.id,
      brand_count: brands.length,
      bid_count: bidCount,
      skip_count: skipCount,
      total_ms: totalMs,
      latencies_ms: hunts.map((h) => ({
        brand_slug: h.brand_slug,
        ms: "latency_ms" in h ? h.latency_ms : null,
      })),
    }),
  );

  return NextResponse.json({
    chunk: {
      id: chunk.id,
      stream_key: chunk.stream_key,
      ts_start: chunk.ts_start,
      duration_s: chunk.duration_s,
      audio_text: chunk.audio_text,
      audio_summary: chunk.audio_summary,
      audio_intent: chunk.audio_intent,
      audio_mentions: chunk.audio_mentions,
      audio_topics: chunk.audio_topics,
      mood_tags: chunk.mood_tags,
      energy_level: chunk.energy_level,
      viewers: chunk.viewers,
      viewers_delta_30s: chunk.viewers_delta_30s,
      game_category: chunk.game_category,
    },
    mocked_inputs: {
      market_signals: MOCK_MARKET_SIGNALS,
      manager_decision: MOCK_MANAGER_DECISION,
    },
    hunts,
    summary: {
      brand_count: brands.length,
      bid_count: bidCount,
      skip_count: skipCount,
      total_ms: totalMs,
    },
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

// apps/web/scripts/sim-orchestrator.ts — C-08test runner.
//
// Itera fixtures de orchestrator-cases.ts. Por cada case enabled:
//   1. INSERT row sintética en context_chunks (pg directo via pool()).
//   2. Llama managerTick(configFromEnv(stream_key)) en proceso (sin HTTP).
//   3. Pollea render_events kind='brand' filtrando por creator_id + ts >= start.
//   4. Compara TickResult + último brand event contra expect → log OK/FAIL.
//
// Por qué NO HTTP a /api/internal/manager-tick:
//   - sin pnpm dev no hay endpoint; el harness debe correr standalone.
//   - import directo nos da TickResult typed con la decision discriminada.
//   - cuando C-14 (POST /api/auctions/run) exista, switcheamos a fetch acá.
//
// stream_key sintético `harness-<id>-<rand4>` por case → no choca con
// MANAGER_STREAM_KEY de prod ("coscu-test") ni con team-stream del demo.
// Las rows quedan en DB para inspección visual via /o/<harness-key>.
//
// Flags:
//   --case F-01    corre uno solo (default: todos los enabled)
//
//   pnpm sim:orch
//   pnpm sim:orch -- --case F-01

import { randomUUID } from "node:crypto";
import process from "node:process";

import { configFromEnv, managerTick } from "../src/lib/manager/tick.ts";
import { pool } from "../src/lib/pg.ts";
import type { TickResult } from "../src/lib/manager/types.ts";

import {
  CASES,
  ENABLED_CASES,
  type OrchestratorCase,
} from "./fixtures/orchestrator-cases.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.POSTGRES_URL_NON_POOLING && !process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL_NON_POOLING missing. Run with:");
    console.error(
      "  node --env-file=.env.local --import tsx scripts/sim-orchestrator.ts",
    );
    process.exit(1);
  }

  // Default to dry-run (stub picker) — the harness validates orchestration
  // logic, not Claude prompt quality, so we don't want to burn credits on
  // every run. Override with MANAGER_DRY_RUN=false to exercise the live LLM.
  // Live mode requires @anthropic-ai/sdk installed locally + ANTHROPIC_API_KEY.
  if (process.env.MANAGER_DRY_RUN == null) {
    process.env.MANAGER_DRY_RUN = "true";
  }
  const dryRun = process.env.MANAGER_DRY_RUN === "true";

  const cases: OrchestratorCase[] = args.caseId
    ? [findCase(args.caseId)]
    : ENABLED_CASES;

  if (cases.length === 0) {
    console.error("no enabled cases — toggle one in orchestrator-cases.ts");
    process.exit(1);
  }

  console.log(
    `▶ C-08test harness · ${cases.length} case(s) · dry_run=${dryRun}`,
  );
  console.log("");

  let pass = 0;
  let fail = 0;
  const failed: string[] = [];

  for (const c of cases) {
    if (!c.enabled) {
      console.log(
        `⏸  ${c.id} ${c.title} — PENDING (${c.pending_reason ?? "disabled"})`,
      );
      continue;
    }

    const streamKey = `harness-${c.id.toLowerCase()}-${randomUUID().slice(0, 4)}`;
    const startedAt = new Date();

    process.stdout.write(`▶ ${c.id} ${c.title}  stream=${streamKey}  ... `);

    try {
      const chunkId = await insertChunk(streamKey, c);
      const result = await managerTick(configFromEnv(streamKey));
      const events = await fetchBrandEventsAfter(streamKey, startedAt);
      const verdict = check(c, result, events);

      if (verdict.ok) {
        console.log(`OK · ${verdict.summary}`);
        pass++;
      } else {
        console.log(`FAIL`);
        console.log(`     reason: ${verdict.reason}`);
        console.log(`     decision: ${result.decision}`);
        if ("pick" in result) {
          console.log(
            `     pick: brand=${result.pick.brand_id} msg="${result.pick.message}"`,
          );
        }
        console.log(
          `     events: ${events.length} brand event(s) post-INSERT, last="${events[events.length - 1]?.message ?? "(none)"}"`,
        );
        console.log(`     chunk_id: ${chunkId}`);
        fail++;
        failed.push(c.id);
      }
    } catch (err) {
      console.log(`ERROR`);
      console.log(`     ${err instanceof Error ? err.message : String(err)}`);
      fail++;
      failed.push(c.id);
    }
  }

  console.log("");
  const pending = cases.length - pass - fail;
  console.log(`── done · ${pass} pass · ${fail} fail · ${pending} pending ──`);
  if (failed.length) console.log(`failed: ${failed.join(", ")}`);

  await pool()
    .end()
    .catch(() => {});

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ─── helpers ───────────────────────────────────────────────────────────────

type Args = { caseId?: string };

function parseArgs(argv: string[]): Args {
  let caseId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--case") caseId = argv[++i];
  }
  return { caseId };
}

function findCase(id: string): OrchestratorCase {
  const c = CASES.find((x) => x.id === id);
  if (!c) {
    console.error(
      `unknown case ${id}. valid: ${CASES.map((x) => x.id).join(", ")}`,
    );
    process.exit(1);
  }
  return c;
}

async function insertChunk(
  streamKey: string,
  c: OrchestratorCase,
): Promise<string> {
  const chunk = c.chunk;
  const row = {
    stream_key: streamKey,
    stream_id: null as string | null,
    ts_start: new Date().toISOString(),
    duration_s: chunk.duration_s ?? 30,
    audio_text: chunk.audio_text,
    audio_partial_at_end: null as string | null,
    audio_summary: chunk.audio_summary ?? chunk.audio_text.slice(0, 140),
    audio_topics: chunk.audio_topics ?? [],
    audio_mentions: chunk.audio_mentions ?? [],
    audio_intent: chunk.audio_intent ?? "discussion",
    scene_type: chunk.scene_type ?? "talking_head",
    energy_level: chunk.energy_level ?? "medium",
    mood_tags: chunk.mood_tags ?? [],
    on_screen_text: chunk.on_screen_text ?? null,
    chat_velocity_avg: chunk.chat_velocity_avg ?? 0,
    chat_velocity_peak: chunk.chat_velocity_peak ?? 0,
    chat_recent_keywords: chunk.chat_recent_keywords ?? [],
    sentiment_avg: chunk.sentiment_avg ?? "neutral",
    viewers: chunk.viewers ?? 5,
    viewers_delta_30s: chunk.viewers_delta_30s ?? 0,
    game_category: chunk.game_category ?? null,
    stream_title: chunk.stream_title ?? "Addie Harness",
    ticks_aggregated: 1,
    frame_analyses_aggregated: 0,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = Object.values(row);
  const res = await pool().query<{ id: string }>(
    `insert into context_chunks (${cols.join(", ")}) values (${placeholders}) returning id`,
    values,
  );
  return res.rows[0]!.id;
}

type BrandEventRow = {
  id: string;
  message: string;
  created_at: Date;
  payload: unknown;
};

async function fetchBrandEventsAfter(
  creatorId: string,
  since: Date,
): Promise<BrandEventRow[]> {
  const res = await pool().query<BrandEventRow>(
    `select id, message, created_at, payload
       from render_events
      where creator_id = $1 and kind = 'brand' and created_at >= $2
      order by created_at asc`,
    [creatorId, since],
  );
  return res.rows;
}

type Verdict = { ok: true; summary: string } | { ok: false; reason: string };

type ActualGateSkip = {
  brand_id: string;
  brand_display_name?: string;
  gate: number;
  code: string;
  detail?: string;
  human_message?: string;
};

function extractGateSkips(payload: unknown): ActualGateSkip[] {
  if (!payload || typeof payload !== "object") return [];
  const skips = (payload as { gate_skips?: unknown }).gate_skips;
  if (!Array.isArray(skips)) return [];
  return skips.filter(
    (s): s is ActualGateSkip =>
      !!s &&
      typeof s === "object" &&
      typeof (s as ActualGateSkip).brand_id === "string" &&
      typeof (s as ActualGateSkip).gate === "number" &&
      typeof (s as ActualGateSkip).code === "string",
  );
}

function check(
  c: OrchestratorCase,
  result: TickResult,
  events: BrandEventRow[],
): Verdict {
  const expect = c.expect;

  if (expect.decision && result.decision !== expect.decision) {
    return {
      ok: false,
      reason: `expected decision=${expect.decision}, got ${result.decision}`,
    };
  }

  if (events.length === 0) {
    return {
      ok: false,
      reason: "no brand render_event landed within run window",
    };
  }
  const last = events[events.length - 1]!;

  const pick = "pick" in result ? result.pick : null;
  const actualBrand = pick?.brand_id ?? null;

  if (expect.brand_id_any_of !== undefined) {
    if (!expect.brand_id_any_of.includes(actualBrand)) {
      return {
        ok: false,
        reason: `expected brand_id ∈ [${expect.brand_id_any_of.join(",")}], got ${actualBrand} (msg="${last.message}")`,
      };
    }
  } else if (expect.brand_id !== undefined && expect.brand_id !== actualBrand) {
    return {
      ok: false,
      reason: `expected brand_id=${expect.brand_id}, got ${actualBrand} (msg="${last.message}")`,
    };
  }

  if (expect.message_contains && !last.message.includes(expect.message_contains)) {
    return {
      ok: false,
      reason: `expected message contains "${expect.message_contains}", got "${last.message}"`,
    };
  }

  // C-08a: gate_skips subset match against render_events.payload.gate_skips.
  if (expect.gate_skips && expect.gate_skips.length > 0) {
    const actual = extractGateSkips(last.payload);
    for (const want of expect.gate_skips) {
      const match = actual.find(
        (a) => a.brand_id === want.brand && a.gate === want.gate,
      );
      if (!match) {
        const got = actual.map((a) => `${a.brand_id}:g${a.gate}=${a.code}`).join(", ");
        return {
          ok: false,
          reason: `expected gate_skip ${want.brand}:g${want.gate} not in actual [${got || "(empty)"}]`,
        };
      }
      if (want.reason_substring) {
        const haystack = `${match.code} ${match.detail ?? ""} ${match.human_message ?? ""}`.toLowerCase();
        if (!haystack.includes(want.reason_substring.toLowerCase())) {
          return {
            ok: false,
            reason: `expected gate_skip ${want.brand}:g${want.gate} to mention "${want.reason_substring}", got code="${match.code}" detail="${match.detail ?? ""}"`,
          };
        }
      }
    }
  }

  // C-08d: `bid_usdc_min` + `agent_reasoning_contains` se validan en
  // `pnpm smoke:hunt` (scripts/smoke-hunt.ts) que ejecuta `huntForBrand()`
  // per-brand y devuelve `BrandAgentDecision.bid_usdc`. sim:orch los ignora
  // hasta que C-14 wire `POST /api/auctions/run` — ahí el TickResult va a
  // exponer `winner.terms.bid_usdc` y la check cae en este punto.

  const actualSkips = extractGateSkips(last.payload);
  const skipSummary = actualSkips.length
    ? ` skips=[${actualSkips.map((a) => `${a.brand_id}:g${a.gate}=${a.code}`).join(", ")}]`
    : "";
  return {
    ok: true,
    summary: `brand=${actualBrand ?? "(none)"} msg="${last.message}"${skipSummary}`,
  };
}

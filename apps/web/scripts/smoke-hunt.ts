// apps/web/scripts/smoke-hunt.ts — C-08 + C-08d smoke.
//
// Exercises huntForBrand() per-brand against synthetic chunks. Validates
// the BrandAgentDecision shape end-to-end:
//   - cafetito vs "café cargadísimo" chunk → should_bid=true, ad_id, bid≥floor
//   - termoflex vs neutral chunk           → should_bid=true (always_bid_floor)
//   - cafetito vs brand-safety chunk       → should_bid=false (gate1 SKIP)
//   - matebros vs huge-audience chunk      → should_bid=false (gate1 SKIP)
//   - cafetito vs unrelated chunk          → should_bid=false (gate3 SKIP)
//
// Modes:
//   default              dry-run (no LLM, deterministic stubs)
//   ANTHROPIC_API_KEY=…  ./scripts/smoke-hunt.ts --live exercises Sonnet 4.6
//
// pnpm smoke:hunt
// pnpm smoke:hunt -- --live
//
// Heads up: live mode hits Sonnet 4.6 (~1.5–2s per call) — only run when you
// want to validate prompt quality, not in CI loops. Costs ~$0.005/case.

import process from "node:process";

import { loadBrandMandates } from "../src/lib/agents/brands/loader.ts";
import {
  huntForBrand,
  type HuntForBrandArgs,
  type HuntResult,
  type ManagerDecisionSummary,
  type MarketSignals,
} from "../src/lib/agents/brand/huntForBrand.ts";
import type { Gate1Context } from "../src/lib/agents/types.ts";

type Case = {
  id: string;
  brand_slug: string;
  context: Gate1Context;
  market: MarketSignals;
  manager: ManagerDecisionSummary;
  available_balance_usdc: number;
  expect: {
    should_bid: boolean;
    bid_usdc_min?: number;
    reason_substring?: string;
    /** Substrings the audit `agent_reasoning` (gate_path) must contain. */
    agent_reasoning_contains?: string[];
  };
};

const DEFAULT_MARKET: MarketSignals = {
  zone: "lower_third",
  zone_floor_usdc: 0.5,
  fair_value_usdc: 0.85,
  competitor_count: 2,
  recent_clearing_avg_usdc: 0.7,
  suggested_duration_s: 8,
};

const DEFAULT_MANAGER: ManagerDecisionSummary = {
  should_emit: true,
  moment_quality: 0.7,
  brand_match: 0.8,
  reason: "manager picker matched the brand mention",
};

const CASES: Case[] = [
  {
    id: "H-01 cafetito-match",
    brand_slug: "cafetito",
    context: {
      audio_text:
        "Yo ya voy por el cuarto CafetITO bien cargadísimo, los pibes del fondo están dándole.",
      audio_mentions: ["CafetITO", "café"],
      audio_topics: ["café", "trabajo"],
      mood_tags: ["high_energy", "celebration"],
      scene_type: "talking_head",
      viewers: 5,
    },
    market: { ...DEFAULT_MARKET, fair_value_usdc: 1.2 },
    manager: { ...DEFAULT_MANAGER, brand_match: 0.9 },
    available_balance_usdc: 50,
    expect: {
      should_bid: true,
      bid_usdc_min: 0.5,
      agent_reasoning_contains: ["gate1", "gate4"],
    },
  },
  {
    id: "H-02 termoflex-floor-fill",
    brand_slug: "termoflex",
    context: {
      audio_text: "Acá charlando del setup, no pasa mucho ahora mismo.",
      audio_mentions: [],
      audio_topics: ["setup"],
      mood_tags: ["calm"],
      scene_type: "talking_head",
      viewers: 5,
    },
    market: { ...DEFAULT_MARKET, fair_value_usdc: 0.3, zone_floor_usdc: 0.2 },
    manager: { ...DEFAULT_MANAGER, brand_match: 0.4, moment_quality: 0.4 },
    available_balance_usdc: 25,
    expect: {
      should_bid: true,
      bid_usdc_min: 0.2,
      agent_reasoning_contains: ["gate1", "gate4"],
    },
  },
  {
    id: "H-03 cafetito-brand-safety-skip",
    brand_slug: "cafetito",
    context: {
      audio_text: "Che el café este es una droga, te despierta de una.",
      audio_mentions: ["café"],
      audio_topics: ["café"],
      mood_tags: ["high_energy"],
      chat_recent_keywords: ["droga"],
      scene_type: "talking_head",
      viewers: 5,
    },
    market: DEFAULT_MARKET,
    manager: DEFAULT_MANAGER,
    available_balance_usdc: 50,
    expect: {
      should_bid: false,
      reason_substring: "bloqueada",
      agent_reasoning_contains: ["gate1"],
    },
  },
  {
    id: "H-04 matebros-viewers-above-max",
    brand_slug: "matebros",
    context: {
      audio_text: "Los pibes del fondo están con mate, fogón de equipo dale.",
      audio_mentions: ["mate"],
      audio_topics: ["mate", "comunidad"],
      mood_tags: ["casual_chat"],
      scene_type: "talking_head",
      viewers: 20, // > matebros.max_viewers=2
    },
    market: DEFAULT_MARKET,
    manager: DEFAULT_MANAGER,
    available_balance_usdc: 25,
    expect: {
      should_bid: false,
      reason_substring: "audiencia",
      agent_reasoning_contains: ["gate1"],
    },
  },
];

async function main(): Promise<void> {
  const live = process.argv.slice(2).includes("--live");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (live && !apiKey) {
    console.error("--live requires ANTHROPIC_API_KEY in the environment");
    process.exit(1);
  }
  const dryRun = !live;
  console.log(`▶ smoke-hunt · ${CASES.length} cases · live=${live}`);
  console.log("");

  const brands = loadBrandMandates();
  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    const brand = brands.find((b) => b.slug === c.brand_slug);
    if (!brand) {
      console.log(`✗ ${c.id} — brand "${c.brand_slug}" not in YAML registry`);
      fail++;
      continue;
    }

    const args: HuntForBrandArgs = {
      brand,
      context: c.context,
      stream: null,
      market_signals: c.market,
      manager_decision: c.manager,
      available_balance_usdc: c.available_balance_usdc,
      apiKey,
      dryRun,
    };

    const t0 = Date.now();
    let result: HuntResult;
    try {
      result = await huntForBrand(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${c.id} — ERROR: ${msg}`);
      fail++;
      continue;
    }
    const dt = Date.now() - t0;

    const verdict = check(c, result);
    if (verdict.ok) {
      console.log(
        `✓ ${c.id} · ${dt}ms · ${summarize(result)}`,
      );
      pass++;
    } else {
      console.log(`✗ ${c.id} · ${dt}ms · ${verdict.reason}`);
      console.log(`     gate_path: ${gatePathSummary(result)}`);
      console.log(`     decision:  ${JSON.stringify(result.decision)}`);
      fail++;
    }
  }

  console.log("");
  console.log(`── done · ${pass} pass · ${fail} fail ──`);
  process.exit(fail > 0 ? 1 : 0);
}

type Verdict = { ok: true } | { ok: false; reason: string };

function check(c: Case, result: HuntResult): Verdict {
  const d = result.decision;
  if (d.should_bid !== c.expect.should_bid) {
    return {
      ok: false,
      reason: `expected should_bid=${c.expect.should_bid}, got ${d.should_bid}`,
    };
  }
  if (d.should_bid) {
    if (
      c.expect.bid_usdc_min != null &&
      d.bid_usdc < c.expect.bid_usdc_min
    ) {
      return {
        ok: false,
        reason: `expected bid_usdc ≥ ${c.expect.bid_usdc_min}, got ${d.bid_usdc}`,
      };
    }
    if (!d.ad_id) {
      return { ok: false, reason: "should_bid=true but ad_id missing" };
    }
    if (!d.opening_message) {
      return { ok: false, reason: "should_bid=true but opening_message missing" };
    }
  } else {
    if (
      c.expect.reason_substring &&
      !d.reason.toLowerCase().includes(c.expect.reason_substring.toLowerCase())
    ) {
      return {
        ok: false,
        reason: `expected reason to contain "${c.expect.reason_substring}", got "${d.reason}"`,
      };
    }
  }

  if (c.expect.agent_reasoning_contains) {
    const audit = gatePathSummary(result).toLowerCase();
    for (const needle of c.expect.agent_reasoning_contains) {
      if (!audit.includes(needle.toLowerCase())) {
        return {
          ok: false,
          reason: `gate_path missing "${needle}" — got [${audit}]`,
        };
      }
    }
  }

  return { ok: true };
}

function gatePathSummary(result: HuntResult): string {
  return result.gate_path
    .map((e) => {
      if ("bypassed" in e) return `gate${e.gate}=bypass(${e.bypassed})`;
      if (e.pass === true) return `gate${e.gate}=pass`;
      if (e.pass === false && "skip" in e) return `gate${e.gate}=skip(${e.skip.code})`;
      if (e.pass === false && "reason" in e) return `gate${e.gate}=skip(${e.reason.slice(0, 24)})`;
      return `gate${e.gate}=?`;
    })
    .join(" → ");
}

function summarize(result: HuntResult): string {
  const d = result.decision;
  if (d.should_bid) {
    return `BID $${d.bid_usdc.toFixed(2)} · ad=${d.ad_id} · zone=${d.zone} · "${d.opening_message.slice(0, 60)}"`;
  }
  return `SKIP · ${d.reason.slice(0, 80)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

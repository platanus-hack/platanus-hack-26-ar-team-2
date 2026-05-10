/**
 * Market signals — derived per tick (C-14).
 *
 * Two shapes:
 *
 *   - `BrandHuntSignals`       (per-zone "primary" floor + fair_value tuple)
 *                              Consumed by `huntForBrand()` (C-08).
 *
 *   - `StreamerMarketSignals`  (per-zone fair / reserve / aspiration tuples)
 *                              Consumed by `streamerEvaluate()` (C-09) +
 *                              `runNegotiation()` (C-10).
 *
 * The two shapes intentionally differ — brand-agents need a single "this is
 * what the manager wants you to bid for" zone; the streamer-agent needs the
 * full ZoneAmounts so the post-LLM RP gate can clamp regardless of which
 * zone the LLM picked.
 *
 * Heuristics:
 *   - `intensity_label` derives from tick.energy_level + audio_intent.
 *   - Per-zone `fair_value` = base × intensity_multiplier.
 *   - `dynamic_reserve` = fair_value × 0.5 (clamped at floor).
 *   - `aspiration` = fair_value × 1.4.
 *
 * Tunable via env (MANAGER_MARKET_SIGNALS_*) without a code change. No env
 * lookups per call — defaults are inlined.
 */

import type { ContextChunk } from "@/lib/manager/types";
import type {
  MarketSignals as StreamerMarketSignals,
  ManagerHint,
  ZoneAmounts,
} from "@/lib/agents/streamer/types";
import type { MarketSignals as BrandHuntSignals, ManagerDecisionSummary } from "@/lib/agents/brand/huntForBrand";
import type { ZoneId } from "@/lib/agents/types";

// Base fair value per zone (USDC) before intensity multiplier. Calibrated to
// docs/PITCH.md examples — lower_third around $1, fullscreen 3×, corner 0.5×.
const BASE_FAIR_VALUE: ZoneAmounts = {
  lower_third: 1.0,
  fullscreen_takeover: 3.0,
  bottom_right_corner: 0.5,
};

// Inventory floors mirror INVENTORY_DEFAULTS in lib/db.ts (cents → dollars).
const ZONE_FLOOR_USDC: ZoneAmounts = {
  lower_third: 0.5,
  fullscreen_takeover: 3.0,
  bottom_right_corner: 0.25,
};

const ZONE_DURATION_S: ZoneAmounts = {
  lower_third: 8,
  fullscreen_takeover: 30,
  bottom_right_corner: 30,
};

// Intensity → multiplier on top of base fair value.
const INTENSITY_MULTIPLIER: Record<StreamerMarketSignals["intensity_label"], number> = {
  epic: 1.6,
  building: 1.2,
  rage: 0.9,
  mundane: 0.7,
};

const ZONES_ALL: ZoneId[] = ["lower_third", "fullscreen_takeover", "bottom_right_corner"];

export type ComputedMarketSignals = {
  streamer: StreamerMarketSignals;
  /** Per-brand hunt input — driven by the zone the manager recommends. */
  hunt: BrandHuntSignals;
  /** Compressed manager hint forwarded to negotiation + streamerEvaluate. */
  manager_hint: ManagerHint;
};

export type ComputeArgs = {
  tick: ContextChunk;
  manager_decision: ManagerDecisionSummary;
  /** Optional override (e.g. FULL BREAK hotkey forces fullscreen_takeover). */
  forced_zone?: ZoneId;
};

export function computeMarketSignals(args: ComputeArgs): ComputedMarketSignals {
  const intensityLabel = deriveIntensity(args.tick);
  const multiplier = INTENSITY_MULTIPLIER[intensityLabel];

  const fairValue: ZoneAmounts = {
    lower_third: round2(BASE_FAIR_VALUE.lower_third * multiplier),
    fullscreen_takeover: round2(BASE_FAIR_VALUE.fullscreen_takeover * multiplier),
    bottom_right_corner: round2(BASE_FAIR_VALUE.bottom_right_corner * multiplier),
  };

  const dynamicReserve: ZoneAmounts = {
    lower_third: Math.max(ZONE_FLOOR_USDC.lower_third, round2(fairValue.lower_third * 0.5)),
    fullscreen_takeover: Math.max(
      ZONE_FLOOR_USDC.fullscreen_takeover,
      round2(fairValue.fullscreen_takeover * 0.5),
    ),
    bottom_right_corner: Math.max(
      ZONE_FLOOR_USDC.bottom_right_corner,
      round2(fairValue.bottom_right_corner * 0.5),
    ),
  };

  const aspiration: ZoneAmounts = {
    lower_third: round2(fairValue.lower_third * 1.4),
    fullscreen_takeover: round2(fairValue.fullscreen_takeover * 1.4),
    bottom_right_corner: round2(fairValue.bottom_right_corner * 1.4),
  };

  const streamer: StreamerMarketSignals = {
    intensity_label: intensityLabel,
    intensity_multiplier: multiplier,
    fair_value_usdc: fairValue,
    dynamic_reserve_usdc: dynamicReserve,
    streamer_aspiration_usdc: aspiration,
  };

  const primaryZone: ZoneId = args.forced_zone ?? pickPrimaryZone(intensityLabel);

  const hunt: BrandHuntSignals = {
    zone: primaryZone,
    zone_floor_usdc: ZONE_FLOOR_USDC[primaryZone],
    fair_value_usdc: fairValue[primaryZone],
    competitor_count: estimateCompetitors(args.manager_decision),
    suggested_duration_s: ZONE_DURATION_S[primaryZone],
  };

  const manager_hint: ManagerHint = {
    intensity_label: intensityLabel,
    recommended_zones: recommendedZones(intensityLabel, primaryZone),
    recommended_max_duration_s: ZONE_DURATION_S[primaryZone],
    brand_safety_pre_flag: null,
    reason: args.manager_decision.reason ?? "",
  };

  return { streamer, hunt, manager_hint };
}

function deriveIntensity(tick: ContextChunk): StreamerMarketSignals["intensity_label"] {
  const energy = tick.energy_level;
  if (energy === "epic") return "epic";
  if (energy === "high") {
    // High-energy + reaction/recommendation = building (lifting toward epic);
    // pure complaints with high energy → rage.
    if (tick.audio_intent === "complaint") return "rage";
    return "building";
  }
  if (energy === "medium") return "building";
  return "mundane";
}

function pickPrimaryZone(label: StreamerMarketSignals["intensity_label"]): ZoneId {
  // Episodic ad layout: epic → lower_third (highest fill rate),
  // building → lower_third, rage → corner (less invasive),
  // mundane → corner. Fullscreen is manual-only (FULL BREAK hotkey).
  if (label === "epic" || label === "building") return "lower_third";
  return "bottom_right_corner";
}

function recommendedZones(
  label: StreamerMarketSignals["intensity_label"],
  primary: ZoneId,
): ZoneId[] {
  // Primary first; secondary always corner (always-on inventory floor).
  if (primary === "lower_third") return ["lower_third", "bottom_right_corner"];
  if (primary === "fullscreen_takeover") {
    return ["fullscreen_takeover", "lower_third", "bottom_right_corner"];
  }
  // primary === bottom_right_corner — keep the list short, mundane moments
  // shouldn't compete with episodic placements.
  return label === "rage" || label === "mundane"
    ? ["bottom_right_corner"]
    : ["bottom_right_corner", "lower_third"];
}

function estimateCompetitors(md: ManagerDecisionSummary): number {
  // Higher brand_match → more brands likely to fire gate3 pass → more competitors.
  // Range 1..5, roughly mirrors the 5-brand registry we run today.
  if (md.brand_match >= 0.85) return 5;
  if (md.brand_match >= 0.7) return 4;
  if (md.brand_match >= 0.55) return 3;
  if (md.brand_match >= 0.4) return 2;
  return 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const _internals = {
  ZONES_ALL,
  ZONE_FLOOR_USDC,
  BASE_FAIR_VALUE,
  ZONE_DURATION_S,
  INTENSITY_MULTIPLIER,
};

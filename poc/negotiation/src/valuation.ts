import { INVENTORY } from "./inventory.js";
import type { StreamContext, ZoneId } from "./types.js";

// Valuation layer — separates the MATH from the LLM reasoning.
// Both brand-agents and the streamer-agent receive the same MarketSignals
// (a shared baseline). The LLMs then add their private adjustments
// (brand fit, mandate constraints, strategic posture) on top.
//
// CPMs are TOY-SCALED 10× down from real LATAM gaming benchmarks so the
// numbers fit the demo brand-wallet economy ($5 USDC per wallet, $0.5-$8 bids).
// The RATIOS between zones (corner << lower_third << fullscreen) and the
// intensity scaling preserve real auction dynamics.
//
// Real-world reference (NOT used here directly, only as ratio source):
//   Display ads $1-5 CPM, gaming/video $5-20 CPM, premium midroll $20-40 CPM
//   (IAB OpenRTB 2.6, IAB display ad pricing surveys 2024-25).

/** Reference CPM (USD per 1000 impressions) per zone, BEFORE intensity scaling. */
export const REFERENCE_CPM_USDC: Record<ZoneId, number> = {
  bottom_right_corner: 0.3,  // low attention, persistent — cheap inventory
  lower_third: 1.0,          // active sight, episodic — premium
  fullscreen_takeover: 3.0,  // forced attention, manual — premium²
};

/**
 * Streamer's reserve as a fraction of fair_value. Real first-price auctions
 * set reserves well below fair value (sellers expect price discovery, not full
 * theoretical payment). 0.20 is a reasonable middle ground for our toy market.
 */
export const RESERVE_FRACTION_OF_FAIR_VALUE = 0.20;

/**
 * Streamer's aspiration as a fraction of fair_value. Concession curve
 * starts here (high end) and concedes toward dynamic_reserve (low end)
 * across the auction's rounds.
 */
export const ASPIRATION_FRACTION_OF_FAIR_VALUE = 0.65;

/** View-through rate per zone — what % of viewers actually register the ad. */
export const VIEW_THROUGH_RATE: Record<ZoneId, number> = {
  bottom_right_corner: 0.55,
  lower_third: 0.85,
  fullscreen_takeover: 0.95,
};

export type IntensityLabel = "calm" | "building" | "epic" | "rage_negative";

export type MarketSignals = {
  /** 0-1 normalized intensity of the moment */
  moment_intensity: number;
  intensity_label: IntensityLabel;
  /** Multiplier applied to baseline CPMs */
  intensity_multiplier: number;
  /** What % of viewers actually see/process an ad in this zone */
  expected_impressions: Record<ZoneId, number>;
  /** Effective CPM after intensity scaling */
  effective_cpm_usdc: Record<ZoneId, number>;
  /** Suggested fair value in USDC for a slot in this zone, given current context */
  fair_value_usdc: Record<ZoneId, number>;
  /**
   * Streamer's dynamic reserve per zone — the floor below which the streamer
   * should not accept regardless of mandate's hard_floor.
   * Computed as fair_value × discipline_factor.
   */
  dynamic_reserve_usdc: Record<ZoneId, number>;
  /**
   * Streamer's aspiration per zone — the HIGH end of its concession curve
   * (where round-1 counters start). fair_value × aspiration_factor.
   */
  streamer_aspiration_usdc: Record<ZoneId, number>;
  /** Human-readable explanation of how intensity was computed (for logs/audit). */
  reasoning: string;
};

/**
 * Compute intensity 0-1 from chat velocity spike, sentiment, and audio salience.
 *
 * Heuristic mix (weights chosen for legibility, NOT trained):
 *   chat_spike (35%) — actual viewer reaction signal
 *   sentiment (25%)  — emotional polarity (negative ≠ low intensity, but bad for fit)
 *   audio_salience (25%) — caps spikes (transcript ALL CAPS, exclamation density)
 *   audience_size (15%) — bigger audience = bigger moment
 */
export function computeIntensity(ctx: StreamContext): {
  intensity: number;
  label: IntensityLabel;
  multiplier: number;
  reasoning: string;
} {
  const spikeRatio = ctx.chat_velocity_msgs / Math.max(1, ctx.chat_baseline_msgs);
  // log-scale the spike: 1× → 0, 10× → ~0.6, 20× → ~0.7, capped at 1
  const chatScore = Math.min(1, Math.log10(Math.max(1, spikeRatio)) / 1.3);

  // sentiment is 0-1 but we want absolute "energy". 0.5 is neutral=low energy,
  // 0.9 is strong positive, 0.1 is strong negative. Both extremes = high energy.
  const sentimentScore = Math.abs(ctx.sentiment - 0.5) * 2; // 0..1

  // Audio salience: caps + exclamations as proxies. Real impl: prosody from STT.
  const upper = (ctx.audio_30s.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length;
  const total = Math.max(1, ctx.audio_30s.length);
  const exclam = (ctx.audio_30s.match(/!/g) ?? []).length;
  const audioScore = Math.min(1, (upper / total) * 1.5 + Math.min(1, exclam / 5) * 0.3);

  // Audience score: log-scale viewers. 1k → 0.3, 5k → 0.6, 10k → 0.75, 50k → 1
  const audienceScore = Math.min(1, Math.log10(Math.max(1, ctx.viewers)) / 4.7);

  const intensity =
    chatScore * 0.35 +
    sentimentScore * 0.25 +
    audioScore * 0.25 +
    audienceScore * 0.15;

  let label: IntensityLabel;
  let multiplier: number;
  if (ctx.sentiment < 0.3 && intensity > 0.5) {
    label = "rage_negative";
    multiplier = 0.6; // high energy but bad-vibe — most brands avoid
  } else if (intensity >= 0.7) {
    label = "epic";
    multiplier = 1.8;
  } else if (intensity >= 0.45) {
    label = "building";
    multiplier = 1.2;
  } else {
    label = "calm";
    multiplier = 0.5;
  }

  const reasoning =
    `chat_spike=${spikeRatio.toFixed(1)}× (score ${chatScore.toFixed(2)}), ` +
    `sentiment=${ctx.sentiment.toFixed(2)} (score ${sentimentScore.toFixed(2)}), ` +
    `audio_salience=${audioScore.toFixed(2)}, audience=${ctx.viewers} (score ${audienceScore.toFixed(2)}) ` +
    `→ intensity=${intensity.toFixed(2)} → label=${label} → CPM ×${multiplier}`;

  return { intensity, label, multiplier, reasoning };
}

export function computeMarketSignals(ctx: StreamContext): MarketSignals {
  const { intensity, label, multiplier, reasoning } = computeIntensity(ctx);

  const expected_impressions: Record<ZoneId, number> = {} as Record<ZoneId, number>;
  const effective_cpm_usdc: Record<ZoneId, number> = {} as Record<ZoneId, number>;
  const fair_value_usdc: Record<ZoneId, number> = {} as Record<ZoneId, number>;
  const dynamic_reserve_usdc: Record<ZoneId, number> = {} as Record<ZoneId, number>;
  const streamer_aspiration_usdc: Record<ZoneId, number> = {} as Record<ZoneId, number>;

  for (const zone of Object.keys(INVENTORY) as ZoneId[]) {
    const impressions = ctx.viewers * VIEW_THROUGH_RATE[zone];
    const eCpm = REFERENCE_CPM_USDC[zone] * multiplier;
    const fair = (eCpm * impressions) / 1000;
    const reserve = Math.max(INVENTORY[zone].min_bid_usdc, fair * RESERVE_FRACTION_OF_FAIR_VALUE);
    const aspiration = Math.max(reserve * 1.5, fair * ASPIRATION_FRACTION_OF_FAIR_VALUE);

    expected_impressions[zone] = Math.round(impressions);
    effective_cpm_usdc[zone] = Number(eCpm.toFixed(2));
    fair_value_usdc[zone] = Number(fair.toFixed(2));
    dynamic_reserve_usdc[zone] = Number(reserve.toFixed(2));
    streamer_aspiration_usdc[zone] = Number(aspiration.toFixed(2));
  }

  return {
    moment_intensity: Number(intensity.toFixed(2)),
    intensity_label: label,
    intensity_multiplier: multiplier,
    expected_impressions,
    effective_cpm_usdc,
    fair_value_usdc,
    dynamic_reserve_usdc,
    streamer_aspiration_usdc,
    reasoning,
  };
}

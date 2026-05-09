/**
 * Stage 1 — semantic salience filter (no LLM, ~0ms, $0).
 *
 * A chunk is "auctionable" only if at least one of:
 *   • audio_intent ∈ {reaction, recommendation}
 *   • audio_mentions has ≥ 1 entry
 *   • viewers_delta_30s > +100  (audience surge)
 *
 * Per the C-08m spec — replaces the deprecated B-07a numeric `cheap_intensity`.
 */

import type { ContextChunk } from "./types";

const VIEWER_SURGE_THRESHOLD = 100;
const ACTIONABLE_INTENTS = new Set(["reaction", "recommendation"]);

export type Stage1Result =
  | { pass: true; reason: string }
  | { pass: false; reason: string };

export function stage1Filter(chunk: ContextChunk): Stage1Result {
  const reasons: string[] = [];

  if (chunk.audio_intent && ACTIONABLE_INTENTS.has(chunk.audio_intent)) {
    reasons.push(`intent=${chunk.audio_intent}`);
  }
  if (chunk.audio_mentions && chunk.audio_mentions.length > 0) {
    reasons.push(`mentions=[${chunk.audio_mentions.slice(0, 3).join(",")}]`);
  }
  if (chunk.viewers_delta_30s != null && chunk.viewers_delta_30s > VIEWER_SURGE_THRESHOLD) {
    reasons.push(`viewers_delta=+${chunk.viewers_delta_30s}`);
  }

  if (reasons.length === 0) {
    return {
      pass: false,
      reason: `no semantic signal (intent=${chunk.audio_intent ?? "?"}, mentions=${chunk.audio_mentions?.length ?? 0}, dv=${chunk.viewers_delta_30s ?? "?"})`,
    };
  }
  return { pass: true, reason: reasons.join(" + ") };
}

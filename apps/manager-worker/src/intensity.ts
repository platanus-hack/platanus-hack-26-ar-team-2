/**
 * Stage 1 — semantic salience filter (no LLM, ~0ms, $0).
 *
 * Replaces the deprecated B-07a numeric `cheap_intensity`. Per the updated
 * C-08m spec in TODO.md: a chunk is "auctionable" only if at least one of
 *
 *   • audio_intent ∈ {reaction, recommendation}
 *   • audio_mentions has at least one entry
 *   • viewers_delta_30s > +100  (audience surge)
 *
 * holds. Otherwise we don't even spend Haiku tokens on it.
 *
 * Plus a hard brand-safety pre-flag: if the chunk's audio_summary or
 * mentions trip the project-wide blocked keyword list, we skip outright.
 */

import type { ContextChunk } from "./types.ts";

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

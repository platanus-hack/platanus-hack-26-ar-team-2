/**
 * applyGateLadder — wires gate1 into the manager-cron flow (C-08a).
 *
 * Runs gate1 against every brand passed in, splits them into surviving
 * (pass) and skips. The cron tick uses this BEFORE the picker LLM call so
 * the picker only sees brands that actually qualify for the moment.
 *
 * Currently MVP-3-niveles ladder: gate1 → (gate2 deferred) → gate3 → gate4.
 * Gate3 + Gate4 are NOT applied here — gate3 is per-brand Haiku triage
 * that fits in the per-brand brand-agent pattern (C-08d), and the manager
 * picker collapses gate3+gate4 into one pick today. When the C-08d
 * restructure lands this helper extends to also call gate3.
 *
 * Logging: every brand evaluation emits a structured `tag: gate1:eval`
 * line; the aggregate emits `tag: gates:applied`. Both are JSON for easy
 * Vercel function-log filtering.
 *
 * Consumes `LoadedBrand[]` from the YAML loader (post-34bb440 rebrand) —
 * `MandateExtensions` come from `brand.ext`, the canonical mandate from
 * `brand.payload`. No more mirrored `mandate_ext` field on the client
 * `Brand` type.
 */

import type { LoadedBrand } from "@/lib/agents/brands/loader";

import type { Gate1Context, GateSkipReason, StreamMetadata } from "../../types";

import { evaluateGate1 } from "./gate1Mandate";

export type GateLadderArgs = {
  brands: readonly LoadedBrand[];
  context: Gate1Context;
  stream?: StreamMetadata | null;
  /** Optional logger correlation — surfaces in the structured logs. */
  log_context?: { stream_key?: string; chunk_id?: string };
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: Date;
};

export type GateLadderResult = {
  surviving: LoadedBrand[];
  skips: GateSkipReason[];
  /** Total wall time spent in gate evaluation. */
  latency_ms: number;
};

export function applyGateLadder(args: GateLadderArgs): GateLadderResult {
  const startedAt = Date.now();
  const surviving: LoadedBrand[] = [];
  const skips: GateSkipReason[] = [];

  for (const brand of args.brands) {
    const result = evaluateGate1({
      brandId: brand.slug,
      brandDisplayName: brand.payload.display_name,
      mandate: brand.payload,
      ext: brand.ext,
      context: args.context,
      stream: args.stream ?? null,
      now: args.now,
    });

    if (result.pass) {
      console.log(
        JSON.stringify({
          tag: "gate1:eval",
          ...args.log_context,
          brand_id: brand.slug,
          pass: true,
          always_bid_floor: brand.payload.always_bid_floor ?? false,
        }),
      );
      surviving.push(brand);
    } else {
      console.log(
        JSON.stringify({
          tag: "gate1:eval",
          ...args.log_context,
          brand_id: brand.slug,
          pass: false,
          code: result.skip.code,
          detail: result.skip.detail,
        }),
      );
      skips.push(result.skip);
    }
  }

  const latency_ms = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      tag: "gates:applied",
      ...args.log_context,
      brand_count: args.brands.length,
      surviving_count: surviving.length,
      surviving_ids: surviving.map((b) => b.slug),
      skip_count: skips.length,
      skip_summary: skips.map((s) => ({
        brand_id: s.brand_id,
        gate: s.gate,
        code: s.code,
      })),
      latency_ms,
    }),
  );

  return { surviving, skips, latency_ms };
}

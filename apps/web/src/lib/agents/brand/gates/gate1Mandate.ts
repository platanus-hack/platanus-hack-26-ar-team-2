/**
 * Gate1 — deterministic mandate filter (C-08a).
 *
 * Pure function, no LLM, ~0ms, $0. First gate of the ladder
 * (docs/GATES.md §2 + §8.1). Decides whether a brand even gets to spend
 * Haiku/Sonnet tokens evaluating a context tick.
 *
 * Order of evaluation (early-return on first failure, per GATES.md §8.1):
 *   1. budget          → daily_cap_exceeded · available_balance_below_min_bid
 *   2. brand_safety    → blocked_keyword · blocked_competitor_brand · blocked_category
 *   3. event_filters   → category_not_preferred · viewers_{below_min,above_max}
 *                       · missing_required_tag · missing_required_chat_keyword
 *   4. dayparts        → outside_daypart (with wrap-around for HH-HH past midnight)
 *
 * Bypass: brands with `always_bid_floor: true` (TermoFlex) skip gate3/4
 * downstream but still pass gate1 brand_safety + budget + dayparts.
 * event_filters are skipped for them — DESIGN.md §4 + GATES.md §2.1.
 *
 * Daily-cap check is gated on `mandate.spent_today_usdc != null`. The cron
 * variant of the manager doesn't yet track per-brand spend (C-08d); when
 * `spent_today_usdc` is undefined the budget block is skipped silently.
 */

import type {
  BrandMandate,
  Gate1Context,
  Gate1ReasonCode,
  GateSkipReason,
  MandateExtensions,
  StreamMetadata,
} from "../../types";

export type Gate1Result = { pass: true } | { pass: false; skip: GateSkipReason };

export type Gate1Args = {
  brandId: string;
  brandDisplayName: string;
  mandate: BrandMandate;
  ext: MandateExtensions;
  context: Gate1Context;
  /** Optional — gate1 still evaluates `preferred_categories` against `context.game_category` if absent. */
  stream?: StreamMetadata | null;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: Date;
};

export function evaluateGate1(args: Gate1Args): Gate1Result {
  const { brandId, brandDisplayName, mandate, ext, context, stream, now } = args;
  const t = now ?? new Date();

  // ─── 1. Budget ─────────────────────────────────────────────────────
  if (
    mandate.spent_today_usdc != null &&
    mandate.spent_today_usdc >= mandate.daily_cap_usdc
  ) {
    return skip(brandId, brandDisplayName, "daily_cap_exceeded", {
      detail: `$${mandate.spent_today_usdc.toFixed(2)}/$${mandate.daily_cap_usdc.toFixed(2)}`,
      human: `${brandDisplayName} → SKIP gate1: daily cap quemado`,
    });
  }

  // ─── 2. Brand-safety ───────────────────────────────────────────────
  // Build the haystack once: lower-cased union of audio_text + mentions +
  // chat_recent_keywords + audio_topics. Used for blocked_keyword and
  // blocked_competitor_brand whole-word scans (Unicode-aware so accented
  // keywords like "café", "fogón" work; and "hack" doesn't match "hackathon").
  const haystack = buildHaystack(context);

  const safety = ext.brand_safety;
  if (safety) {
    const blockedKw = findFirstWord(haystack, safety.blocked_keywords ?? []);
    if (blockedKw) {
      return skip(brandId, brandDisplayName, "blocked_keyword", {
        detail: blockedKw,
        human: `${brandDisplayName} → SKIP gate1: keyword bloqueada "${blockedKw}"`,
      });
    }

    const blockedCompetitor = findFirstWord(
      haystack,
      safety.blocked_competitor_brands ?? [],
    );
    if (blockedCompetitor) {
      return skip(brandId, brandDisplayName, "blocked_competitor_brand", {
        detail: blockedCompetitor,
        human: `${brandDisplayName} → SKIP gate1: competidor mencionado (${blockedCompetitor})`,
      });
    }

    const blockedCategory = findFirstCategory(
      [stream?.category ?? null, context.game_category ?? null],
      safety.blocked_categories ?? [],
    );
    if (blockedCategory) {
      return skip(brandId, brandDisplayName, "blocked_category", {
        detail: blockedCategory,
        human: `${brandDisplayName} → SKIP gate1: categoría bloqueada (${blockedCategory})`,
      });
    }
  }

  // ─── 3. Event filters ──────────────────────────────────────────────
  // GATES.md §2.1 — default bidder bypasses event_filters entirely.
  // It only needs brand_safety + dayparts (above + below). This way the
  // floor offer survives in any context that isn't brand-unsafe, even when
  // the moment doesn't match the bidder's targeting profile.
  const ev = ext.event_filters;
  if (ev && !mandate.always_bid_floor) {
    // Category check is lenient: if neither stream.category nor
    // chunk.game_category is set, we have no signal to reject on. This
    // lets harness fixtures + early pipeline ticks pass when categorization
    // hasn't landed yet — only an explicit non-preferred category SKIPs.
    const streamCat = stream?.category?.trim() || null;
    const gameCat = context.game_category?.trim() || null;
    const hasCategorySignal = !!streamCat || !!gameCat;
    if (
      ev.preferred_categories &&
      ev.preferred_categories.length > 0 &&
      hasCategorySignal &&
      !categoryAllowed(streamCat, gameCat, ev.preferred_categories)
    ) {
      const got = streamCat ?? gameCat ?? "(none)";
      return skip(brandId, brandDisplayName, "category_not_preferred", {
        detail: `got=${got}, expected=[${ev.preferred_categories.join(",")}]`,
        human: `${brandDisplayName} → SKIP gate1: categoría no preferida (${got})`,
      });
    }

    if (ev.min_viewers != null && context.viewers != null && context.viewers < ev.min_viewers) {
      return skip(brandId, brandDisplayName, "viewers_below_min", {
        detail: `viewers=${context.viewers} < min=${ev.min_viewers}`,
        human: `${brandDisplayName} → SKIP gate1: poca audiencia (${context.viewers} < ${ev.min_viewers})`,
      });
    }

    if (ev.max_viewers != null && context.viewers != null && context.viewers > ev.max_viewers) {
      return skip(brandId, brandDisplayName, "viewers_above_max", {
        detail: `viewers=${context.viewers} > max=${ev.max_viewers}`,
        human: `${brandDisplayName} → SKIP gate1: audiencia muy grande para su mandate (${context.viewers} > ${ev.max_viewers})`,
      });
    }

    if (ev.required_any_tag && ev.required_any_tag.length > 0) {
      const tagPool = collectTags(context);
      const hit = ev.required_any_tag.find((t) => tagPool.has(t.toLowerCase()));
      if (!hit) {
        const got = [...tagPool].slice(0, 4).join(",") || "(none)";
        return skip(brandId, brandDisplayName, "missing_required_tag", {
          detail: `expected_any=[${ev.required_any_tag.join(",")}], got=[${got}]`,
          human: `${brandDisplayName} → SKIP gate1: este momento no es para mí (tags no calzan)`,
        });
      }
    }

    if (ev.required_chat_keyword_any && ev.required_chat_keyword_any.length > 0) {
      const hit = findFirstWord(haystack, ev.required_chat_keyword_any);
      if (!hit) {
        return skip(brandId, brandDisplayName, "missing_required_chat_keyword", {
          detail: `expected_any=[${ev.required_chat_keyword_any.join(",")}]`,
          human: `${brandDisplayName} → SKIP gate1: el chat no menciona ninguna keyword esperada`,
        });
      }
    }
  }

  // ─── 4. Dayparts ───────────────────────────────────────────────────
  if (ext.dayparts && ext.dayparts.active && ext.dayparts.active.length > 0) {
    const inside = ext.dayparts.active.some((window) => isInsideDaypart(t, window));
    if (!inside) {
      const hh = formatHHMM(t);
      return skip(brandId, brandDisplayName, "outside_daypart", {
        detail: `now=${hh}, windows=[${ext.dayparts.active.join(", ")}]`,
        human: `${brandDisplayName} → SKIP gate1: fuera de horario (${hh}, ventanas ${ext.dayparts.active.join(" / ")})`,
      });
    }
  }

  return { pass: true };
}

// ─── helpers ─────────────────────────────────────────────────────────

function skip(
  brandId: string,
  brandDisplayName: string,
  code: Gate1ReasonCode,
  args: { detail?: string; human: string },
): { pass: false; skip: GateSkipReason } {
  return {
    pass: false,
    skip: {
      brand_id: brandId,
      brand_display_name: brandDisplayName,
      gate: 1,
      code,
      detail: args.detail,
      human_message: args.human,
    },
  };
}

function buildHaystack(c: Gate1Context): string {
  const parts: string[] = [];
  if (c.audio_text) parts.push(c.audio_text);
  if (c.audio_mentions) parts.push(c.audio_mentions.join(" "));
  if (c.audio_topics) parts.push(c.audio_topics.join(" "));
  if (c.chat_recent_keywords) parts.push(c.chat_recent_keywords.join(" "));
  return parts.join(" ").toLowerCase();
}

/**
 * Whole-word match. Unicode-aware (handles "café" / "fogón") and avoids
 * false positives like "hack" inside "hackathon". Multi-word needles
 * (e.g. "concha de") work — only the boundaries need to be non-letter.
 *
 * Returns the FIRST needle that matches (in `needles` order), or null.
 */
function findFirstWord(haystack: string, needles: string[]): string | null {
  if (!haystack) return null;
  for (const n of needles) {
    if (!n) continue;
    const lower = n.toLowerCase();
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(lower, from);
      if (idx === -1) break;
      const before = idx > 0 ? haystack[idx - 1] : "";
      const after = idx + lower.length < haystack.length ? haystack[idx + lower.length] : "";
      if (isWordBoundary(before) && isWordBoundary(after)) return n;
      from = idx + 1;
    }
  }
  return null;
}

/** True iff `c` is "" (string edge) or any non-letter/non-digit Unicode char. */
function isWordBoundary(c: string): boolean {
  if (c === "") return true;
  return !/[\p{L}\p{N}_]/u.test(c);
}

function findFirstCategory(values: (string | null)[], blocked: string[]): string | null {
  const lower = values.filter((v): v is string => !!v).map((v) => v.toLowerCase());
  for (const b of blocked) {
    if (!b) continue;
    if (lower.includes(b.toLowerCase())) return b;
  }
  return null;
}

function categoryAllowed(
  streamCategory: string | undefined | null,
  gameCategory: string | undefined | null,
  preferred: string[],
): boolean {
  const lower = preferred.map((p) => p.toLowerCase());
  for (const v of [streamCategory, gameCategory]) {
    if (v && lower.includes(v.toLowerCase())) return true;
  }
  return false;
}

function collectTags(c: Gate1Context): Set<string> {
  const s = new Set<string>();
  if (c.mood_tags) for (const t of c.mood_tags) s.add(t.toLowerCase());
  if (c.scene_type) s.add(c.scene_type.toLowerCase());
  return s;
}

// ─── Daypart parsing ─────────────────────────────────────────────────

/**
 * Returns true if `now` is inside `window` (e.g. "13:00-15:00 ART").
 * Handles wrap-around past midnight ("20:00-02:00 ART" matches 01:30 ART).
 *
 * Timezone is read from the suffix (after the space). If absent or
 * unrecognized, falls back to the runtime's local TZ. ART is canonical
 * for the demo (UTC-3, no DST transitions during the hackathon window).
 */
export function isInsideDaypart(now: Date, window: string): boolean {
  const parsed = parseDaypartWindow(window);
  if (!parsed) return true; // malformed window → don't block
  const minutesNow = wallClockMinutes(now, parsed.tz);
  const { startMin, endMin } = parsed;

  if (startMin <= endMin) {
    return minutesNow >= startMin && minutesNow <= endMin;
  }
  // Wrap-around: 20:00-02:00 active either after 20:00 OR before 02:00.
  return minutesNow >= startMin || minutesNow <= endMin;
}

function parseDaypartWindow(
  window: string,
): { startMin: number; endMin: number; tz: string | null } | null {
  // "HH:MM-HH:MM TZ" — TZ optional.
  const match = window.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})(?:\s+([A-Z]{2,5}))?$/);
  if (!match) return null;
  const [, h1, m1, h2, m2, tz] = match;
  const startMin = parseInt(h1!, 10) * 60 + parseInt(m1!, 10);
  const endMin = parseInt(h2!, 10) * 60 + parseInt(m2!, 10);
  return { startMin, endMin, tz: tz ?? null };
}

const TZ_OFFSET_MINUTES: Record<string, number> = {
  ART: -180, // UTC-3
  ARG: -180,
  UTC: 0,
  GMT: 0,
};

function wallClockMinutes(d: Date, tz: string | null): number {
  if (tz && tz in TZ_OFFSET_MINUTES) {
    const offsetMin = TZ_OFFSET_MINUTES[tz]!;
    const utcMillis = d.getTime();
    const wall = new Date(utcMillis + offsetMin * 60_000);
    return wall.getUTCHours() * 60 + wall.getUTCMinutes();
  }
  // Unknown TZ → use local clock. Fine for dev; tz tag in YAMLs (ART)
  // covers the demo path.
  return d.getHours() * 60 + d.getMinutes();
}

function formatHHMM(d: Date, tz?: string | null): string {
  const offsetMin = tz && tz in TZ_OFFSET_MINUTES ? TZ_OFFSET_MINUTES[tz]! : null;
  const target = offsetMin == null ? d : new Date(d.getTime() + offsetMin * 60_000);
  const h = (offsetMin == null ? target.getHours() : target.getUTCHours())
    .toString()
    .padStart(2, "0");
  const m = (offsetMin == null ? target.getMinutes() : target.getUTCMinutes())
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}

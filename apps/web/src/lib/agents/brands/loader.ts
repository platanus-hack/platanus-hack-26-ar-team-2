/**
 * Brand mandate loader (C-02 + C-02b/c/d/e).
 *
 * Reads `apps/web/src/lib/agents/brands/*.yaml` and splits each into:
 *   - payload: BrandMandate              → mandates.payload jsonb
 *   - prompt:  BrandPrompt               → mandates.prompt  jsonb (C-02 / migration 0005)
 *   - ext:     MandateExtensions         → consumed by gate ladder (C-08a..d, no DB in MVP)
 *   - ad_variants: AdVariant[]           → consumed by D-10 pregen-brand-ads.ts
 *
 * The YAML is the human-friendly source; this loader maps it to the canonical
 * shapes defined in ../types.ts. Missing optional fields (gate-ladder ext,
 * prompt) fall back to no-op defaults — backwards compatible with mandates
 * that pre-date the gate ladder spec.
 *
 * Used by:
 *   - scripts/seed-mandates.ts (C-06)         — inserts into mandates table
 *   - apps/web/src/lib/agents/brand/runner.ts — at boot to register agents
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import type {
  BrandMandate,
  BrandPrompt,
  MandateExtensions,
  StreamMetadata,
  ZoneId,
} from "../types";

// ─── Local types only used by D-10 ad pre-gen ─────────────────────────

/** Catalog entry for a creative the brand has (or wants pre-generated). */
export type AdVariant = {
  name: string;
  zone: ZoneId;
  duration_ms: number;
  mood_tags: string[];
};

/** What loadBrandMandates() returns per YAML. */
export type LoadedBrand = {
  /** Slug used as filename + brand_id (e.g. "cafetito"). */
  slug: string;
  payload: BrandMandate;
  prompt: BrandPrompt | null;
  ext: MandateExtensions;
  ad_variants: AdVariant[];
  /** Agent-facing description for Claude to compare against audio. */
  description: string;
  /** Hint keywords for stub picker + Claude signal. */
  match_keywords: string[];
  /** Pre-uploaded ad asset metadata. */
  ad: {
    asset_url?: string;
    asset_type?: "video" | "image";
    zone?: string;
    duration_ms?: number;
    position?: "top" | "center" | "bottom";
  };
  /** UI/log helpers — surfaced to dashboard widgets, not persisted. */
  display: {
    color?: string;
    tagline?: string;
    tracking_url: string;
  };
};

// ─── Raw YAML shape (what's actually on disk) ────────────────────────
// Permissive on purpose — humans edit these, and we want partial mandates
// (missing gate-ladder ext, missing prompt) to still load cleanly.

type RawBrandYaml = {
  brand_id: string;
  display_name: string;
  brand_voice?: string;
  color?: string;
  tagline?: string;
  tracking_url: string;

  /** Agent-facing description: Claude uses this to decide if the audio matches this brand. */
  description?: string;
  /** Hint keywords for stub picker + Claude signal. */
  match_keywords?: string[];

  // Pre-uploaded ad asset (overlay renders video/image instead of text)
  ad_asset_url?: string;
  ad_asset_type?: "video" | "image";
  ad_zone?: string;
  ad_duration_ms?: number;
  ad_position?: "top" | "center" | "bottom";

  // BrandMandate fields
  daily_cap_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  always_bid_floor?: boolean;
  concession_step_pct?: number;
  max_turns?: number;
  allowed_zones?: ZoneId[];
  preferred_zones?: ZoneId[];
  target_moods?: string[];
  avoid_moods?: string[];

  // MandateExtensions (all optional)
  event_filters?: {
    required_any_tag?: string[];
    preferred_categories?: string[];
    min_viewers?: number;
    max_viewers?: number;
    required_chat_keyword_any?: string[];
  };
  brand_safety?: {
    blocked_keywords?: string[];
    blocked_categories?: string[];
    blocked_competitor_brands?: string[];
  };
  dayparts?: { active?: string[] };
  ideal_contexts?: string[];

  // BrandPrompt (optional — streamers leave this null)
  prompt?: {
    system_persona?: string;
    voice_examples?: string[];
    dont_say?: string[];
    dont_do?: string[];
  };

  // D-10 pregen catalog
  ad_variants?: AdVariant[];
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Load and parse all brand YAMLs from `apps/web/src/lib/agents/brands/`.
 * Filename (without `.yaml`) is the slug.
 *
 * `account_id` is left as the slug — `seed-mandates.ts` (C-06) is responsible
 * for resolving slug → UUID by joining against `accounts.display_name` (set by
 * `seed-wallets.ts` to `"addie:<slug>"`).
 */
export function loadBrandMandates(brandsDir?: string): LoadedBrand[] {
  const dir = brandsDir ?? defaultBrandsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  return files.map((file) => {
    const slug = basename(file, ".yaml");
    const raw = parseYaml<RawBrandYaml>(join(dir, file));
    return mapBrandYaml(slug, raw);
  });
}

/** Load a single stream metadata YAML by stream_id slug. */
export function loadStreamMetadata(
  streamId: string,
  streamsDir?: string,
): StreamMetadata {
  const dir = streamsDir ?? defaultStreamsDir();
  const raw = parseYaml<StreamMetadata>(join(dir, `${streamId}.yaml`));
  // Trust the YAML — types.ts is authoritative; loader doesn't transform.
  return raw;
}

// ─── Implementation ──────────────────────────────────────────────────

function mapBrandYaml(slug: string, raw: RawBrandYaml): LoadedBrand {
  const payload: BrandMandate = {
    type: "brand",
    account_id: slug, // resolved to UUID by seed-mandates.ts (C-06)
    display_name: raw.display_name,
    brand_voice: raw.brand_voice ?? "",
    daily_cap_usdc: raw.daily_cap_usdc,
    spent_today_usdc: 0,
    min_bid_usdc: raw.min_bid_usdc,
    max_bid_usdc: raw.max_bid_usdc,
    targeting: {
      games: ["any"],
      moods: raw.target_moods ?? ["any"],
    },
    brand_safety: {
      blocked_keywords: raw.brand_safety?.blocked_keywords ?? [],
    },
    always_bid_floor: raw.always_bid_floor ?? false,
    color: raw.color,
  };

  const prompt: BrandPrompt | null = raw.prompt
    ? {
        system_persona: raw.prompt.system_persona ?? "",
        voice_examples: raw.prompt.voice_examples ?? [],
        dont_say: raw.prompt.dont_say ?? [],
        dont_do: raw.prompt.dont_do ?? [],
      }
    : null;

  const ext: MandateExtensions = {};
  if (raw.event_filters) ext.event_filters = raw.event_filters;
  if (raw.brand_safety) {
    ext.brand_safety = {
      blocked_keywords: raw.brand_safety.blocked_keywords ?? [],
      blocked_categories: raw.brand_safety.blocked_categories,
      blocked_competitor_brands: raw.brand_safety.blocked_competitor_brands,
    };
  }
  if (raw.dayparts?.active && raw.dayparts.active.length > 0) {
    ext.dayparts = { active: raw.dayparts.active };
  }
  if (raw.ideal_contexts && raw.ideal_contexts.length > 0) {
    ext.ideal_contexts = raw.ideal_contexts;
  }

  return {
    slug,
    payload,
    prompt,
    ext,
    ad_variants: raw.ad_variants ?? [],
    description: raw.description ?? raw.brand_voice ?? "",
    match_keywords: raw.match_keywords ?? [],
    ad: {
      asset_url: raw.ad_asset_url,
      asset_type: raw.ad_asset_type,
      zone: raw.ad_zone,
      duration_ms: raw.ad_duration_ms,
      position: raw.ad_position,
    },
    display: {
      color: raw.color,
      tagline: raw.tagline,
      tracking_url: raw.tracking_url,
    },
  };
}

function parseYaml<T>(path: string): T {
  const text = readFileSync(path, "utf8");
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`loader: ${path} did not parse to an object`);
  }
  return parsed as T;
}

function defaultBrandsDir(): string {
  // resolve relative to this file (works in tsx/Next runtime alike)
  const here = dirname(fileURLToPath(import.meta.url));
  return here;
}

function defaultStreamsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // ../../streams from apps/web/src/lib/agents/brands/
  return join(here, "..", "..", "streams");
}

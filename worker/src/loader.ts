/**
 * Brand YAML loader — reads *.yaml from the brands directory.
 * Standalone version for the Fly.io worker (no @/ imports).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";
import type { LoadedBrand } from "./types.js";

type RawBrandYaml = {
  brand_id: string;
  display_name: string;
  brand_voice?: string;
  description?: string;
  match_keywords?: string[];
  ad_asset_url?: string;
  ad_asset_type?: "video" | "image";
  ad_zone?: string;
  ad_duration_ms?: number;
  min_bid_usdc?: number;
  max_bid_usdc?: number;
};

let _cache: LoadedBrand[] | null = null;

export function loadBrands(brandsDir: string): LoadedBrand[] {
  if (_cache) return _cache;

  const files = readdirSync(brandsDir).filter((f) => f.endsWith(".yaml"));
  _cache = files.map((file) => {
    const slug = basename(file, ".yaml");
    const text = readFileSync(join(brandsDir, file), "utf8");
    const raw = yaml.load(text) as RawBrandYaml;

    return {
      slug,
      display_name: raw.display_name,
      description: raw.description ?? raw.brand_voice ?? "",
      match_keywords: raw.match_keywords ?? [],
      ad: {
        asset_url: raw.ad_asset_url,
        asset_type: raw.ad_asset_type,
        zone: raw.ad_zone,
        duration_ms: raw.ad_duration_ms,
      },
      min_bid_usdc: raw.min_bid_usdc,
      max_bid_usdc: raw.max_bid_usdc,
    };
  });

  console.log(`[loader] loaded ${_cache.length} brands: ${_cache.map((b) => b.slug).join(", ")}`);
  return _cache;
}

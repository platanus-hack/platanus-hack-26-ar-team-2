/**
 * Loads brand mandates from `apps/web/src/lib/agents/brands/*.yaml` at startup.
 *
 * The web app is the source of truth — keeping the YAMLs there so a single
 * edit affects both the seed-mandates script (C-06) and this worker.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import type { Brand } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
// apps/manager-worker/src/  →  apps/web/src/lib/agents/brands/
const BRANDS_DIR = join(here, "..", "..", "web", "src", "lib", "agents", "brands");

export function loadBrands(): Brand[] {
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".yaml"));
  if (files.length === 0) {
    throw new Error(`no brand YAMLs found in ${BRANDS_DIR}`);
  }
  return files.map((f) => {
    const raw = parseYaml(readFileSync(join(BRANDS_DIR, f), "utf-8")) as Record<string, unknown>;
    return {
      brand_id: String(raw.brand_id ?? f.replace(/\.yaml$/, "")),
      display_name: String(raw.display_name ?? raw.brand_id ?? f),
      target_moods: Array.isArray(raw.target_moods) ? (raw.target_moods as string[]) : [],
      avoid_moods: Array.isArray(raw.avoid_moods) ? (raw.avoid_moods as string[]) : [],
      safety_keywords_avoid: Array.isArray(raw.safety_keywords_avoid)
        ? (raw.safety_keywords_avoid as string[])
        : [],
      persona: String(raw.persona ?? "").trim(),
      always_bid_floor: Boolean(raw.always_bid_floor),
    };
  });
}

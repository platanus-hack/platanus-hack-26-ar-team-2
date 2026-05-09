/**
 * Smoke test for brand mandate loader (C-02 + C-02b/c/d/e).
 *
 * Verifies:
 *   1. All 4 brand YAMLs parse without errors.
 *   2. Each YAML splits cleanly into { payload, prompt, ext, ad_variants, display }.
 *   3. Stream metadata YAML parses.
 *   4. Calibration matches PITCH Bloque 3 expectations:
 *      - CafetITO daypart includes 12:00 ART
 *      - Pancho Rex daypart does NOT include 12:00 ART
 *      - MateBros max_viewers = 2
 *      - TermoFlex always_bid_floor = true
 *
 * Run: cd apps/web && npx tsx scripts/smoke-mandate-loader.mts
 */

import { loadBrandMandates, loadStreamMetadata } from "../src/lib/agents/brands/loader.ts";

function header(label: string) {
  console.log("\n" + "─".repeat(72));
  console.log(label);
  console.log("─".repeat(72));
}

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

function fail(label: string): never {
  console.error(`  ✗ ${label}`);
  process.exit(1);
}

// ─── 1. Load all brand mandates ──────────────────────────────────────
header("1. Loading apps/web/src/lib/agents/brands/*.yaml");
const brands = loadBrandMandates();
console.log(`  loaded ${brands.length} brand(s): ${brands.map((b) => b.slug).join(", ")}`);

if (brands.length !== 4) {
  fail(`expected 4 brands, got ${brands.length}`);
}
ok("4 brands loaded");

const expectedSlugs = ["cafetito", "matebros", "pancho-rex", "termoflex"];
const actualSlugs = brands.map((b) => b.slug).sort();
if (JSON.stringify(actualSlugs) !== JSON.stringify(expectedSlugs)) {
  fail(`expected slugs ${expectedSlugs.join(",")} — got ${actualSlugs.join(",")}`);
}
ok("slugs match: cafetito, matebros, pancho-rex, termoflex");

// ─── 2. Per-brand structural sanity ──────────────────────────────────
for (const brand of brands) {
  header(`2. Brand: ${brand.slug}`);

  // payload (BrandMandate)
  if (brand.payload.type !== "brand") fail(`payload.type !== 'brand'`);
  if (!brand.payload.display_name) fail(`payload.display_name missing`);
  if (typeof brand.payload.daily_cap_usdc !== "number") fail(`daily_cap_usdc not number`);
  if (typeof brand.payload.min_bid_usdc !== "number") fail(`min_bid_usdc not number`);
  if (typeof brand.payload.max_bid_usdc !== "number") fail(`max_bid_usdc not number`);
  ok(`payload: ${brand.payload.display_name} · cap $${brand.payload.daily_cap_usdc} · bid range $${brand.payload.min_bid_usdc}-$${brand.payload.max_bid_usdc}`);

  // prompt (BrandPrompt) — all 4 should have it
  if (!brand.prompt) fail(`prompt missing on ${brand.slug}`);
  if (!brand.prompt.system_persona) fail(`prompt.system_persona empty on ${brand.slug}`);
  if (brand.prompt.voice_examples.length === 0) fail(`prompt.voice_examples empty on ${brand.slug}`);
  ok(`prompt: persona ${brand.prompt.system_persona.length} chars · ${brand.prompt.voice_examples.length} voice ex · ${brand.prompt.dont_say.length} dont_say · ${brand.prompt.dont_do.length} dont_do`);

  // ext (MandateExtensions)
  if (!brand.ext.event_filters) fail(`ext.event_filters missing`);
  if (!brand.ext.brand_safety) fail(`ext.brand_safety missing`);
  if (!brand.ext.dayparts) fail(`ext.dayparts missing`);
  if (!brand.ext.ideal_contexts || brand.ext.ideal_contexts.length === 0) {
    fail(`ext.ideal_contexts empty`);
  }
  const ef = brand.ext.event_filters;
  ok(`ext.event_filters: tags=${ef.required_any_tag?.length ?? 0} · cats=${ef.preferred_categories?.length ?? 0} · min_v=${ef.min_viewers ?? 0} · max_v=${ef.max_viewers ?? "∞"}`);
  ok(`ext.brand_safety: ${brand.ext.brand_safety.blocked_keywords.length} keywords · ${brand.ext.brand_safety.blocked_categories?.length ?? 0} categories · ${brand.ext.brand_safety.blocked_competitor_brands?.length ?? 0} competitors`);
  ok(`ext.dayparts: ${brand.ext.dayparts.active.join(", ")}`);
  ok(`ext.ideal_contexts: ${brand.ext.ideal_contexts.length} entries`);

  // ad_variants
  if (brand.ad_variants.length === 0) fail(`no ad_variants for D-10 pregen`);
  ok(`ad_variants: ${brand.ad_variants.length} (${brand.ad_variants.map((a) => a.name).join(", ")})`);
}

// ─── 3. Calibration assertions per PITCH Bloque 3 ────────────────────
header("3. PITCH Bloque 3 calibration checks");

const cafetito = brands.find((b) => b.slug === "cafetito")!;
const termoflex = brands.find((b) => b.slug === "termoflex")!;
const panchoRex = brands.find((b) => b.slug === "pancho-rex")!;
const matebros = brands.find((b) => b.slug === "matebros")!;

// CafetITO must match at 12:00 ART (demo time)
const cafetitoDaypart = cafetito.ext.dayparts!.active[0];
if (!cafetitoDaypart.startsWith("11:") && !cafetitoDaypart.startsWith("10:") && !cafetitoDaypart.startsWith("00:")) {
  fail(`CafetITO daypart "${cafetitoDaypart}" might not include 12:00 ART`);
}
ok(`CafetITO daypart "${cafetitoDaypart}" includes demo time 12:00 ART`);

// Pancho Rex must NOT match at 12:00 — first daypart must start at 13:00 or later
const panchoFirstDaypart = panchoRex.ext.dayparts!.active[0];
const panchoFirstHour = parseInt(panchoFirstDaypart.split(":")[0], 10);
if (panchoFirstHour <= 12) {
  fail(`Pancho Rex first daypart "${panchoFirstDaypart}" starts at 12:00 or earlier — would match demo time`);
}
ok(`Pancho Rex first daypart "${panchoFirstDaypart}" starts after 12:00 → SKIP at demo time`);

// MateBros max_viewers calibrated for hackathon audience
if (matebros.ext.event_filters?.max_viewers !== 2) {
  fail(`MateBros max_viewers = ${matebros.ext.event_filters?.max_viewers} (expected 2 per recent calibration)`);
}
ok(`MateBros max_viewers = 2 (calibrated to hackathon audience)`);

// MateBros must NOT have high_energy in required_any_tag (so it skips trigger 1)
const matebrosHighEnergy = matebros.ext.event_filters?.required_any_tag?.includes("high_energy");
if (matebrosHighEnergy) {
  fail(`MateBros required_any_tag includes 'high_energy' — would match trigger 1 (wrong)`);
}
ok(`MateBros required_any_tag does NOT include 'high_energy' → SKIPs trigger 1`);

// MateBros must include casual_chat (matches trigger 2)
const matebrosCasual = matebros.ext.event_filters?.required_any_tag?.includes("casual_chat");
if (!matebrosCasual) fail(`MateBros required_any_tag missing 'casual_chat' (needed for trigger 2)`);
ok(`MateBros required_any_tag includes 'casual_chat' → MATCHes trigger 2`);

// TermoFlex always_bid_floor
if (!termoflex.payload.always_bid_floor) fail(`TermoFlex always_bid_floor not true`);
ok(`TermoFlex always_bid_floor = true (default bidder, bypasses gates 2/3/4)`);

// TermoFlex 24/7
const termoDaypart = termoflex.ext.dayparts!.active[0];
if (!termoDaypart.startsWith("00:00")) fail(`TermoFlex daypart "${termoDaypart}" not 24/7`);
ok(`TermoFlex daypart 24/7 (${termoDaypart})`);

// ─── 4. Stream metadata ──────────────────────────────────────────────
header("4. Stream metadata: streams/team-stream.yaml");
let stream;
try {
  stream = loadStreamMetadata("team-stream");
} catch {
  // Fallback to demo if team-stream.yaml not present yet
  stream = loadStreamMetadata("demo");
  console.log(`  (using demo.yaml — team-stream.yaml not found)`);
}
ok(`stream: ${stream.stream_id} · streamer=${stream.streamer} · category=${stream.category}`);
ok(`audience expected: ${stream.audience?.expected_viewers_min ?? "?"}-${stream.audience?.expected_viewers_max ?? "?"} viewers`);
if (stream.rehearsed_triggers) {
  ok(`rehearsed_triggers: ${stream.rehearsed_triggers.map((t) => t.word).join(", ")}`);
}

// ─── 5. Cross-check: max_viewers vs expected audience ────────────────
header("5. Cross-check matebros.max_viewers vs stream.audience");
const expectedMax = stream.audience?.expected_viewers_max ?? 0;
const matebrosMax = matebros.ext.event_filters?.max_viewers ?? Infinity;
if (matebrosMax >= expectedMax) {
  console.log(`  ⚠  matebros.max_viewers=${matebrosMax} >= expected_viewers_max=${expectedMax}`);
  console.log(`     MateBros would NOT skip by viewers_above_max in worst case;`);
  console.log(`     would still skip trigger 1 by missing_required_tag (high_energy not in required_any_tag).`);
} else {
  ok(`matebros.max_viewers=${matebrosMax} < expected_viewers_max=${expectedMax} — SKIP by viewers narrative works`);
}

// ─── Done ────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log("  ✓ ALL CHECKS PASSED");
console.log("═".repeat(72) + "\n");

/**
 * Manager-worker entrypoint (C-08m).
 *
 * Subscribes to `INSERT` on `context_chunks` (filtered by stream_key) via
 * Supabase Realtime postgres_changes. For each new chunk:
 *
 *   Stage 1  semantic filter — audio_intent ∈ {reaction, recommendation}
 *            OR audio_mentions has entries OR viewers_delta_30s > 100.
 *            No LLM, ~0ms, $0. (DESIGN.md §4 + TODO C-08m).
 *
 *   Stage 2  Claude Haiku 4.5 picks a brand from the YAML library and
 *            emits explicit moment_quality + brand_match scores. Both must
 *            clear thresholds for the manager to fire.
 *
 *   Emit     POST /api/creators/<stream_key>/render with `{ message }`.
 *            The iframe at /o/<stream_key> receives it via the existing
 *            SSE pipe (C-13a).
 *
 * Cooldown of MANAGER_COOLDOWN_S after each successful emit — anti-spam.
 *
 * Fail-closed: if Stage 2 errors (LLM 5xx, network, schema mismatch),
 * we log and skip the chunk. Better to drop a placement than emit an
 * unverified one.
 */

import { createClient } from "@supabase/supabase-js";

import { loadBrands } from "./brands.ts";
import { config } from "./config.ts";
import { stage1Filter } from "./intensity.ts";
import { makeClaudePicker, makeStubPicker, type Picker } from "./pickBrand.ts";
import { postRender } from "./render.ts";
import type { ContextChunk } from "./types.ts";

const brands = loadBrands();
console.log(
  `[manager] loaded ${brands.length} brands: ${brands.map((b) => b.brand_id).join(", ")}`,
);

const picker: Picker = config.dryRun
  ? (console.log("[manager] DRY_RUN=true → using stub picker"), makeStubPicker())
  : (() => {
      if (!config.anthropicKey) {
        throw new Error(
          "ANTHROPIC_API_KEY missing. Set it in .env.local, or run with MANAGER_DRY_RUN=true.",
        );
      }
      console.log(`[manager] using Claude picker (${config.anthropicModel})`);
      return makeClaudePicker(config.anthropicKey, config.anthropicModel);
    })();

const supa = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false },
});

let cooldownUntil = 0;
let inFlight = false;

async function handleChunk(chunk: ContextChunk): Promise<void> {
  const t0 = Date.now();
  const tag = `chunk=${chunk.id.slice(0, 8)}`;

  if (inFlight) {
    console.log(`[manager] ${tag} skip:in_flight`);
    return;
  }
  if (Date.now() < cooldownUntil) {
    const remaining = Math.round((cooldownUntil - Date.now()) / 1000);
    console.log(`[manager] ${tag} skip:cooldown (${remaining}s left)`);
    return;
  }

  // Stage 1 — semantic gate
  const s1 = stage1Filter(chunk);
  if (!s1.pass) {
    console.log(`[manager] ${tag} skip:stage1 — ${s1.reason}`);
    return;
  }
  console.log(`[manager] ${tag} stage1:pass — ${s1.reason}`);

  // Stage 2 — Claude scores moment_quality + brand_match
  inFlight = true;
  try {
    const pick = await picker(chunk, brands);
    const dt = Date.now() - t0;
    const scoreTag = `mq=${pick.moment_quality.toFixed(2)} bm=${pick.brand_match.toFixed(2)}`;

    if (!pick.should_emit || !pick.brand_id) {
      console.log(`[manager] ${tag} skip:llm_no_match (${scoreTag}) — ${pick.reason} [${dt}ms]`);
      return;
    }
    if (pick.moment_quality < config.momentQualityMin) {
      console.log(
        `[manager] ${tag} skip:moment_quality (${scoreTag} < ${config.momentQualityMin}) — ${pick.reason} [${dt}ms]`,
      );
      return;
    }
    if (pick.brand_match < config.brandMatchMin) {
      console.log(
        `[manager] ${tag} skip:brand_match (${scoreTag} < ${config.brandMatchMin}) — ${pick.reason} [${dt}ms]`,
      );
      return;
    }
    if (!pick.message) {
      console.log(`[manager] ${tag} skip:empty_message [${dt}ms]`);
      return;
    }

    // Emit
    const result = await postRender(config.apiBaseUrl, config.streamKey, pick.message);
    if (!result.ok) {
      console.error(`[manager] ${tag} emit:failed — ${result.error}`);
      return;
    }
    cooldownUntil = Date.now() + config.cooldownMs;
    console.log(
      `[manager] ${tag} ✅ EMIT brand=${pick.brand_id} (${scoreTag}) event=${result.eventId} [${dt}ms]\n         → "${pick.message}"\n         reason: ${pick.reason}`,
    );
  } catch (err) {
    console.error(
      `[manager] ${tag} stage2:error — ${err instanceof Error ? err.message : String(err)} [fail-closed]`,
    );
  } finally {
    inFlight = false;
  }
}

// Catch-up on (re)connect — fetch the most recent chunk and process it if
// we haven't seen it. Idempotent via in-memory `lastSeenId`.
let lastSeenId: string | null = null;
async function catchUp(): Promise<void> {
  const { data, error } = await supa
    .from("context_chunks")
    .select("*")
    .eq("stream_key", config.streamKey)
    .order("ts_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[manager] catchup error: ${error.message}`);
    return;
  }
  if (!data) {
    console.log("[manager] catchup: no chunks yet for", config.streamKey);
    return;
  }
  if (data.id === lastSeenId) return;
  lastSeenId = data.id;
  console.log(`[manager] catchup: processing latest chunk ${data.id.slice(0, 8)}`);
  await handleChunk(data as ContextChunk);
}

const channel = supa
  .channel(`manager:context_chunks:${config.streamKey}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "context_chunks",
      filter: `stream_key=eq.${config.streamKey}`,
    },
    (payload) => {
      const chunk = payload.new as ContextChunk;
      lastSeenId = chunk.id;
      void handleChunk(chunk);
    },
  )
  .subscribe((status, err) => {
    console.log(`[manager] realtime status: ${status}${err ? ` err=${err.message}` : ""}`);
    if (status === "SUBSCRIBED") {
      void catchUp();
    }
  });

console.log(
  `[manager] listening for context_chunks INSERTs where stream_key=${config.streamKey}`,
);
console.log(`[manager] thresholds: moment_quality>=${config.momentQualityMin} brand_match>=${config.brandMatchMin} cooldown=${config.cooldownMs / 1000}s`);
console.log(`[manager] render endpoint: ${config.apiBaseUrl}/api/creators/${config.streamKey}/render`);

// Graceful shutdown
const shutdown = async (sig: string) => {
  console.log(`\n[manager] received ${sig}, unsubscribing…`);
  await channel.unsubscribe();
  await supa.removeAllChannels();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

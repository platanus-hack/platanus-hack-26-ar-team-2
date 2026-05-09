/**
 * Smoke test for the manager-worker.
 *
 * Inserts a synthetic high-energy chunk into `context_chunks` for the
 * configured stream_key. If the worker is running and Realtime is wired,
 * the worker should:
 *
 *   1. receive the INSERT via postgres_changes
 *   2. pass Stage 1 (audio_intent='reaction' + audio_mentions has entries)
 *   3. emit a render event (or DRY_RUN stub)
 *
 * After running this, query render_events to confirm a new row appeared:
 *
 *   select id, message, created_at from render_events
 *     where creator_id = $stream_key order by created_at desc limit 1;
 *
 * Usage:
 *   pnpm smoke
 *   # or with overrides:
 *   MANAGER_STREAM_KEY=other-stream pnpm smoke
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const streamKey = process.env.MANAGER_STREAM_KEY ?? "coscu-test";

if (!url || !key) {
  console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

const synthetic = {
  stream_key: streamKey,
  ts_start: new Date().toISOString(),
  duration_s: 30,
  audio_text:
    "Che mirá ese golazo eh, increíble lo de Messi hoy, esto es un clutch total. Mate y partidazo, lo que hace falta.",
  audio_summary: "El streamer reacciona eufórico a un gol de Messi y celebra el momento clutch.",
  audio_topics: ["fútbol", "argentina"],
  audio_mentions: ["Messi"],
  audio_intent: "reaction",
  scene_type: "FIFA gameplay",
  energy_level: "epic",
  mood_tags: ["high_energy", "celebration", "victory", "clutch"],
  on_screen_text: "GOAL!",
  chat_velocity_avg: 8.0,
  chat_velocity_peak: 24.0,
  chat_recent_keywords: ["GOLAZO", "vamos", "MESSI", "ARGENTINA"],
  sentiment_avg: "hype",
  viewers: 1843,
  viewers_delta_30s: 130,
  game_category: "FIFA 26",
  stream_title: "FIFA con los pibes — modo carrera Argentina",
  ticks_aggregated: 30,
  frame_analyses_aggregated: 15,
};

const { data, error } = await supa
  .from("context_chunks")
  .insert(synthetic)
  .select("id, ts_start")
  .single();

if (error) {
  console.error("smoke insert failed:", error.message);
  process.exit(1);
}
console.log(`✅ inserted synthetic chunk ${data.id} for stream_key="${streamKey}"`);
console.log("if the worker is running, you should see Stage1+Stage2 logs and a render POST.");
console.log(
  "verify with:\n  select id, message, created_at from render_events where creator_id = '" +
    streamKey +
    "' order by created_at desc limit 1;",
);

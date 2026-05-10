/**
 * POST /api/mock/chunk
 *
 * Inserts a mock row into `context_chunks` simulating what the pipeline
 * (OBS → nginx-rtmp → chunkWriter) would produce. For testing only.
 *
 * Body: { stream_key, audio_text, ...optional overrides }
 */

import { supabaseAdmin } from "@/lib/supabase";
import { requireInternalBearer } from "@/lib/route-security";

export async function POST(req: Request) {
  const authError = requireInternalBearer(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const streamKey = body.stream_key ?? "team-stream";
  const audioText = body.audio_text ?? "";

  const row = {
    stream_key: streamKey,
    stream_id: null,
    ts_start: new Date().toISOString(),
    duration_s: body.duration_s ?? 15,
    audio_text: audioText || null,
    audio_partial_at_end: null,
    audio_summary: body.audio_summary ?? audioText?.slice(0, 140) ?? null,
    audio_topics: body.audio_topics ?? [],
    audio_mentions: body.audio_mentions ?? [],
    audio_intent: body.audio_intent ?? "discussion",
    scene_type: body.scene_type ?? "talking_head",
    energy_level: body.energy_level ?? "medium",
    mood_tags: body.mood_tags ?? [],
    on_screen_text: body.on_screen_text ?? null,
    chat_velocity_avg: body.chat_velocity_avg ?? 0,
    chat_velocity_peak: body.chat_velocity_peak ?? 0,
    chat_recent_keywords: body.chat_recent_keywords ?? [],
    sentiment_avg: body.sentiment_avg ?? "neutral",
    viewers: body.viewers ?? 5,
    viewers_delta_30s: body.viewers_delta_30s ?? 0,
    game_category: body.game_category ?? null,
    stream_title: body.stream_title ?? "Addie Demo",
    ticks_aggregated: 1,
    frame_analyses_aggregated: 0,
  };

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("context_chunks")
    .insert(row)
    .select("id, ts_start")
    .single();

  if (error) {
    return Response.json({ error: "database error" }, { status: 500 });
  }

  return Response.json({ ok: true, chunk_id: data.id, ts_start: data.ts_start });
}

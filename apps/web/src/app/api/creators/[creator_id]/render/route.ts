/**
 * POST /api/creators/[creator_id]/render
 *
 * Extended shape (D-13): { message?, zone?, asset_url?, asset_type?, duration_ms?, qr_url? }
 * At least one of message or asset_url is required.
 * Full payload is embedded in the pg_notify so SSE clients receive it without a DB round-trip.
 *
 * See DESIGN.md §4 "Event broadcast pattern (C-13a)".
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";

const MAX_MESSAGE_LEN = 280;

type RenderPayload = {
  message?: string;
  zone?: "lower_third" | "corner" | "fullscreen";
  asset_url?: string;
  asset_type?: "video" | "image";
  duration_ms?: number;
  qr_url?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ creator_id: string }> },
) {
  const { creator_id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(creator_id)) {
    return NextResponse.json(
      { ok: false, error: "creator_id must be 1-80 chars [a-zA-Z0-9_-]" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "request body must be valid JSON" },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as RenderPayload;
  const hasMessage = typeof payload.message === "string" && payload.message.length > 0;
  const hasAsset = typeof payload.asset_url === "string" && payload.asset_url.length > 0;

  if (!hasMessage && !hasAsset) {
    return NextResponse.json(
      { ok: false, error: "one of message or asset_url is required" },
      { status: 400 },
    );
  }
  if (hasMessage && payload.message!.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      { ok: false, error: `"message" max ${MAX_MESSAGE_LEN} chars` },
      { status: 400 },
    );
  }

  const message = payload.message ?? "";

  const client = await pool().connect();
  try {
    const insert = await client.query<{ id: string; created_at: string }>(
      "insert into render_events (creator_id, message) values ($1, $2) returning id, created_at",
      [creator_id, message],
    );
    const event = insert.rows[0]!;

    const notifyJson = JSON.stringify({
      id: event.id,
      creator_id,
      created_at: event.created_at,
      message,
      zone: payload.zone,
      asset_url: payload.asset_url,
      asset_type: payload.asset_type,
      duration_ms: payload.duration_ms,
      qr_url: payload.qr_url,
    });

    // Format: '<creator_id>:<event_id>:<json>' — SSE splits on first two colons only.
    await client.query("select pg_notify('render_events', $1)", [
      `${creator_id}:${event.id}:${notifyJson}`,
    ]);

    return NextResponse.json({ ok: true, event: { id: event.id, creator_id, created_at: event.created_at } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export function GET(_req: Request, _ctx: { params: Promise<{ creator_id: string }> }) {
  return NextResponse.json({
    endpoint: "POST /api/creators/[creator_id]/render",
    body: {
      message: "string (optional if asset_url provided)",
      zone: "lower_third | corner | fullscreen (optional)",
      asset_url: "string (optional)",
      asset_type: "video | image (optional)",
      duration_ms: "number ms (optional)",
      qr_url: "string (optional)",
    },
  });
}

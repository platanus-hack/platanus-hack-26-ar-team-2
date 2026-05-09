/**
 * POST /api/creators/[creator_id]/render
 *
 *   curl -X POST https://addie.app/api/creators/coscu-test/render \
 *     -H "Content-Type: application/json" \
 *     -d '{"message":"Hola desde curl"}'
 *
 * Inserts a row into `render_events` for the target creator + issues
 * `NOTIFY render_events, '<creator_id>:<event_id>'` so any SSE handler
 * currently `LISTEN`-ing on that channel pushes immediately.
 *
 * MVP shape: only `message` text. Future iterations (when the auction
 * layer ships): asset_url, asset_type, duration_ms, zone, expires_at.
 *
 * See DESIGN.md §4 "Event broadcast pattern (C-13a)".
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs"; // pg requires Node, not Edge

const MAX_MESSAGE_LEN = 280;

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

  const { message } = (body as { message?: unknown }) ?? {};
  if (typeof message !== "string" || message.length === 0) {
    return NextResponse.json(
      { ok: false, error: '"message" required (non-empty string)' },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      { ok: false, error: `"message" max ${MAX_MESSAGE_LEN} chars` },
      { status: 400 },
    );
  }

  const client = await pool().connect();
  try {
    const insert = await client.query<{ id: string; created_at: string }>(
      "insert into render_events (creator_id, message) values ($1, $2) returning id, created_at",
      [creator_id, message],
    );
    const event = insert.rows[0]!;

    // NOTIFY payload format: '<creator_id>:<event_id>'. SSE handler parses
    // and filters by creator_id (one channel for all creators avoids the
    // per-creator-channel explosion at scale).
    await client.query("select pg_notify('render_events', $1)", [
      `${creator_id}:${event.id}`,
    ]);

    return NextResponse.json({
      ok: true,
      event: {
        id: event.id,
        creator_id,
        message,
        created_at: event.created_at,
      },
    });
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
      message: `string (required, 1-${MAX_MESSAGE_LEN} chars)`,
    },
    iframe_at: "/o/[creator_id]",
    sse_at: "/api/creators/[creator_id]/stream",
  });
}

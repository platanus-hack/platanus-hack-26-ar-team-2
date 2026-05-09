/**
 * GET /api/creators/[creator_id]/stream  (Server-Sent Events)
 *
 * Long-lived SSE stream the iframe at /o/[creator_id] subscribes to.
 *
 * Per request:
 *  1. Grab a dedicated pg client (NOT pooled — we hold it for the whole stream)
 *  2. SELECT undelivered events for this creator since `?since=<event_id>`
 *     (catch-up on iframe reconnect after Vercel timeout)
 *  3. `LISTEN render_events` — receive `pg_notify` payloads instantly
 *  4. Filter by creator_id (single channel for all creators)
 *  5. SELECT the row, push as `data: <json>\n\n` to the SSE stream
 *  6. Mark the row delivered_at = now()
 *  7. Heartbeat `: ping\n\n` every 25s — keeps Vercel proxy from idling out
 *  8. On client disconnect: clean up timers, UNLISTEN, release client
 *
 * Vercel Pro caps streaming functions at ~5min. EventSource auto-reconnects;
 * each reconnect catches up via `?since=<last_event_id>`.
 *
 * See DESIGN.md §4 "Event broadcast pattern (C-13a)".
 */

import { pool } from "@/lib/pg";
import type { RenderEventPayload } from "@/lib/types/render";

export const runtime = "nodejs"; // pg requires Node, not Edge
export const maxDuration = 300; // 5min — max for streaming on Vercel Pro
export const dynamic = "force-dynamic";

/**
 * Row shape del SELECT de catch-up. Incluye `payload jsonb` (migration
 * 0011) que contiene el body completo del POST /render — necesario para
 * que el iframe recupere placements visuales (asset_url, qr_url, zone_id,
 * position, etc) después de un reconnect, no solo el text del message.
 */
type RenderEventRow = {
  id: string;
  creator_id: string;
  message: string;
  created_at: string;
  kind?: "render" | "raw" | "brand";
  payload?: Omit<RenderEventPayload, "id" | "creator_id" | "created_at" | "kind" | "message"> | null;
};

/**
 * Mergea row + payload jsonb en el shape final que el iframe consume.
 * Retro-compat: si `payload` es null (rows pre-migration 0011) devolvemos
 * solo los campos top-level.
 */
function rowToEvent(row: RenderEventRow): RenderEventPayload {
  return {
    id: row.id,
    creator_id: row.creator_id,
    created_at: row.created_at,
    kind: row.kind,
    message: row.message || undefined,
    ...(row.payload ?? {}),
  };
}

const HEARTBEAT_MS = 25_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ creator_id: string }> },
) {
  const { creator_id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(creator_id)) {
    return new Response("invalid creator_id", { status: 400 });
  }

  const url = new URL(req.url);
  const since = url.searchParams.get("since"); // last event id seen by client

  const client = await pool().connect();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Helper: push one event to the stream + mark delivered.
      const pushEvent = async (event: RenderEventPayload) => {
        safeEnqueue(`id: ${event.id}\n` + `event: render\n` + `data: ${JSON.stringify(event)}\n\n`);
        await client.query("update render_events set delivered_at = now() where id = $1", [event.id]).catch(() => {});
      };

      // 1. Greet — confirms the connection is alive immediately.
      safeEnqueue(`event: hello\ndata: ${JSON.stringify({ creator_id, ts: Date.now() })}\n\n`);

      // 2. Catch-up: replay anything created after `since` (or undelivered).
      // Incluimos `payload` jsonb desde migration 0011 → reconnects recuperan
      // placements visuales completos (asset_url, qr_url, zone_id, etc),
      // no solo el text del message.
      try {
        const catchupQuery = since
          ? `select id, creator_id, message, created_at, kind, payload
               from render_events
              where creator_id = $1 and created_at > (select created_at from render_events where id = $2)
              order by created_at asc
              limit 50`
          : `select id, creator_id, message, created_at, kind, payload
               from render_events
              where creator_id = $1 and delivered_at is null
              order by created_at asc
              limit 50`;
        const catchupArgs = since ? [creator_id, since] : [creator_id];
        const recent = await client.query<RenderEventRow>(catchupQuery, catchupArgs);
        for (const row of recent.rows) {
          await pushEvent(rowToEvent(row));
        }
      } catch {
        // Don't block live stream on catch-up failure.
      }

      // 3. LISTEN for new events. Notification payload is '<creator_id>:<event_id>'.
      await client.query("LISTEN render_events");
      client.on("notification", async (n) => {
        if (closed || !n.payload) return;
        const colonIdx = n.payload.indexOf(":");
        const colonIdx2 = n.payload.indexOf(":", colonIdx + 1);
        const cid = n.payload.slice(0, colonIdx);
        if (cid !== creator_id) return;

        const jsonStr = colonIdx2 > -1 ? n.payload.slice(colonIdx2 + 1) : null;
        if (jsonStr) {
          try {
            const event = JSON.parse(jsonStr) as RenderEventPayload;
            await pushEvent(event);
            return;
          } catch {
            // fall through to DB fetch
          }
        }

        // Fallback: fetch from DB (catches old-format notifications)
        const eventId = n.payload.slice(colonIdx + 1, colonIdx2 > -1 ? colonIdx2 : undefined);
        try {
          const r = await client.query<RenderEventRow>(
            "select id, creator_id, message, created_at, kind, payload from render_events where id = $1",
            [eventId],
          );
          if (r.rows[0]) await pushEvent(rowToEvent(r.rows[0]));
        } catch {
          // ignore
        }
      });

      // 4. Heartbeat keeps the connection alive through proxies.
      const heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      // 5. Cleanup on client disconnect (browser closes tab, network drops).
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          await client.query("UNLISTEN render_events");
        } catch {
          // ignore
        }
        client.release();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Vercel/proxy buffering — must flush each chunk.
      "X-Accel-Buffering": "no",
    },
  });
}

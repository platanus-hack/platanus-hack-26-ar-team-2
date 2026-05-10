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

import type { PoolClient } from "pg";
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let client: PoolClient | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Cleanup centralizado e idempotente. Se invoca desde:
      //   - abort del client (cerró el tab, network drop, Vercel mata fn)
      //   - error en el connect inicial (pool saturado)
      //   - error en LISTEN (DB desconectó)
      // Garantiza release del pg client en TODOS los paths para que el pool
      // (max=20) no se llene de orphans en deploys con muchos overlays
      // abiertos al mismo tiempo.
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (client) {
          try {
            await client.query("UNLISTEN render_events");
          } catch {
            // ignore
          }
          try {
            client.release();
          } catch {
            // ignore
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // 1. Saludo INMEDIATO. Antes de tocar el pool. El iframe ve los headers
      // + el primer byte al toque y EventSource pasa a `readyState=OPEN` aunque
      // el pg client todavía no esté listo. Sin esto, si `pool().connect()`
      // tardaba >30s (pool saturado, cold start, supabase-pooler con cola)
      // el browser veía la request colgada y la mataba con timeout.
      safeEnqueue(`event: hello\ndata: ${JSON.stringify({ creator_id, ts: Date.now() })}\n\n`);

      // 2. Heartbeat arranca YA — keepalive del proxy/Vercel mientras esperamos
      // al pool. Cada 25s tira `: heartbeat <ts>\n\n` (comentario SSE, ignorado
      // por el client pero suficiente para que el proxy no haga idle-disconnect).
      heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      // 3. Abort listener ANTES de cualquier await del connect. Si el user
      // cierra el tab mientras el pool está esperando, no nos quedamos colgados.
      req.signal.addEventListener("abort", () => {
        void cleanup();
      });

      // 4. Recién ahora pedimos un client al pool. Con connectionTimeoutMillis=5s
      // (lib/pg.ts), si no hay slot libre tira error en 5s en vez de quedar
      // pending hasta que el proxy mate la response.
      try {
        client = await pool().connect();
      } catch (e) {
        const message = e instanceof Error ? e.message : "pool connect failed";
        safeEnqueue(
          `event: error\ndata: ${JSON.stringify({ code: "pool_connect_failed", message })}\n\n`,
        );
        await cleanup();
        return;
      }

      // Helper: push one event to the stream + mark delivered.
      const pushEvent = async (event: RenderEventPayload) => {
        if (!client || closed) return;
        safeEnqueue(`id: ${event.id}\n` + `event: render\n` + `data: ${JSON.stringify(event)}\n\n`);
        await client
          .query("update render_events set delivered_at = now() where id = $1", [event.id])
          .catch(() => {});
      };

      // 5. Catch-up: replay anything created after `since` (or undelivered).
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

      // 6. LISTEN for new events. Notification payload es '<creator_id>:<event_id>:<json>'.
      // Si LISTEN falla (DB caída, pooler en transaction-mode), mandamos error
      // event y cleanup → el iframe reconecta en 2s (OverlayClient) en vez de
      // quedar suscripto a un canal que nunca va a emitir.
      try {
        await client.query("LISTEN render_events");
      } catch (e) {
        const message = e instanceof Error ? e.message : "LISTEN failed";
        safeEnqueue(
          `event: error\ndata: ${JSON.stringify({ code: "listen_failed", message })}\n\n`,
        );
        await cleanup();
        return;
      }

      client.on("notification", async (n) => {
        if (closed || !n.payload || !client) return;
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

        // Fallback: fetch from DB (catches old-format notifications).
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

      // pg client emite 'error' si la conn al server muere mid-LISTEN (típico
      // con poolers en sleep o resume de Supabase). Sin handler explícito el
      // event se propaga como uncaught → la function muere sin cleanup. Acá
      // disparamos cleanup ordenado y el iframe reconecta solo.
      client.on("error", async (err) => {
        const message = err instanceof Error ? err.message : "pg client error";
        safeEnqueue(
          `event: error\ndata: ${JSON.stringify({ code: "pg_error", message })}\n\n`,
        );
        await cleanup();
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

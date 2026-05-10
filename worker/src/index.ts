/**
 * Addie Worker — Fly.io long-lived Node server.
 *
 * Replaces Vercel's cron-based manager with a persistent process:
 *  - PG LISTEN context_chunks_new → instant reaction to pipeline INSERTs
 *  - PG LISTEN render_events → SSE broadcast to connected overlay clients
 *  - HTTP endpoints for health, SSE, and manual triggers
 *
 * Env vars:
 *  - DATABASE_URL          — Supabase direct connection (port 5432, NOT pooler)
 *  - ANTHROPIC_API_KEY     — Claude API key
 *  - ANTHROPIC_MODEL       — default: claude-haiku-4-5
 *  - MANAGER_DRY_RUN       — "true" to use stub picker (no API key needed)
 *  - BRANDS_DIR            — path to brand YAMLs (default: ./brands)
 *  - PORT                  — HTTP port (default: 3001)
 */

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { loadBrands } from "./loader.js";
import { managerTick, configFromEnv } from "./tick.js";
import { startSettlementLoop } from "./settlement.js";

const PORT = Number(process.env.PORT ?? 3001);
const WORKER_ALLOWED_ORIGIN = process.env.WORKER_ALLOWED_ORIGIN;
const WORKER_TRIGGER_SECRET = process.env.WORKER_TRIGGER_SECRET ?? process.env.MANAGER_WEBHOOK_SECRET;
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error("[worker] DATABASE_URL is required");
  process.exit(1);
}
// Strip sslmode param — we handle SSL via the ssl config object
const dbUrl = new URL(rawDbUrl);
dbUrl.searchParams.delete("sslmode");
dbUrl.searchParams.delete("supa");
const DATABASE_URL = dbUrl.toString();

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRANDS_DIR = process.env.BRANDS_DIR ?? join(__dirname, "..", "brands");

// ─── SSE client registry ────────────────────────────────────────────

type SSEClient = {
  res: http.ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
};
const sseClients = new Map<string, Set<SSEClient>>();

function broadcastSSE(creatorId: string, eventName: string, data: string) {
  const clients = sseClients.get(creatorId);
  if (!clients || clients.size === 0) return;
  const msg = `event: ${eventName}\ndata: ${data}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(msg);
    } catch {
      clients.delete(c);
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireTriggerAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!WORKER_TRIGGER_SECRET) {
    if (process.env.NODE_ENV === "production") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "WORKER_TRIGGER_SECRET must be configured" }));
      return false;
    }
    return true;
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !constantTimeEqual(token, WORKER_TRIGGER_SECRET)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return false;
  }
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  // 1. Load brands from YAML
  const brands = loadBrands(BRANDS_DIR);

  // 2. PG pool for tick queries
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // 3. Dedicated PG client for LISTEN context_chunks_new
  const sslConfig = { rejectUnauthorized: false };

  const chunkListener = new Client({
    connectionString: DATABASE_URL,
    ssl: sslConfig,
  });
  await chunkListener.connect();
  await chunkListener.query("LISTEN context_chunks_new");
  console.log("[worker] LISTEN context_chunks_new — ready");

  // Track in-flight ticks to avoid double-processing
  const processing = new Set<string>();

  chunkListener.on("notification", (n) => {
    if (n.channel !== "context_chunks_new" || !n.payload) return;

    const colonIdx = n.payload.indexOf(":");
    const streamKey = n.payload.slice(0, colonIdx);
    const chunkId = n.payload.slice(colonIdx + 1);

    // Skip if already processing this stream (previous tick still running)
    if (processing.has(streamKey)) {
      console.log(JSON.stringify({
        tag: "worker:skip_inflight",
        stream_key: streamKey,
        chunk_id: chunkId,
      }));
      return;
    }

    processing.add(streamKey);
    const t0 = Date.now();

    const config = configFromEnv(streamKey);
    managerTick(config, pool, brands)
      .then((result) => {
        console.log(JSON.stringify({
          tag: "worker:tick_complete",
          stream_key: streamKey,
          chunk_id: chunkId,
          decision: result.decision,
          brand_id: result.brand_id ?? null,
          latency_ms: Date.now() - t0,
        }));
      })
      .catch((err) => {
        console.error(JSON.stringify({
          tag: "worker:tick_error",
          stream_key: streamKey,
          chunk_id: chunkId,
          error: err instanceof Error ? err.message : String(err),
          latency_ms: Date.now() - t0,
        }));
      })
      .finally(() => {
        processing.delete(streamKey);
      });
  });

  // 4. Dedicated PG client for LISTEN render_events (SSE broadcast)
  const renderListener = new Client({
    connectionString: DATABASE_URL,
    ssl: sslConfig,
  });
  await renderListener.connect();
  await renderListener.query("LISTEN render_events");
  console.log("[worker] LISTEN render_events — SSE broadcast ready");

  renderListener.on("notification", (n) => {
    if (n.channel !== "render_events" || !n.payload) return;

    // payload format: <creator_id>:<event_id>:<json>
    const firstColon = n.payload.indexOf(":");
    const secondColon = n.payload.indexOf(":", firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return;

    const creatorId = n.payload.slice(0, firstColon);
    const json = n.payload.slice(secondColon + 1);
    broadcastSSE(creatorId, "render", json);
  });

  // 4b. Settlement loop — pollea kind='brand' status='accepted' con
  //     payment_status='pending_settlement' y firma el transfer USDC.
  const stopSettlement = startSettlementLoop(pool);

  // 5. HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);

    // CORS headers for browser-accessed read endpoints. Set WORKER_ALLOWED_ORIGIN
    // in production to avoid reflecting the worker to arbitrary web origins.
    const origin = req.headers.origin;
    if (WORKER_ALLOWED_ORIGIN && origin === WORKER_ALLOWED_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", WORKER_ALLOWED_ORIGIN);
    } else if (!WORKER_ALLOWED_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /health
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        brands: brands.length,
        sse_clients: [...sseClients.entries()].map(([k, v]) => ({ creator_id: k, count: v.size })),
        processing: [...processing],
        ts: Date.now(),
      }));
      return;
    }

    // GET /events/:creator_id — SSE stream
    const eventsMatch = url.pathname.match(/^\/events\/(.+)$/);
    if (eventsMatch && req.method === "GET") {
      const creatorId = decodeURIComponent(eventsMatch[1]);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(
        `event: hello\ndata: ${JSON.stringify({ creator_id: creatorId, ts: Date.now() })}\n\n`,
      );

      if (!sseClients.has(creatorId)) sseClients.set(creatorId, new Set());
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          /* ignore */
        }
      }, 25_000);
      const client: SSEClient = { res, heartbeat };
      sseClients.get(creatorId)!.add(client);

      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.get(creatorId)?.delete(client);
      });
      return;
    }

    // POST /trigger/:stream_key — manual tick trigger
    const triggerMatch = url.pathname.match(/^\/trigger\/(.+)$/);
    if (triggerMatch && req.method === "POST") {
      if (!requireTriggerAuth(req, res)) return;

      const streamKey = decodeURIComponent(triggerMatch[1]);
      const t0 = Date.now();
      try {
        const config = configFromEnv(streamKey);
        const result = await managerTick(config, pool, brands);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...result, latency_ms: Date.now() - t0 }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            latency_ms: Date.now() - t0,
          }),
        );
      }
      return;
    }

    // GET /brands — list loaded brands
    if (url.pathname === "/brands") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(brands.map((b) => ({
        slug: b.slug,
        display_name: b.display_name,
        description: b.description.slice(0, 100),
        match_keywords: b.match_keywords,
        has_asset: !!b.ad.asset_url,
      }))));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", endpoints: ["/health", "/events/:creator_id", "/trigger/:stream_key", "/brands"] }));
  });

  server.listen(PORT, () => {
    console.log(`[worker] HTTP server on :${PORT}`);
    console.log(`[worker] endpoints:`);
    console.log(`  GET  /health              — status`);
    console.log(`  GET  /events/:creator_id  — SSE stream`);
    console.log(`  POST /trigger/:stream_key — manual tick`);
    console.log(`  GET  /brands              — loaded brands`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[worker] shutting down...");
    stopSettlement();
    server.close();
    await chunkListener.end().catch(() => {});
    await renderListener.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});

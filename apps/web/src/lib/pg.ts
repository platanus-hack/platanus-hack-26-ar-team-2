/**
 * Raw `pg` connection pools — for things PostgREST/supabase-js can't do:
 *   - LISTEN / NOTIFY (used by /api/creators/[id]/stream SSE handler)
 *   - bulk operations needing a single transaction
 *   - migrations (apps/web/scripts/db-migrate.mjs uses pg directly)
 *
 * Two pools:
 *   pool()         — session-mode (port 5432). Supports LISTEN/NOTIFY.
 *                    Use for SSE streams and long-lived connections.
 *   transactPool() — transaction-mode (port 6543). Higher connection limit.
 *                    Use for short-lived queries (manager tick, API routes).
 *
 * Most app queries should go through `lib/db.ts` (Supabase JS client) for
 * RLS + safer ergonomics. Only reach for these pools when you need
 * native pg features.
 */

import { Pool } from "pg";

function cleanUrl(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");
  return u.toString();
}

/** Session-mode pooler (port 5432) — supports LISTEN/NOTIFY. Limited slots. */
function buildSessionConnStr(): string {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING missing. Run `vercel env pull apps/web/.env.local`.",
    );
  }
  return cleanUrl(raw);
}

/** Transaction-mode pooler (port 6543) — no LISTEN, but way more slots. */
function buildTransactConnStr(): string {
  const raw = process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!raw) {
    throw new Error(
      "POSTGRES_URL missing. Run `vercel env pull apps/web/.env.local`.",
    );
  }
  return cleanUrl(raw);
}

let _pool: Pool | null = null;
let _transactPool: Pool | null = null;

/**
 * Session-mode pool (port 5432). Use ONLY for LISTEN/NOTIFY and long-lived
 * connections (SSE streams). Limited connection slots on Supabase.
 */
export function pool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: buildSessionConnStr(),
    ssl: { rejectUnauthorized: false },
    max: 3, // tight — session-mode slots are scarce on Supabase
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return _pool;
}

/**
 * Transaction-mode pool (port 6543). Use for short-lived queries — manager
 * ticks, API routes, anything that doesn't need LISTEN/NOTIFY. Much higher
 * connection limit on Supabase's PgBouncer.
 */
export function transactPool(): Pool {
  if (_transactPool) return _transactPool;
  _transactPool = new Pool({
    connectionString: buildTransactConnStr(),
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return _transactPool;
}

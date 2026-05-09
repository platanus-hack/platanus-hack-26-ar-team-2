/**
 * Raw `pg` connection pool — for things PostgREST/supabase-js can't do:
 *   - LISTEN / NOTIFY (used by /api/creators/[id]/stream SSE handler)
 *   - bulk operations needing a single transaction
 *   - migrations (apps/web/scripts/db-migrate.mjs uses pg directly)
 *
 * Most app queries should go through `lib/db.ts` (Supabase JS client) for
 * RLS + safer ergonomics. Only reach for `pool()` here when you need
 * native pg features.
 */

import { Pool } from "pg";

function buildConnectionString(): string {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING missing. Run `vercel env pull apps/web/.env.local`.",
    );
  }
  // Supabase cert chain trips pg's strict default — strip sslmode + pass
  // rejectUnauthorized:false explicitly below.
  const u = new URL(raw);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");
  return u.toString();
}

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: buildConnectionString(),
    ssl: { rejectUnauthorized: false },
    // Conservative — each Vercel function instance has its own pool.
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

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
    // Cada SSE retiene un client por hasta `maxDuration` (5min) → con max=5 y
    // 5 iframes abiertos + el cron del manager-tick, el pool se satura y la
    // 6ta request queda esperando hasta que algún client se libere. Subido a
    // 20 para aguantar varios overlays + cron + bursts del render endpoint.
    max: 20,
    idleTimeoutMillis: 30_000,
    // Si pool().connect() cuelga >5s (pool saturado, network blip, Supabase
    // pooler con cola), preferimos que tire error y la SSE devuelva un evento
    // `error` al iframe en vez de quedarse colgada hasta el timeout del proxy.
    connectionTimeoutMillis: 5_000,
  });
  return _pool;
}

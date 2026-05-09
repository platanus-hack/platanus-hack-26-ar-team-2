/**
 * Addie Supabase client.
 *
 * Provisioning: Vercel Storage Marketplace → Supabase integration on the
 * `arvenz0210s-projects/web` project. Migrations live in
 * `supabase/migrations/` and are applied via
 * `node --env-file=apps/web/.env.local apps/web/scripts/db-migrate.mjs`.
 *
 * Two clients exported:
 *   - `supabase`        — anon-key client. Safe in browser / RSC / client
 *                         components / public API routes. Subject to RLS.
 *   - `supabaseAdmin()` — service-role client. Bypasses RLS. SERVER ONLY.
 *
 * Why the URL and anon key are hardcoded here:
 * They are designed to be public (NEXT_PUBLIC_*). Hardcoding gives the team
 * one-line consume (`import { supabase } from "@/lib/supabase"`) without
 * env-handoff friction. The actual security boundary is RLS policies on
 * the DB, not key secrecy.
 *
 * What is NOT hardcoded (and never should be):
 *   - SUPABASE_SERVICE_ROLE_KEY  — bypasses RLS; would let any GitHub-bot
 *                                  scraping the repo wipe the DB.
 *   - SUPABASE_JWT_SECRET        — would let anyone forge auth tokens.
 *   - POSTGRES_PASSWORD          — direct DB takeover.
 *   - SUPABASE_SECRET_KEY        — admin API takeover.
 *
 * These live in apps/web/.env.local (gitignored) for local dev, and are
 * already populated in the Vercel project env for deploys.
 * Refresh local with: `vercel env pull apps/web/.env.local` (from apps/web).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yktmoorpmlvnzfthmrlq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrdG1vb3JwbWx2bnpmdGhtcmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMTIyNTIsImV4cCI6MjA5Mzg4ODI1Mn0.i9z1RGoOoeBZCVAiO2YpveUdl33e95XPCf0xX_WhjXE";

/**
 * Anon client. Subject to RLS policies on the DB.
 * Use from React components, RSC, or public API routes.
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Service-role client. Bypasses RLS. **Server-only — never import from
 * a Client Component or any code that ships to the browser.**
 *
 * Read service-role key from process.env at call time so the bundle
 * doesn't capture it (Next.js will warn if it leaks into client bundle).
 */
export function supabaseAdmin(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing. " +
        "Run `vercel env pull apps/web/.env.local` from apps/web/ to populate.",
    );
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const SUPABASE_PUBLIC = {
  url: SUPABASE_URL,
  anon_key: SUPABASE_ANON_KEY,
} as const;

// Apply all SQL files from supabase/migrations/ in lexical order to the
// connection in POSTGRES_URL_NON_POOLING.
//
// Run from repo root or apps/web — both work.
//
//   node --env-file=apps/web/.env.local apps/web/scripts/db-migrate.mjs
//
// Idempotency: each migration file should use `create extension if not exists`,
// `create table` (will throw on existing — that's fine, you'll see clearly that
// it's already applied). For repeated dev runs, drop the schema first via
// the Supabase SQL editor (or extend this script with a `--reset` flag).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const migrationDir = join(repoRoot, "supabase", "migrations");

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING (or POSTGRES_URL) missing.");
  console.error("Run with: node --env-file=apps/web/.env.local apps/web/scripts/db-migrate.mjs");
  process.exit(1);
}

// Supabase serves a valid cert from a chain that pg's strict default
// (sslmode=require → verify-full) can't validate without the Supabase root.
// We strip the sslmode= param from the URL so pg honors our explicit
// ssl option below. Connection stays TLS-encrypted, just without strict
// chain verification — fine for a managed Supabase host we own.
const u = new URL(url);
u.searchParams.delete("sslmode");
u.searchParams.delete("supa");

const client = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.log(`(no .sql files in ${migrationDir})`);
  await client.end();
  process.exit(0);
}

console.log(`applying ${files.length} migration${files.length === 1 ? "" : "s"} → ${url.split("@")[1]?.split("/")[0] ?? "?"}`);
for (const f of files) {
  const sql = readFileSync(join(migrationDir, f), "utf-8");
  process.stdout.write(`  ${f} … `);
  try {
    await client.query(sql);
    console.log("✓");
  } catch (err) {
    console.log("✗");
    console.error(`  ${err.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log("done.");

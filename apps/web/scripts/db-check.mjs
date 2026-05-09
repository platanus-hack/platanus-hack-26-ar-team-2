// Quick sanity check: list tables created by migrations.
// Run: node --env-file=apps/web/.env.local apps/web/scripts/db-check.mjs

import pg from "pg";

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
const u = new URL(url);
u.searchParams.delete("sslmode");
u.searchParams.delete("supa");

const client = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  select table_name, (
    select count(*)::int from information_schema.columns
    where table_schema='public' and table_name = t.table_name
  ) as columns
  from information_schema.tables t
  where table_schema='public'
  order by table_name
`);

if (rows.length === 0) {
  console.log("(no tables in public schema)");
} else {
  console.log(`tables in public schema:`);
  for (const r of rows) {
    console.log(`  - ${r.table_name} (${r.columns} cols)`);
  }
}
await client.end();

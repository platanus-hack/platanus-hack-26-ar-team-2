// apps/web/scripts/seed-mandates.ts — C-06.
//
// Lee los YAMLs de `apps/web/src/lib/agents/brands/*.yaml` vía el loader,
// resuelve cada slug → `accounts.id` (UUID) y persiste un único mandate
// activo por brand en la tabla `mandates`:
//
//   - mandates.payload  jsonb ← BrandMandate     (legal/financial)
//   - mandates.prompt   jsonb ← BrandPrompt      (AI prompting)
//   - mandates.signature      ← "mvp:dummy:<account_id>"  (post-MVP §14: EIP-712)
//
// Idempotente:
//   - Si ya hay un mandate activo (revoked_at IS NULL) para el account_id,
//     hacemos UPDATE de payload+prompt+signed_at en lugar de insertar.
//   - Re-run no duplica filas (lo asegura el partial unique index
//     `mandates_one_active_per_account_idx` definido en 0001_init.sql).
//
// Convive con seed-wallets.ts (mismo patrón pg directo +
// POSTGRES_URL_NON_POOLING). Asume que seed-wallets corrió primero —
// si una brand no tiene fila en `accounts` con su `metadata.slug`,
// se loggea warning y se salta (no es fatal).
//
// Run desde apps/web:
//   pnpm seed:mandates
//
// O manual:
//   cd apps/web && node --env-file=.env.local --import tsx scripts/seed-mandates.ts
//
// Env vars requeridas:
//   - POSTGRES_URL_NON_POOLING (o POSTGRES_URL)
//     refresh: cd apps/web && vercel env pull .env.local

import pg from "pg";

import { loadBrandMandates } from "../src/lib/agents/brands/loader.ts";
import type { BrandMandate, BrandPrompt } from "../src/lib/agents/types.ts";

interface AccountRow {
  id: string;
  display_name: string;
}

interface ActiveMandateRow {
  id: string;
}

async function main(): Promise<void> {
  const PG_URL =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!PG_URL) {
    console.error(
      "✗ env var faltante: POSTGRES_URL_NON_POOLING (o POSTGRES_URL)",
    );
    console.error("  refresh: cd apps/web && vercel env pull .env.local");
    process.exit(1);
  }

  // Mismo workaround SSL que db-migrate.mjs / seed-wallets.ts:
  // pg strict no valida la cadena de Supabase, conexión sigue TLS-encrypted.
  const u = new URL(PG_URL);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");

  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const brands = loadBrandMandates();
  console.log(`→ seedeando ${brands.length} brand mandate(s)\n`);

  let inserted = 0;
  let updated = 0;
  let missing = 0;

  try {
    for (const brand of brands) {
      process.stdout.write(
        `  ${brand.payload.display_name.padEnd(16)} (${brand.slug.padEnd(11)}) … `,
      );

      // Resolver slug → account UUID. seed-wallets.ts inserta `metadata.slug`.
      const acc = await client.query<AccountRow>(
        `select id, display_name
           from accounts
          where type = 'brand'
            and metadata->>'slug' = $1
          limit 1`,
        [brand.slug],
      );
      const account = acc.rows[0];

      if (!account) {
        console.log(
          `skip (sin account row · corré seed-wallets.ts primero)`,
        );
        missing++;
        continue;
      }

      const payload: BrandMandate = {
        ...brand.payload,
        account_id: account.id, // loader lo dejó como slug; resolvemos al UUID real
      };
      const prompt: BrandPrompt | null = brand.prompt;
      const signature = `mvp:dummy:${account.id}`;

      // ¿Hay mandate activo? (revoked_at is null)
      const existing = await client.query<ActiveMandateRow>(
        `select id
           from mandates
          where account_id = $1
            and revoked_at is null
          limit 1`,
        [account.id],
      );

      if (existing.rows[0]) {
        await client.query(
          `update mandates
              set payload = $1::jsonb,
                  prompt  = $2::jsonb,
                  signature = $3,
                  signed_at = now()
            where id = $4`,
          [
            JSON.stringify(payload),
            prompt ? JSON.stringify(prompt) : null,
            signature,
            existing.rows[0].id,
          ],
        );
        console.log(`✓ updated (mandate ${existing.rows[0].id})`);
        updated++;
      } else {
        await client.query(
          `insert into mandates (account_id, type, payload, prompt, signature)
           values ($1, 'brand', $2::jsonb, $3::jsonb, $4)`,
          [
            account.id,
            JSON.stringify(payload),
            prompt ? JSON.stringify(prompt) : null,
            signature,
          ],
        );
        console.log(`✓ inserted`);
        inserted++;
      }
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n✓ done. inserted=${inserted} updated=${updated} missing_account=${missing} total=${brands.length}`,
  );

  if (missing > 0) {
    console.log(
      `\n⚠  ${missing} brand(s) sin account row — corré \`pnpm seed:wallets\` primero.`,
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("\n✗ fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

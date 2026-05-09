// apps/web/scripts/seed-wallets.ts — A-05.
//
// Genera 5 Privy server-side EVM smart wallets y persiste sus addresses en
// `accounts` (Supabase). Idempotente: upsert por display_name — re-run no
// duplica filas ni recrea wallets ya seedeadas.
//
// Wallets:
//   - 4 brands fictional (type='brand'):
//       cafetito (CafetITO), termoflex (TermoFlex),
//       pancho-rex (Pancho Rex), matebros (MateBros)
//   - 1 streamer-team (type='creator')
//
// La platform owner (0x7e66…7914) NO se crea acá: ya existe inmutable como
// `owner` de AddieEscrow (deployed en A-03). Ver TODO.md A-05.
//
// Convive con apps/web/scripts/db-migrate.mjs (mismo patrón: pg directo
// + POSTGRES_URL_NON_POOLING). Es .ts porque el TODO lo pide así.
//
// Run desde apps/web (donde están .env.local + node_modules):
//   pnpm seed:wallets
//
// O manual:
//   cd apps/web && node --env-file=.env.local --import tsx scripts/seed-wallets.ts
//
// Env vars requeridas:
//   - PRIVY_APP_ID, PRIVY_APP_SECRET   (smoke-tested en P0-11)
//   - POSTGRES_URL_NON_POOLING (o POSTGRES_URL)
//                                      (refresh: cd apps/web && vercel env pull .env.local)

import pg from "pg";

type WalletKind = "brand" | "creator";

interface WalletSpec {
  slug: string;
  display_name: string;
  type: WalletKind;
}

const WALLETS: readonly WalletSpec[] = [
  { slug: "cafetito", display_name: "CafetITO", type: "brand" },
  { slug: "termoflex", display_name: "TermoFlex", type: "brand" },
  { slug: "pancho-rex", display_name: "Pancho Rex", type: "brand" },
  { slug: "matebros", display_name: "MateBros", type: "brand" },
  { slug: "streamer-team", display_name: "Streamer Team", type: "creator" },
] as const;

interface PrivyWalletResponse {
  id: string;
  address: string;
  chain_type: string;
}

function requireEnv(key: string, hint?: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`✗ env var faltante: ${key}`);
    if (hint) console.error(`  ${hint}`);
    process.exit(1);
  }
  return v;
}

async function createPrivyWallet(
  slug: string,
  appId: string,
  appSecret: string,
): Promise<PrivyWalletResponse> {
  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const res = await fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers: {
      "privy-app-id": appId,
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chain_type: "ethereum",
      display_name: `addie:${slug}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Privy POST /v1/wallets falló (${res.status} ${res.statusText}): ${body}`,
    );
  }

  const data = (await res.json()) as Partial<PrivyWalletResponse>;
  if (!data.id || !data.address) {
    throw new Error(`Privy response sin id/address: ${JSON.stringify(data)}`);
  }
  return data as PrivyWalletResponse;
}

async function main(): Promise<void> {
  const PRIVY_APP_ID = requireEnv("PRIVY_APP_ID");
  const PRIVY_APP_SECRET = requireEnv("PRIVY_APP_SECRET");
  const PG_URL =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!PG_URL) {
    console.error("✗ env var faltante: POSTGRES_URL_NON_POOLING (o POSTGRES_URL)");
    console.error("  refresh: cd apps/web && vercel env pull .env.local");
    process.exit(1);
  }

  // Mismo workaround que apps/web/scripts/db-migrate.mjs:
  // pg en strict mode no valida la cadena de cert que sirve Supabase.
  // Conexión sigue TLS-encrypted, sin verify-full.
  const u = new URL(PG_URL);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");

  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`→ seedeando ${WALLETS.length} wallets (Privy + Supabase)\n`);

  let created = 0;
  let skipped = 0;
  let updated = 0;

  try {
    for (const spec of WALLETS) {
      process.stdout.write(`  ${spec.display_name.padEnd(16)} ${spec.type.padEnd(8)} … `);

      const sel = await client.query<{
        id: string;
        wallet_address: string | null;
      }>(
        "select id, wallet_address from accounts where display_name = $1 limit 1",
        [spec.display_name],
      );
      const existing = sel.rows[0];

      if (existing?.wallet_address) {
        console.log(`skip (ya tiene ${existing.wallet_address})`);
        skipped++;
        continue;
      }

      const wallet = await createPrivyWallet(spec.slug, PRIVY_APP_ID, PRIVY_APP_SECRET);

      const metadata = {
        slug: spec.slug,
        privy_wallet_id: wallet.id,
        chain_type: wallet.chain_type,
      };

      if (existing) {
        await client.query(
          "update accounts set wallet_address = $1, metadata = metadata || $2::jsonb where id = $3",
          [wallet.address, JSON.stringify(metadata), existing.id],
        );
        console.log(`✓ ${wallet.address} (updated)`);
        updated++;
      } else {
        await client.query(
          "insert into accounts (type, display_name, wallet_address, metadata) values ($1, $2, $3, $4::jsonb)",
          [spec.type, spec.display_name, wallet.address, JSON.stringify(metadata)],
        );
        console.log(`✓ ${wallet.address} (inserted)`);
        created++;
      }
      console.log(`    basescan: https://basescan.org/address/${wallet.address}`);
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n✓ done. inserted=${created} updated=${updated} skipped=${skipped} total=${WALLETS.length}`,
  );
}

main().catch((err) => {
  console.error("\n✗ fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

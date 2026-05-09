// apps/web/scripts/seed-inventory.ts — C-07.
//
// Seedea el inventario del creator demo (streamer-team) en la tabla
// `inventory`. 3 zonas (DESIGN.md §4):
//
//   - lower_third         · floor $0.50 · max 8s          · auctioned
//   - bottom_right_corner · floor $0.10 · max 60s         · auctioned (default bidder elegible)
//   - fullscreen_takeover · floor $3.00 · max 30s · manual_only (FULL BREAK hotkey)
//
// Floors calibrados contra los mandates seedeados (C-02e + C-06):
//   - TermoFlex (default bidder) min_bid $0.20 ≥ corner floor $0.10 ✓
//   - CafetITO  min_bid $0.50 ≥ lower_third floor $0.50 ✓
//   - Premium fullscreen $3.00 dentro del cap $5.00 de CafetITO ✓
//
// Idempotente: UPSERT por (creator_id, zone) — re-run no duplica ni rompe
// edits posteriores (refresca enabled/floor/max_duration al seed default).
// Si querés tunear floors a mano vía D-04 (Inventory editor), correr este
// script otra vez los pisa de vuelta — usalo solo para reset al baseline.
//
// Asume que seed-wallets.ts ya corrió (necesita la fila `accounts` del
// streamer-team con `metadata.slug = 'streamer-team'`).
//
// Run desde apps/web:
//   pnpm seed:inventory
//
// O manual:
//   cd apps/web && node --env-file=.env.local --import tsx scripts/seed-inventory.ts
//
// Env vars requeridas:
//   - POSTGRES_URL_NON_POOLING (o POSTGRES_URL)

import pg from "pg";

type ZoneId =
  | "lower_third"
  | "bottom_right_corner"
  | "fullscreen_takeover";

interface InventorySpec {
  zone: ZoneId;
  floor_usdc_cents: number;
  max_duration_ms: number;
  manual_only: boolean;
}

const CREATOR_SLUG = "streamer-team";

const INVENTORY: readonly InventorySpec[] = [
  {
    zone: "lower_third",
    floor_usdc_cents: 50, // $0.50 — premium episódico
    max_duration_ms: 8000,
    manual_only: false,
  },
  {
    zone: "bottom_right_corner",
    floor_usdc_cents: 10, // $0.10 — TermoFlex default bidder calza acá
    max_duration_ms: 60000,
    manual_only: false,
  },
  {
    zone: "fullscreen_takeover",
    floor_usdc_cents: 300, // $3.00 — manual-only via hotkey FULL BREAK
    max_duration_ms: 30000,
    manual_only: true,
  },
] as const;

interface AccountRow {
  id: string;
  display_name: string;
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

  const u = new URL(PG_URL);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");

  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const acc = await client.query<AccountRow>(
      `select id, display_name
         from accounts
        where type = 'creator'
          and metadata->>'slug' = $1
        limit 1`,
      [CREATOR_SLUG],
    );
    const creator = acc.rows[0];

    if (!creator) {
      console.error(
        `✗ no hay account type='creator' con metadata.slug='${CREATOR_SLUG}'`,
      );
      console.error("  corré `pnpm seed:wallets` primero.");
      process.exit(2);
    }

    console.log(
      `→ seedeando ${INVENTORY.length} zona(s) para creator ${creator.display_name} (${creator.id})\n`,
    );

    let inserted = 0;
    let updated = 0;

    for (const spec of INVENTORY) {
      process.stdout.write(
        `  ${spec.zone.padEnd(20)} floor=$${(spec.floor_usdc_cents / 100).toFixed(2).padStart(5)} max=${(spec.max_duration_ms / 1000).toString().padStart(2)}s ${spec.manual_only ? "manual" : "auto  "} … `,
      );

      // ON CONFLICT requiere el unique (creator_id, zone) definido en 0002.
      // RETURNING xmax = 0 distingue insert (xmax=0) vs update.
      const res = await client.query<{ xmax: string }>(
        `insert into inventory
           (creator_id, zone, floor_usdc_cents, max_duration_ms, manual_only, enabled)
         values ($1, $2, $3, $4, $5, true)
         on conflict (creator_id, zone) do update
           set floor_usdc_cents = excluded.floor_usdc_cents,
               max_duration_ms  = excluded.max_duration_ms,
               manual_only      = excluded.manual_only,
               enabled          = true,
               updated_at       = now()
         returning (xmax = 0) as inserted`,
        [
          creator.id,
          spec.zone,
          spec.floor_usdc_cents,
          spec.max_duration_ms,
          spec.manual_only,
        ],
      );
      // pg returns booleans as 't'/'f' or true/false depending on driver mode;
      // be defensive.
      const wasInsert =
        (res.rows[0] as unknown as { inserted: boolean | string }).inserted ===
          true ||
        (res.rows[0] as unknown as { inserted: boolean | string }).inserted ===
          "t";

      if (wasInsert) {
        console.log("✓ inserted");
        inserted++;
      } else {
        console.log("✓ updated");
        updated++;
      }
    }

    console.log(
      `\n✓ done. inserted=${inserted} updated=${updated} total=${INVENTORY.length}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗ fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

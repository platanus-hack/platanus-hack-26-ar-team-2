/**
 * DB lookup de wallets (brand + creator) usando pg directo.
 *
 * Reemplaza el path supabase-js de apps/web/src/lib/chain/privy.ts: hablamos
 * Postgres con el mismo Pool que el resto del worker, sin cargar otra dep.
 */

import type { Pool } from "pg";
import type { Address } from "viem";

export type BrandWalletRecord = {
  account_id: string;
  slug: string;
  display_name: string;
  address: Address;
  privy_wallet_id: string;
};

export type CreatorWalletRecord = {
  account_id: string;
  slug: string;
  display_name: string;
  address: Address;
};

type AccountRow = {
  id: string;
  display_name: string;
  wallet_address: string | null;
  metadata: Record<string, unknown> | null;
};

export async function getBrandWallet(
  pool: Pool,
  slug: string,
): Promise<BrandWalletRecord> {
  const res = await pool.query<AccountRow>(
    `select id, display_name, wallet_address, metadata
       from accounts
      where type = 'brand'
        and metadata->>'slug' = $1
      limit 1`,
    [slug],
  );
  const data = res.rows[0];
  if (!data) {
    throw new Error(
      `Brand wallet not seeded for slug "${slug}". Run \`pnpm seed:wallets\`.`,
    );
  }

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const privyWalletId =
    typeof meta.privy_wallet_id === "string" ? meta.privy_wallet_id : null;

  if (!data.wallet_address || !privyWalletId) {
    throw new Error(
      `Brand wallet "${slug}" missing wallet_address or privy_wallet_id (account ${data.id}).`,
    );
  }

  return {
    account_id: data.id,
    slug,
    display_name: data.display_name,
    address: data.wallet_address as Address,
    privy_wallet_id: privyWalletId,
  };
}

export async function getCreatorWallet(
  pool: Pool,
  slug: string,
): Promise<CreatorWalletRecord> {
  const res = await pool.query<AccountRow>(
    `select id, display_name, wallet_address, metadata
       from accounts
      where type = 'creator'
        and (metadata->>'slug' = $1 or display_name = $1)
      limit 1`,
    [slug],
  );
  const data = res.rows[0];
  if (!data) {
    throw new Error(`Creator wallet not seeded for slug "${slug}".`);
  }
  if (!data.wallet_address) {
    throw new Error(
      `Creator "${slug}" missing wallet_address (account ${data.id}).`,
    );
  }

  return {
    account_id: data.id,
    slug,
    display_name: data.display_name,
    address: data.wallet_address as Address,
  };
}

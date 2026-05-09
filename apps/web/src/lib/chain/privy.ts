/**
 * Privy server-side signing for brand wallets (A-09).
 *
 * Each brand wallet was created in seed-wallets.ts (A-05) via Privy's REST API
 * and persisted in `accounts` with:
 *   - accounts.wallet_address           → on-chain address (Base mainnet)
 *   - accounts.metadata.privy_wallet_id → Privy wallet id, used for signing
 *   - accounts.metadata.slug            → stable identifier (cafetito, etc.)
 *
 * createViemAccount() from @privy-io/server-auth/viem turns a (walletId, address)
 * pair into a viem LocalAccount whose signMessage / signTransaction calls go
 * through Privy's wallet API. We plug it into the existing getWalletClient()
 * so the bindings in escrow.ts (lockEscrow / approveUsdcForEscrow) work as-is.
 *
 * Used by:
 *   - C-14 auctions endpoint: brand wallets approve USDC + lock escrow on win
 *   - any server route or script that needs a brand to fire an on-chain tx
 *
 * NOT covered: the platform-owner key (release / refund are onlyOwner) lives
 * outside Privy; plug viem's `privateKeyToAccount` when that flow lands.
 */

import { PrivyClient } from "@privy-io/server-auth";
import { createViemAccount } from "@privy-io/server-auth/viem";
import type { Address, Hash, Hex } from "viem";

import { supabaseAdmin } from "../supabase";
import { assertChainLiveTxsEnabled } from "./env.ts";
import { approveUsdcForEscrow, lockEscrow } from "./escrow.ts";
import { getWalletClient, type AddieWalletClient } from "./viem.ts";

// ====== Types ======

export type BrandWalletRecord = {
  account_id: string;
  slug: string;
  display_name: string;
  address: Address;
  privy_wallet_id: string;
};

// ====== Privy client (lazy singleton) ======

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy) return _privy;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "PRIVY_APP_ID + PRIVY_APP_SECRET missing (P0-11). Run `vercel env pull .env.local` from apps/web/.",
    );
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

// ====== DB lookup ======

/**
 * Look up a brand's seeded wallet by slug (cafetito / termoflex / pancho-rex /
 * matebros). Throws if the row doesn't exist or is missing privy_wallet_id —
 * i.e. seed-wallets.ts never finished for that brand.
 */
export async function getBrandWallet(slug: string): Promise<BrandWalletRecord> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("accounts")
    .select("id, display_name, wallet_address, metadata")
    .eq("type", "brand")
    .eq("metadata->>slug", slug)
    .maybeSingle();

  if (error) throw new Error(`getBrandWallet(${slug}): ${error.message}`);
  if (!data) {
    throw new Error(
      `Brand wallet not seeded for slug "${slug}". Run \`pnpm seed:wallets\` (A-05).`,
    );
  }

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const privyWalletId =
    typeof meta.privy_wallet_id === "string"
      ? (meta.privy_wallet_id as string)
      : null;

  if (!data.wallet_address || !privyWalletId) {
    throw new Error(
      `Brand wallet "${slug}" missing wallet_address or privy_wallet_id (account ${data.id}). Re-run seed-wallets.`,
    );
  }

  return {
    account_id: data.id as string,
    slug,
    display_name: data.display_name as string,
    address: data.wallet_address as Address,
    privy_wallet_id: privyWalletId,
  };
}

// ====== Wallet client factory ======

/**
 * Build a viem WalletClient backed by a Privy server wallet. Calls to
 * `client.writeContract` / `client.signMessage` go through Privy's wallet
 * API; reads + broadcast happen via the Alchemy RPC configured in viem.ts.
 */
export async function getBrandWalletClient(
  slug: string,
): Promise<{ wallet: BrandWalletRecord; client: AddieWalletClient }> {
  const wallet = await getBrandWallet(slug);
  const account = await createViemAccount({
    walletId: wallet.privy_wallet_id,
    address: wallet.address as Hex,
    // The viem subpath ships its own (.d.ts) PrivyClient declaration alongside
    // the main subpath's (.d.mts) — TS sees them as nominally distinct even
    // though they're the same runtime class. Cast through the inferred input
    // type so we don't have to maintain a parallel import path.
    privy: getPrivy() as unknown as Parameters<
      typeof createViemAccount
    >[0]["privy"],
  });
  return { wallet, client: getWalletClient(account) };
}

// ====== High-level signing wrappers ======

/**
 * Brand approves USDC spending by AddieEscrow. Idempotent on-chain — call
 * once with maxUint256 to avoid re-approving on every lock.
 */
export async function signApproveUsdc(args: {
  brandSlug: string;
  amount: bigint;
}): Promise<{ wallet: BrandWalletRecord; txHash: Hash }> {
  assertChainLiveTxsEnabled();
  const { wallet, client } = await getBrandWalletClient(args.brandSlug);
  const txHash = await approveUsdcForEscrow(client, { amount: args.amount });
  return { wallet, txHash };
}

/**
 * Brand locks `amount` USDC against `placementId`, payable to `payee` on release.
 * Caller must have approved the escrow first (signApproveUsdc with a permanent
 * allowance is the recommended path).
 */
export async function signLockEscrow(args: {
  brandSlug: string;
  placementId: Hex;
  payee: Address;
  amount: bigint;
}): Promise<{ wallet: BrandWalletRecord; txHash: Hash }> {
  assertChainLiveTxsEnabled();
  const { wallet, client } = await getBrandWalletClient(args.brandSlug);
  const txHash = await lockEscrow(client, {
    placementId: args.placementId,
    payee: args.payee,
    amount: args.amount,
  });
  return { wallet, txHash };
}

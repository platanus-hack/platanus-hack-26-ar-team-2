/**
 * Privy server-side signing para brand wallets (mirror del worker).
 *
 * - getBrandWalletClient: viem WalletClient backed by Privy server wallet.
 * - signTransferUsdc: directo brand → recipient. Mockea hash si CHAIN_LIVE_TXS=false.
 *
 * Diferencia con apps/web/src/lib/chain/privy.ts: el lookup de wallets se hace
 * con pg directo (chain/wallets.ts) en vez de supabase-js.
 */

import { randomUUID } from "node:crypto";

import { PrivyClient } from "@privy-io/server-auth";
import { createViemAccount } from "@privy-io/server-auth/viem";
import type { Pool } from "pg";
import type { Address, Hash, Hex } from "viem";

import { isChainLiveTxsEnabled } from "./env.js";
import { transferUsdc } from "./escrow.js";
import { getWalletClient, type AddieWalletClient } from "./viem.js";
import { getBrandWallet, type BrandWalletRecord } from "./wallets.js";

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy) return _privy;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "PRIVY_APP_ID + PRIVY_APP_SECRET missing — set them via `flyctl secrets set` on the worker.",
    );
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

export async function getBrandWalletClient(
  pool: Pool,
  slug: string,
): Promise<{ wallet: BrandWalletRecord; client: AddieWalletClient }> {
  const wallet = await getBrandWallet(pool, slug);
  const account = await createViemAccount({
    walletId: wallet.privy_wallet_id,
    address: wallet.address as Hex,
    privy: getPrivy() as unknown as Parameters<
      typeof createViemAccount
    >[0]["privy"],
  });
  return { wallet, client: getWalletClient(account) };
}

export type TransferOutcome = {
  txHash: Hash;
  mode: "live" | "mock";
  payer: BrandWalletRecord;
  payee_address: Address;
  amount: bigint;
};

function mockTxHash(): Hash {
  const a = randomUUID().replace(/-/g, "");
  const b = randomUUID().replace(/-/g, "");
  return `0x${a}${b}` as Hash;
}

export async function signTransferUsdc(
  pool: Pool,
  args: {
    brandSlug: string;
    to: Address;
    amount: bigint;
  },
): Promise<TransferOutcome> {
  if (!isChainLiveTxsEnabled()) {
    const wallet = await getBrandWallet(pool, args.brandSlug);
    return {
      txHash: mockTxHash(),
      mode: "mock",
      payer: wallet,
      payee_address: args.to,
      amount: args.amount,
    };
  }

  const { wallet, client } = await getBrandWalletClient(pool, args.brandSlug);
  const txHash = await transferUsdc(client, { to: args.to, amount: args.amount });
  return {
    txHash,
    mode: "live",
    payer: wallet,
    payee_address: args.to,
    amount: args.amount,
  };
}

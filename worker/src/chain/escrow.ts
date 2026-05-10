/**
 * USDC + AddieEscrow bindings (subset usado por settlement).
 * Mirror reducido de apps/web/src/lib/chain/escrow.ts — solo lo que el worker
 * necesita: USDC ABI + transferUsdc + usdcAmount.
 */

import { parseUnits, type Address, type Hash } from "viem";
import type { AddieWalletClient } from "./viem.js";

export const USDC_ADDRESS_BASE_MAINNET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const USDC_DECIMALS = 6;

export const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function usdcAmount(usd: string | number): bigint {
  return parseUnits(String(usd), USDC_DECIMALS);
}

export async function transferUsdc(
  walletClient: AddieWalletClient,
  args: { to: Address; amount: bigint },
): Promise<Hash> {
  return walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: USDC_ADDRESS_BASE_MAINNET,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [args.to, args.amount],
  });
}

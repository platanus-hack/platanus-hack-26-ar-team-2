/**
 * AddieEscrow on Base mainnet.
 *
 * Deploy: tx 0x792485813a174c8d47cee50a4c8bdfcafb48e5dd063637ca5c56960849675228
 *         block 45775786 · 2026-05-09 · verified on basescan
 * Source: contracts/src/AddieEscrow.sol
 *
 * Bindings (A-08):
 *   - Write:   approveUsdcForEscrow, lockEscrow, releaseEscrow, refundEscrow
 *   - Read:    getPlacement
 *   - Watch:   watchEscrowEvents (Locked / Released / Refunded)
 *
 * Auth model: lock() is called by the brand wallet (after USDC approve).
 *             release() / refund() are onlyOwner — call with the platform owner client.
 */

import {
  parseUnits,
  type Address,
  type Hash,
  type Hex,
  type Log,
} from "viem";
import { publicClient, type AddieWalletClient } from "./viem.ts";

// ====== Constants ======

export const BASE_CHAIN_ID = 8453;

export const ESCROW_ADDRESS =
  "0x8300B9Bd1B6a18163EBd5fB9e0EFa1b7Fd99bCfE" as const;

export const ESCROW_OWNER_ADDRESS =
  "0x7e6685A241278d83068f8Cfb0Dd145F62cb17914" as const;

export const USDC_ADDRESS_BASE_MAINNET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const USDC_DECIMALS = 6;

// ====== ABI ======

export const ESCROW_ABI = [
  {
    type: "function",
    name: "lock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "placementId", type: "bytes32" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "placementId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "placementId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "placements",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "state", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Locked",
    inputs: [
      { name: "placementId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Released",
    inputs: [
      { name: "placementId", type: "bytes32", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "placementId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "PlacementExists", inputs: [] },
  { type: "error", name: "PlacementNotLocked", inputs: [] },
] as const;

export const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ====== Types ======

export const PlacementState = {
  None: 0,
  Locked: 1,
  Released: 2,
  Refunded: 3,
} as const;
export type PlacementState =
  (typeof PlacementState)[keyof typeof PlacementState];

export type Placement = {
  payer: Address;
  payee: Address;
  amount: bigint;
  state: PlacementState;
};

export type LockedEvent = {
  placementId: Hex;
  payer: Address;
  payee: Address;
  amount: bigint;
  log: Log;
};

export type ReleasedEvent = {
  placementId: Hex;
  payee: Address;
  amount: bigint;
  log: Log;
};

export type RefundedEvent = {
  placementId: Hex;
  payer: Address;
  amount: bigint;
  log: Log;
};

// ====== Helpers ======

/** USDC has 6 decimals on Base mainnet. usdcAmount("5") → 5_000_000n. */
export function usdcAmount(usd: string | number): bigint {
  return parseUnits(String(usd), USDC_DECIMALS);
}

// ====== Write ======

/**
 * Brand approves USDC spending by the escrow contract.
 * Required before the first lockEscrow call from a given brand wallet
 * (or call once with maxUint256 at setup to avoid repeating).
 */
export async function approveUsdcForEscrow(
  walletClient: AddieWalletClient,
  args: { amount: bigint },
): Promise<Hash> {
  return walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: USDC_ADDRESS_BASE_MAINNET,
    abi: USDC_ABI,
    functionName: "approve",
    args: [ESCROW_ADDRESS, args.amount],
  });
}

/**
 * Brand locks `amount` USDC against `placementId`, payable to `payee` on release.
 * Caller must have approved the escrow for at least `amount` USDC first.
 */
export async function lockEscrow(
  walletClient: AddieWalletClient,
  args: { placementId: Hex; payee: Address; amount: bigint },
): Promise<Hash> {
  return walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "lock",
    args: [args.placementId, args.payee, args.amount],
  });
}

/** Owner releases USDC to the payee (creator). Reverts if not Locked. */
export async function releaseEscrow(
  walletClient: AddieWalletClient,
  args: { placementId: Hex },
): Promise<Hash> {
  return walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "release",
    args: [args.placementId],
  });
}

/** Owner refunds USDC to the payer (brand). Reverts if not Locked. */
export async function refundEscrow(
  walletClient: AddieWalletClient,
  args: { placementId: Hex },
): Promise<Hash> {
  return walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "refund",
    args: [args.placementId],
  });
}

// ====== Read ======

export async function getPlacement(placementId: Hex): Promise<Placement> {
  const [payer, payee, amount, state] = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "placements",
    args: [placementId],
  });
  return { payer, payee, amount, state: state as PlacementState };
}

// ====== Watchers ======

export type EscrowEventHandlers = {
  onLocked?: (e: LockedEvent) => void;
  onReleased?: (e: ReleasedEvent) => void;
  onRefunded?: (e: RefundedEvent) => void;
  /** Optional starting block (defaults to "latest"). Set to a past block to backfill. */
  fromBlock?: bigint;
};

/**
 * Subscribe to escrow events. Returns an unwatch function that cancels every active subscription.
 * Uses HTTP polling under the hood (matches the publicClient transport).
 */
export function watchEscrowEvents(handlers: EscrowEventHandlers): () => void {
  const unsubs: Array<() => void> = [];
  const fromBlock = handlers.fromBlock;

  if (handlers.onLocked) {
    const onLocked = handlers.onLocked;
    unsubs.push(
      publicClient.watchContractEvent({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        eventName: "Locked",
        fromBlock,
        onLogs: (logs) => {
          for (const log of logs) {
            const { placementId, payer, payee, amount } = log.args;
            if (
              placementId === undefined ||
              payer === undefined ||
              payee === undefined ||
              amount === undefined
            )
              continue;
            onLocked({ placementId, payer, payee, amount, log });
          }
        },
      }),
    );
  }

  if (handlers.onReleased) {
    const onReleased = handlers.onReleased;
    unsubs.push(
      publicClient.watchContractEvent({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        eventName: "Released",
        fromBlock,
        onLogs: (logs) => {
          for (const log of logs) {
            const { placementId, payee, amount } = log.args;
            if (
              placementId === undefined ||
              payee === undefined ||
              amount === undefined
            )
              continue;
            onReleased({ placementId, payee, amount, log });
          }
        },
      }),
    );
  }

  if (handlers.onRefunded) {
    const onRefunded = handlers.onRefunded;
    unsubs.push(
      publicClient.watchContractEvent({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        eventName: "Refunded",
        fromBlock,
        onLogs: (logs) => {
          for (const log of logs) {
            const { placementId, payer, amount } = log.args;
            if (
              placementId === undefined ||
              payer === undefined ||
              amount === undefined
            )
              continue;
            onRefunded({ placementId, payer, amount, log });
          }
        },
      }),
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

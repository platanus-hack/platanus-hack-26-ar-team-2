// apps/web/scripts/smoke-privy-sign.mts — A-09.
//
// Validates the Privy server-side signing path without spending gas:
//   1) Resolve a brand wallet by slug from `accounts` (default "cafetito")
//   2) Build a viem WalletClient backed by Privy via createViemAccount
//   3) Sign an ephemeral message → recover address → assert it matches
//      `accounts.wallet_address` (proves the env, Privy API, and signing path
//      all agree on which key signs for this wallet)
//   4) Read USDC.allowance(wallet, escrow) on Base mainnet so the operator can
//      see how much USDC the escrow can pull from this brand without a fresh
//      approve()
//
// Idempotent. No gas required (signMessage is off-chain; allowance is a read).
//
// Run from apps/web:
//   node --env-file=.env.local --import tsx scripts/smoke-privy-sign.mts
//
// Override the brand:
//   BRAND_SLUG=termoflex node --env-file=.env.local --import tsx scripts/smoke-privy-sign.mts

process.env.ALCHEMY_RPC_URL ??= "https://mainnet.base.org";

import { recoverMessageAddress } from "viem";

const { getBrandWalletClient } = await import("../src/lib/chain/privy.ts");
const { publicClient } = await import("../src/lib/chain/viem.ts");
const { ESCROW_ADDRESS, USDC_ABI, USDC_ADDRESS_BASE_MAINNET } = await import(
  "../src/lib/chain/escrow.ts"
);

const slug = process.env.BRAND_SLUG ?? "cafetito";
const message = `addie:smoke:${new Date().toISOString()}`;

console.log("rpc           :", process.env.ALCHEMY_RPC_URL);
console.log("brand slug    :", slug);

const { wallet, client } = await getBrandWalletClient(slug);

console.log("display_name  :", wallet.display_name);
console.log("wallet address:", wallet.address);
console.log("privy wallet  :", wallet.privy_wallet_id);

const signature = await client.signMessage({ account: client.account, message });
const recovered = await recoverMessageAddress({ message, signature });
const recoveredOk = recovered.toLowerCase() === wallet.address.toLowerCase();

console.log("signed message:", `"${message}"`);
console.log("signature     :", signature.slice(0, 18) + "…");
console.log(
  "recovered     :",
  recovered,
  recoveredOk ? "(OK)" : "(MISMATCH)",
);

const allowance = await publicClient.readContract({
  address: USDC_ADDRESS_BASE_MAINNET,
  abi: USDC_ABI,
  functionName: "allowance",
  args: [wallet.address, ESCROW_ADDRESS],
});
console.log(
  "usdc allowance:",
  allowance.toString(),
  "(escrow can pull this many USDC subunits from the brand without a new approve)",
);

if (!recoveredOk) {
  console.error("\nSMOKE FAIL — recovered address does not match the brand wallet.");
  process.exit(1);
}

console.log("\nSMOKE OK — Privy signing path live against the seeded brand wallet.");

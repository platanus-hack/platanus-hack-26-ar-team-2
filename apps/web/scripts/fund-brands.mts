// A-06 · Distribute USDC + ETH from owner wallet to the 4 brand wallets.
//
// Idempotent: skips brands that already meet thresholds (re-running is safe).
//   USDC: send 5 USDC if balance < 5 USDC, else skip
//   ETH:  send 0.0001 ETH if balance < 0.00005 ETH, else skip
//
// The owner private key must derive to ESCROW_OWNER_ADDRESS — script aborts otherwise.
//
// Run from apps/web/ (one-shot, PK never written to disk):
//   export OWNER_PRIVATE_KEY=$(cast wallet dk addie-treasury)   # prompts password
//   pnpm fund:brands [--dry-run] [--target <slug>]              # slug ∈ cafetito|termoflex|pancho-rex|matebros
//   unset OWNER_PRIVATE_KEY
//
// --dry-run prints the plan + simulates balances without broadcasting.
// --target <slug> restricts to a single brand (useful for testing).

import {
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import pg from "pg";

const {
  ESCROW_OWNER_ADDRESS,
  USDC_ABI,
  USDC_ADDRESS_BASE_MAINNET,
  USDC_DECIMALS,
} = await import("../src/lib/chain/escrow.ts");
const { publicClient } = await import("../src/lib/chain/viem.ts");

// Minimal ABI for ERC20 transfer — escrow.ts USDC_ABI only exports approve/allowance/balanceOf
// since the brand wallets only ever call approve(). Owner-side transfer() is admin-only,
// so we keep the binding local to this script instead of broadening the public export.
const ERC20_TRANSFER_ABI = [
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
] as const;

// ---- thresholds ----
const USDC_TARGET = parseUnits("5", USDC_DECIMALS); // 5 USDC = 5_000_000n
const USDC_SKIP_AT_LEAST = parseUnits("5", USDC_DECIMALS); // skip if >= 5 USDC
const ETH_TARGET = parseEther("0.0001"); // 0.0001 ETH ≈ $0.35 ≈ ~100 placements of gas
const ETH_SKIP_AT_LEAST = parseEther("0.00005"); // skip if >= 0.00005 ETH (~50 placements)
const ETH_GAS_RESERVE = parseEther("0.0005"); // owner reserve for its own future txs

const BRAND_SLUGS = ["cafetito", "termoflex", "pancho-rex", "matebros"] as const;

// ---- args ----
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const targetIdx = args.indexOf("--target");
const TARGET_SLUG = targetIdx >= 0 ? args[targetIdx + 1] : null;
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null; // "usdc" | "eth" | null
if (ONLY && ONLY !== "usdc" && ONLY !== "eth") {
  console.error(`ERROR: --only must be "usdc" or "eth" (got "${ONLY}")`);
  process.exit(1);
}

// ---- read + validate owner PK ----
// `cast wallet dk addie-treasury` outputs something like
// `addie-treasury's private key is 0x<64-hex>` (Foundry recent versions),
// not a bare hex string. We accept any input that contains a 0x-prefixed
// 64-hex-char substring and extract it.
const pkRaw = process.env.OWNER_PRIVATE_KEY?.trim() ?? "";
const pkMatch = pkRaw.match(/0x[0-9a-fA-F]{64}/);
if (!pkMatch) {
  console.error("ERROR: OWNER_PRIVATE_KEY missing or doesn't contain a 0x-prefixed 64-hex private key.");
  console.error(`  got ${pkRaw.length} chars; expected a string containing 0x<64-hex>.`);
  console.error("  extract from Foundry keystore: export OWNER_PRIVATE_KEY=$(cast wallet dk addie-treasury)");
  process.exit(1);
}
const pk = pkMatch[0] as Hex;
const account = privateKeyToAccount(pk);
if (account.address.toLowerCase() !== ESCROW_OWNER_ADDRESS.toLowerCase()) {
  console.error(`ERROR: PK derives to ${account.address}, expected owner ${ESCROW_OWNER_ADDRESS}`);
  process.exit(1);
}

console.log(`Owner:   ${account.address} (matches escrow owner)`);
console.log(`Mode:    ${DRY_RUN ? "DRY-RUN (no broadcast)" : "LIVE"}`);
if (TARGET_SLUG) console.log(`Target:  ${TARGET_SLUG} only`);

// ---- read brand wallets from DB ----
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("ERROR: POSTGRES_URL_NON_POOLING not set");
  process.exit(1);
}
const u = new URL(url);
u.searchParams.delete("sslmode");
u.searchParams.delete("supa");
const dbClient = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: false },
});
await dbClient.connect();
const { rows } = await dbClient.query<{
  slug: string;
  display_name: string;
  wallet_address: string;
}>(
  `select metadata->>'slug' as slug, display_name, wallet_address
   from accounts
   where type = 'brand'
     and wallet_address is not null
     and metadata->>'slug' = ANY($1::text[])
   order by created_at`,
  [BRAND_SLUGS],
);
await dbClient.end();

if (rows.length !== BRAND_SLUGS.length) {
  console.error(`ERROR: expected ${BRAND_SLUGS.length} brand wallets, got ${rows.length}`);
  console.error("  rows:", rows);
  process.exit(1);
}

const brands = TARGET_SLUG ? rows.filter((r) => r.slug === TARGET_SLUG) : rows;
if (TARGET_SLUG && brands.length === 0) {
  console.error(`ERROR: no brand with slug=${TARGET_SLUG}`);
  process.exit(1);
}

// ---- compute plan ----
type PlanRow = {
  slug: string;
  name: string;
  addr: Address;
  usdcCurrent: bigint;
  ethCurrent: bigint;
  usdcSend: bigint;
  ethSend: bigint;
};

console.log("\n=== PLAN ===");
const plan: PlanRow[] = [];
for (const brand of brands) {
  const addr = brand.wallet_address as Address;
  const [usdcCurrent, ethCurrent] = await Promise.all([
    publicClient.readContract({
      address: USDC_ADDRESS_BASE_MAINNET,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [addr],
    }),
    publicClient.getBalance({ address: addr }),
  ]);
  const usdcSend =
    ONLY === "eth" ? 0n : usdcCurrent >= USDC_SKIP_AT_LEAST ? 0n : USDC_TARGET;
  const ethSend =
    ONLY === "usdc" ? 0n : ethCurrent >= ETH_SKIP_AT_LEAST ? 0n : ETH_TARGET;
  plan.push({ slug: brand.slug, name: brand.display_name, addr, usdcCurrent, ethCurrent, usdcSend, ethSend });

  console.log(`  ${brand.display_name.padEnd(12)} ${addr}`);
  console.log(
    `    USDC ${formatUnits(usdcCurrent, USDC_DECIMALS).padEnd(10)} ${
      usdcSend === 0n ? "→ skip (>= 5 USDC)" : `→ send ${formatUnits(usdcSend, USDC_DECIMALS)} USDC`
    }`,
  );
  console.log(
    `    ETH  ${formatEther(ethCurrent).padEnd(20)} ${
      ethSend === 0n ? "→ skip (>= 0.00005 ETH)" : `→ send ${formatEther(ethSend)} ETH`
    }`,
  );
}

const totalUsdc = plan.reduce((acc, p) => acc + p.usdcSend, 0n);
const totalEth = plan.reduce((acc, p) => acc + p.ethSend, 0n);
console.log(`\nTotal: ${formatUnits(totalUsdc, USDC_DECIMALS)} USDC + ${formatEther(totalEth)} ETH`);

// ---- check owner has enough ----
const [ownerUsdc, ownerEth] = await Promise.all([
  publicClient.readContract({
    address: USDC_ADDRESS_BASE_MAINNET,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  }),
  publicClient.getBalance({ address: account.address }),
]);
console.log(`Owner has: ${formatUnits(ownerUsdc, USDC_DECIMALS)} USDC + ${formatEther(ownerEth)} ETH`);

if (ownerUsdc < totalUsdc) {
  console.error(`ERROR: owner USDC insufficient (have ${formatUnits(ownerUsdc, USDC_DECIMALS)}, need ${formatUnits(totalUsdc, USDC_DECIMALS)})`);
  process.exit(1);
}
if (ownerEth < totalEth + ETH_GAS_RESERVE) {
  console.error(
    `ERROR: owner ETH insufficient (have ${formatEther(ownerEth)}, need ${formatEther(totalEth + ETH_GAS_RESERVE)} = ${formatEther(totalEth)} + ${formatEther(ETH_GAS_RESERVE)} gas reserve)`,
  );
  process.exit(1);
}

if (totalUsdc === 0n && totalEth === 0n) {
  console.log("\nNothing to do — todos los targets ya están sobre el threshold.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("\nDRY-RUN: no broadcast. Re-correr sin --dry-run para ejecutar.");
  process.exit(0);
}

// ---- execute ----
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.ALCHEMY_RPC_URL!),
});

type TxRow = { kind: "USDC" | "ETH"; brand: string; amount: bigint; hash: Hex; block: bigint };
const txs: TxRow[] = [];

// USDC first (more important — these are the funds the brand uses for lock())
for (const p of plan) {
  if (p.usdcSend === 0n) continue;
  console.log(`\n→ USDC ${formatUnits(p.usdcSend, USDC_DECIMALS)} to ${p.name} (${p.addr})`);
  const hash = await wallet.writeContract({
    address: USDC_ADDRESS_BASE_MAINNET,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [p.addr, p.usdcSend],
  });
  console.log(`  tx:    ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`  REVERTED — abort`);
    process.exit(1);
  }
  console.log(`  ✓ block ${receipt.blockNumber} | gas ${receipt.gasUsed}`);
  txs.push({ kind: "USDC", brand: p.name, amount: p.usdcSend, hash, block: receipt.blockNumber });
}

// Then ETH (gas for brand's future approve + lock)
for (const p of plan) {
  if (p.ethSend === 0n) continue;
  console.log(`\n→ ETH ${formatEther(p.ethSend)} to ${p.name} (${p.addr})`);
  const hash = await wallet.sendTransaction({ to: p.addr, value: p.ethSend });
  console.log(`  tx:    ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`  REVERTED — abort`);
    process.exit(1);
  }
  console.log(`  ✓ block ${receipt.blockNumber} | gas ${receipt.gasUsed}`);
  txs.push({ kind: "ETH", brand: p.name, amount: p.ethSend, hash, block: receipt.blockNumber });
}

// ---- final verification ----
// Alchemy state cache lags ~500ms-2s behind block inclusion, so a balance read
// immediately after waitForTransactionReceipt() can return pre-tx values even
// though the tx is fully confirmed. Pause to let propagation catch up.
console.log("\n(waiting 2s for Alchemy state propagation before verification...)");
await new Promise((r) => setTimeout(r, 2000));

console.log("\n=== POST-TX BALANCES ===");
for (const p of plan) {
  const [u2, e2] = await Promise.all([
    publicClient.readContract({
      address: USDC_ADDRESS_BASE_MAINNET,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [p.addr],
    }),
    publicClient.getBalance({ address: p.addr }),
  ]);
  console.log(`  ${p.name.padEnd(12)} USDC ${formatUnits(u2, USDC_DECIMALS).padEnd(10)} ETH ${formatEther(e2)}`);
}

console.log("\n=== TX HASHES (audit) ===");
for (const t of txs) {
  const amt = t.kind === "USDC" ? `${formatUnits(t.amount, USDC_DECIMALS)} USDC` : `${formatEther(t.amount)} ETH`;
  console.log(`  ${t.kind.padEnd(4)} ${amt.padEnd(20)} → ${t.brand}`);
  console.log(`       https://basescan.org/tx/${t.hash}`);
}

console.log(`\nDONE — ${txs.length} txs broadcasted + confirmed`);

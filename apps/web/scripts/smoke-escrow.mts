// Smoke test para los bindings del AddieEscrow (A-08).
// Lee owner() / usdc() / placements(0x00) contra Base mainnet y valida
// que matchean las consts del módulo. No firma transacciones.
//
// Run:
//   node --env-file=apps/web/.env.local apps/web/scripts/smoke-escrow.mts
//
// Si ALCHEMY_RPC_URL no está seteada (env local no hidratada todavía), cae al
// RPC público de Base (https://mainnet.base.org) — el smoke solo lee state.

process.env.ALCHEMY_RPC_URL ??= "https://mainnet.base.org";

const { ESCROW_ABI, ESCROW_ADDRESS, ESCROW_OWNER_ADDRESS, PlacementState, USDC_ADDRESS_BASE_MAINNET, getPlacement } =
  await import("../src/lib/chain/escrow.ts");
const { publicClient } = await import("../src/lib/chain/viem.ts");

const ZERO_PLACEMENT_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const [owner, usdc, placement] = await Promise.all([
  publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "owner",
  }),
  publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "usdc",
  }),
  getPlacement(ZERO_PLACEMENT_ID),
]);

const ownerOk = owner.toLowerCase() === ESCROW_OWNER_ADDRESS.toLowerCase();
const usdcOk = usdc.toLowerCase() === USDC_ADDRESS_BASE_MAINNET.toLowerCase();
const placementOk =
  placement.state === PlacementState.None &&
  placement.amount === BigInt(0) &&
  placement.payer.toLowerCase() === ZERO_ADDRESS &&
  placement.payee.toLowerCase() === ZERO_ADDRESS;

console.log("rpc           :", process.env.ALCHEMY_RPC_URL);
console.log("escrow address:", ESCROW_ADDRESS);
console.log("owner()       :", owner, ownerOk ? "(OK)" : "(MISMATCH)");
console.log("usdc()        :", usdc, usdcOk ? "(OK)" : "(MISMATCH)");
console.log("placements(0) :", placement, placementOk ? "(OK)" : "(MISMATCH)");

if (!ownerOk || !usdcOk || !placementOk) {
  console.error("\nSMOKE FAIL");
  process.exit(1);
}
console.log("\nSMOKE OK - ABI + RPC + bindings conectan contra Base mainnet.");

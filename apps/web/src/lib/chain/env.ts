/**
 * Chain runtime kill-switch (A-12).
 *
 * `CHAIN_LIVE_TXS` defaults to `false`. While false, every helper that
 * broadcasts a write tx on Base mainnet must short-circuit with a clear
 * error before signing — protects against accidental USDC movement during
 * dev / QA when buttons (FORCE EVENT, FULL BREAK) wired to C-14 fire real
 * locks. Flipped to `true` in F-05 (final dress rehearsal) and removed
 * entirely in A-12b.
 *
 * Gated:
 *   - signApproveUsdc, signLockEscrow (privy.ts — brand wallets)
 *   - releaseEscrow, refundEscrow     (escrow.ts — owner-side, called by
 *     future server routes / admin endpoints, NOT by Foundry deploy scripts)
 *
 * NOT gated (admin, intentional, off the auction path):
 *   - fund-brands.mts (USDC transfer with OWNER_PRIVATE_KEY)
 *   - Deploy.s.sol (Solidity, runs outside this TS layer anyway)
 */

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

export function isChainLiveTxsEnabled(): boolean {
  const raw = process.env.CHAIN_LIVE_TXS?.trim().toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

export function assertChainLiveTxsEnabled(): void {
  if (!isChainLiveTxsEnabled()) {
    throw new Error(
      "CHAIN_LIVE_TXS=false — broadcast blocked (A-12 kill-switch). Set CHAIN_LIVE_TXS=true to enable on-chain writes.",
    );
  }
}

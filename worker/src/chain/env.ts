/**
 * Chain runtime kill-switch (mirror de apps/web/src/lib/chain/env.ts).
 *
 * `CHAIN_LIVE_TXS` defaults to `false`. Mientras esté `false`, signTransferUsdc
 * mockea el tx_hash sin broadcastear. Flippear a `true` solo en F-05 (live demo).
 */

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

export function isChainLiveTxsEnabled(): boolean {
  const raw = process.env.CHAIN_LIVE_TXS?.trim().toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

export function assertChainLiveTxsEnabled(): void {
  if (!isChainLiveTxsEnabled()) {
    throw new Error(
      "CHAIN_LIVE_TXS=false — broadcast blocked. Set CHAIN_LIVE_TXS=true to enable on-chain writes.",
    );
  }
}

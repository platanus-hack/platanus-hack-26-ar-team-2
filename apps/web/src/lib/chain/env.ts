/**
 * Chain runtime kill-switch (A-12) — DESACTIVADO.
 *
 * El kill-switch via `CHAIN_LIVE_TXS` se removió para F-05 (live demo):
 * todos los broadcasts on-chain quedan habilitados por defecto. Las
 * funciones se mantienen para no romper call sites; ya no leen env.
 */

export function isChainLiveTxsEnabled(): boolean {
  return true;
}

export function assertChainLiveTxsEnabled(): void {
  // no-op
}

/**
 * Chain runtime kill-switch (mirror de apps/web/src/lib/chain/env.ts) — DESACTIVADO.
 *
 * Removido para F-05 (live demo): broadcasts on-chain habilitados por
 * defecto. Funciones mantenidas para no romper call sites; ya no leen env.
 */

export function isChainLiveTxsEnabled(): boolean {
  return true;
}

export function assertChainLiveTxsEnabled(): void {
  // no-op
}

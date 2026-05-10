/**
 * Chain runtime kill-switch (A-12) — RE-ACTIVADO (broadcasts apagados).
 *
 * Hardcodeado en `false`: bloquea todo broadcast on-chain en los wrappers
 * gateados (signApproveUsdc, signLockEscrow, releaseEscrow, refundEscrow,
 * signTransferUsdc). Si necesitás volver a habilitar plata real, cambiá
 * `isChainLiveTxsEnabled` a `return true` y `assertChainLiveTxsEnabled` a
 * `// no-op` (espejo del commit A-12b previo).
 */

export function isChainLiveTxsEnabled(): boolean {
  return false;
}

export function assertChainLiveTxsEnabled(): void {
  throw new Error(
    "CHAIN_LIVE_TXS=false — broadcast blocked (A-12 kill-switch hardcoded off).",
  );
}

/**
 * Chain runtime kill-switch (mirror de apps/web/src/lib/chain/env.ts) — RE-ACTIVADO.
 *
 * Hardcodeado en `false`: signTransferUsdc cae en path mock (tx_hash sintético,
 * sin broadcast). Si necesitás volver a habilitar plata real, cambiá
 * `isChainLiveTxsEnabled` a `return true` y `assertChainLiveTxsEnabled` a
 * `// no-op` (espejo del commit A-12b previo).
 */

export function isChainLiveTxsEnabled(): boolean {
  return false;
}

export function assertChainLiveTxsEnabled(): void {
  throw new Error(
    "CHAIN_LIVE_TXS=false — broadcast blocked (kill-switch hardcoded off).",
  );
}

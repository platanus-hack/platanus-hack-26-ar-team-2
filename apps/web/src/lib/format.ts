const USDC_DECIMALS = 6;

export function formatUsdc(amount: bigint | number): string {
  const human =
    typeof amount === "bigint"
      ? Number(amount) / Math.pow(10, USDC_DECIMALS)
      : amount;
  return `$${human.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function truncateTxHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function basescanUrl(value: string, kind: "address" | "tx"): string {
  const path = kind === "tx" ? "tx" : "address";
  return `https://basescan.org/${path}/${value}`;
}

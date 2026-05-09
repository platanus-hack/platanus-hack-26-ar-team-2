"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";

import {
  watchEscrowEvents,
  type LockedEvent,
  type ReleasedEvent,
  type RefundedEvent,
} from "@/lib/chain/escrow";
import { formatUsdc, truncateAddress, truncateTxHash, basescanUrl } from "@/lib/format";

export type TxFeedEntryType = "lock" | "release" | "refund";

export interface TxFeedEntry {
  id: string;
  type: TxFeedEntryType;
  placementId: Hex;
  /** payer for lock/refund · payee for release */
  counterparty: Address;
  amount: bigint;
  txHash: Hex;
  blockNumber: bigint | null;
  ts: number;
}

export interface TxFeedProps {
  /** Cap for visible entries (newest first). Default 20. */
  maxItems?: number;
  /**
   * Optional starting block — backfill historical events on mount.
   * Defaults to "latest" (only new events from now on).
   */
  fromBlock?: bigint;
  /**
   * Optional address → label map (e.g. brand wallets). Falls back to
   * a truncated hex address when missing.
   */
  addressLabels?: Record<string, string>;
  /** Tailwind classes appended to the outer container. */
  className?: string;
}

const TYPE_STYLES: Record<
  TxFeedEntryType,
  { icon: string; label: string; tone: string; ring: string }
> = {
  lock: {
    icon: "🔒",
    label: "LOCK",
    tone: "text-[#f59e0b]",
    ring: "border-[#f59e0b]/30 bg-[#f59e0b]/5",
  },
  release: {
    icon: "✅",
    label: "RELEASE",
    tone: "text-[#22c55e]",
    ring: "border-[#22c55e]/30 bg-[#22c55e]/5",
  },
  refund: {
    icon: "↩️",
    label: "REFUND",
    tone: "text-[#ef4444]",
    ring: "border-[#ef4444]/30 bg-[#ef4444]/5",
  },
};


function entryKey(txHash: Hex, logIndex: number | null | undefined): string {
  return `${txHash}-${logIndex ?? 0}`;
}

export default function TxFeed({
  maxItems = 20,
  fromBlock,
  addressLabels,
  className = "",
}: TxFeedProps) {
  const [entries, setEntries] = useState<TxFeedEntry[]>([]);

  useEffect(() => {
    const seen = new Set<string>();

    const push = (entry: TxFeedEntry) => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      setEntries((prev) => [entry, ...prev].slice(0, maxItems));
    };

    const unwatch = watchEscrowEvents({
      fromBlock,
      onLocked: (e: LockedEvent) =>
        push({
          id: entryKey(e.log.transactionHash as Hex, e.log.logIndex),
          type: "lock",
          placementId: e.placementId,
          counterparty: e.payer,
          amount: e.amount,
          txHash: e.log.transactionHash as Hex,
          blockNumber: e.log.blockNumber ?? null,
          ts: Date.now(),
        }),
      onReleased: (e: ReleasedEvent) =>
        push({
          id: entryKey(e.log.transactionHash as Hex, e.log.logIndex),
          type: "release",
          placementId: e.placementId,
          counterparty: e.payee,
          amount: e.amount,
          txHash: e.log.transactionHash as Hex,
          blockNumber: e.log.blockNumber ?? null,
          ts: Date.now(),
        }),
      onRefunded: (e: RefundedEvent) =>
        push({
          id: entryKey(e.log.transactionHash as Hex, e.log.logIndex),
          type: "refund",
          placementId: e.placementId,
          counterparty: e.payer,
          amount: e.amount,
          txHash: e.log.transactionHash as Hex,
          blockNumber: e.log.blockNumber ?? null,
          ts: Date.now(),
        }),
    });

    return unwatch;
  }, [fromBlock, maxItems]);

  return (
    <div
      className={`flex flex-col gap-2 font-sans text-[var(--text)] ${className}`}
    >
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          On-chain · Base
        </h3>
        <span className="text-[10px] text-[var(--text-3)]">
          {entries.length === 0 ? "Listening…" : `${entries.length} txs`}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {entries.length === 0 ? (
            <motion.li
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-md border border-dashed border-[var(--line)] px-3 py-4 text-center text-xs text-[var(--text-3)]"
            >
              Waiting for escrow events…
            </motion.li>
          ) : (
            entries.map((entry) => (
              <TxRow
                key={entry.id}
                entry={entry}
                addressLabels={addressLabels}
              />
            ))
          )}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function TxRow({
  entry,
  addressLabels,
}: {
  entry: TxFeedEntry;
  addressLabels?: Record<string, string>;
}) {
  const style = TYPE_STYLES[entry.type];
  const counterpartyLabel =
    addressLabels?.[entry.counterparty.toLowerCase()] ??
    addressLabels?.[entry.counterparty] ??
    truncateAddress(entry.counterparty);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className={`rounded-md border px-3 py-2 ${style.ring}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden>{style.icon}</span>
          <span className={`text-[11px] font-bold tracking-wider ${style.tone}`}>
            {style.label}
          </span>
          <span className="truncate text-xs text-[var(--text-2)]">
            {counterpartyLabel}
          </span>
        </div>
        <span className="shrink-0 text-sm font-bold text-[#22d3ee] tabular-nums">
          {formatUsdc(entry.amount)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-[var(--text-3)]">
        <a
          href={basescanUrl(entry.txHash, "tx")}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono hover:text-[var(--text)] hover:underline"
          title={entry.txHash}
        >
          {truncateTxHash(entry.txHash)} ↗
        </a>
        <span className="font-mono">
          {entry.blockNumber !== null ? `#${entry.blockNumber.toString()}` : ""}
        </span>
      </div>
    </motion.li>
  );
}

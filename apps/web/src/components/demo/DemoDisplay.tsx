"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useReducer, useRef } from "react";

export type AuctionStatus = "idle" | "running" | "settled";

export interface BidEntry {
  brand_id: string;
  brand_label: string;
  bid_usdc: number;
  zone: string;
  status: "bidding" | "won" | "lost" | "refunded";
}

export interface NegotiationMessage {
  id: string;
  role: "brand" | "streamer";
  brand_id?: string;
  brand_label?: string;
  text: string;
  ts: number;
}

export interface TxEntry {
  id: string;
  type: "lock" | "release" | "refund";
  brand: string;
  amount_usdc: number;
  tx_hash: string;
  ts: number;
}

export interface DemoDisplayHooks {
  onAuctionStatus?: (handler: (s: AuctionStatus) => void) => () => void;
  onBidUpdate?: (handler: (b: BidEntry) => void) => () => void;
  onMessage?: (handler: (m: NegotiationMessage) => void) => () => void;
  onTx?: (handler: (t: TxEntry) => void) => () => void;
}

interface State {
  status: AuctionStatus;
  bids: BidEntry[];
  messages: NegotiationMessage[];
  txs: TxEntry[];
}

type Action =
  | { type: "SET_STATUS"; status: AuctionStatus }
  | { type: "UPSERT_BID"; bid: BidEntry }
  | { type: "ADD_MESSAGE"; message: NegotiationMessage }
  | { type: "ADD_TX"; tx: TxEntry };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "UPSERT_BID": {
      const idx = state.bids.findIndex((b) => b.brand_id === action.bid.brand_id);
      const next = [...state.bids];
      if (idx >= 0) {
        next[idx] = action.bid;
      } else {
        next.push(action.bid);
      }
      return { ...state, bids: next.sort((a, b) => b.bid_usdc - a.bid_usdc) };
    }
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message].slice(-50) };
    case "ADD_TX":
      return { ...state, txs: [action.tx, ...state.txs].slice(0, 20) };
  }
}

const BRAND_COLORS: Record<string, string> = {
  adidas: "#f0f0f5",
  nike: "#ff6600",
  quilmes: "#f5c400",
  mp: "#009ee3",
  steam: "#66c0f4",
  rappi: "#ff441f",
  globant: "#b8d430",
  cocacola: "#f40009",
};

export default function DemoDisplay({ hooks }: { hooks?: DemoDisplayHooks }) {
  const [state, dispatch] = useReducer(reducer, { status: "idle", bids: [], messages: [], txs: [] });
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (hooks?.onAuctionStatus)
      cleanups.push(hooks.onAuctionStatus((s) => dispatch({ type: "SET_STATUS", status: s })));
    if (hooks?.onBidUpdate)
      cleanups.push(hooks.onBidUpdate((b) => dispatch({ type: "UPSERT_BID", bid: b })));
    if (hooks?.onMessage)
      cleanups.push(hooks.onMessage((m) => dispatch({ type: "ADD_MESSAGE", message: m })));
    if (hooks?.onTx)
      cleanups.push(hooks.onTx((t) => dispatch({ type: "ADD_TX", tx: t })));
    return () => cleanups.forEach((f) => f());
  }, [hooks]);

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--line)] bg-[var(--page-2)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">Addie</span>
          <span className="text-xs text-[var(--text-3)]">Demo Display</span>
        </div>
        <AuctionBadge status={state.status} />
      </header>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-[1fr_1.4fr] gap-0 overflow-hidden">
        {/* Left: Bid leaderboard */}
        <section className="border-r border-[var(--line)] flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--line)] bg-[var(--card)]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-2)]">Live bids</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            <AnimatePresence>
              {state.bids.length === 0 ? (
                <p className="text-xs text-[var(--text-3)] p-2">Waiting for auction…</p>
              ) : (
                state.bids.map((bid, i) => <BidRow key={bid.brand_id} bid={bid} rank={i + 1} />)
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Right: Negotiation chat */}
        <section className="flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--line)] bg-[var(--card)]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-2)]">Negotiation</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {state.messages.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">No auction running yet…</p>
              ) : (
                state.messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
              )}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>
        </section>
      </div>

      {/* Bottom: TX feed */}
      <section className="border-t border-[var(--line)] bg-[var(--card)] px-4 py-2 flex gap-4 overflow-x-auto min-h-[52px] items-center">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] shrink-0">On-chain</span>
        <AnimatePresence>
          {state.txs.length === 0 ? (
            <span className="text-xs text-[var(--text-5)]">No transactions yet</span>
          ) : (
            state.txs.map((tx) => <TxChip key={tx.id} tx={tx} />)
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function AuctionBadge({ status }: { status: AuctionStatus }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[#22c55e]">
        <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
        AUCTION LIVE
      </span>
    );
  }
  if (status === "settled") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[#6366f1]">
        <span className="w-2 h-2 rounded-full bg-[#6366f1]" />
        SETTLED
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
      <span className="w-2 h-2 rounded-full bg-[var(--line)]" />
      IDLE
    </span>
  );
}

function BidRow({ bid, rank }: { bid: BidEntry; rank: number }) {
  const color = BRAND_COLORS[bid.brand_id] ?? "#9090a8";
  const statusStyle = {
    won:      "border-[#22c55e]/40 bg-[#22c55e]/5",
    lost:     "border-[var(--line)] opacity-50",
    refunded: "border-[#ef4444]/40 bg-[#ef4444]/5",
    bidding:  "border-[#6366f1]/40 bg-[#6366f1]/5",
  }[bid.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${statusStyle}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xs text-[var(--text-3)] w-4 text-right">{rank}</span>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <div>
          <p className="text-sm font-medium text-[var(--text)]">{bid.brand_label}</p>
          <p className="text-[10px] text-[var(--text-3)]">{bid.zone}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-[#22d3ee]">${bid.bid_usdc.toFixed(2)}</p>
        <p className={`text-[10px] font-medium ${
          bid.status === "won"      ? "text-[#22c55e]" :
          bid.status === "refunded" ? "text-[#ef4444]" :
          bid.status === "bidding"  ? "text-[#6366f1]" : "text-[var(--text-3)]"
        }`}>
          {bid.status}
        </p>
      </div>
    </motion.div>
  );
}

function ChatBubble({ msg }: { msg: NegotiationMessage }) {
  const isBrand = msg.role === "brand";
  const color = msg.brand_id ? (BRAND_COLORS[msg.brand_id] ?? "#9090a8") : "#22d3ee";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`flex flex-col gap-1 ${isBrand ? "items-start" : "items-end"}`}
    >
      <span className="text-[10px] text-[var(--text-3)] px-1">
        {isBrand ? msg.brand_label ?? "Brand" : "Streamer-agent"}
      </span>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isBrand
            ? "bg-[var(--card-2)] border border-[var(--line)] rounded-tl-sm"
            : "bg-[#6366f1]/15 border border-[#6366f1]/30 rounded-tr-sm"
        }`}
        style={isBrand ? { borderLeftColor: color, borderLeftWidth: 2 } : {}}
      >
        {msg.text}
      </div>
    </motion.div>
  );
}

function TxChip({ tx }: { tx: TxEntry }) {
  const styles = {
    lock:    { icon: "🔒", color: "text-[#f59e0b]", bg: "bg-[#f59e0b]/10 border-[#f59e0b]/20" },
    release: { icon: "✅", color: "text-[#22c55e]", bg: "bg-[#22c55e]/10 border-[#22c55e]/20" },
    refund:  { icon: "↩️", color: "text-[#ef4444]", bg: "bg-[#ef4444]/10 border-[#ef4444]/20" },
  }[tx.type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs shrink-0 ${styles.bg}`}
    >
      <span>{styles.icon}</span>
      <span className={`font-medium ${styles.color}`}>{tx.brand}</span>
      <span className="text-[var(--text)]">${tx.amount_usdc.toFixed(2)}</span>
      <span className="text-[var(--text-3)] font-mono">{`${tx.tx_hash.slice(0, 6)}…${tx.tx_hash.slice(-4)}`}</span>
    </motion.div>
  );
}

"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

export type PlacementStatus = "locked" | "released" | "refunded";

export interface RecentPlacement {
  placement_id: string;
  brand: string;
  ad_label: string;
  amount_usdc: number;
  zone: string;
  status: PlacementStatus;
  ts: number;
}

interface DockState {
  balanceUsdc: number | null;
  placements: RecentPlacement[];
  forceEventPending: boolean;
  fullBreakPending: boolean;
  lastAction: string | null;
}

type Action =
  | { type: "SET_BALANCE"; balance: number }
  | { type: "ADD_PLACEMENT"; placement: RecentPlacement }
  | { type: "UPDATE_STATUS"; placement_id: string; status: PlacementStatus }
  | { type: "SET_PENDING"; key: "forceEventPending" | "fullBreakPending"; value: boolean }
  | { type: "SET_LAST_ACTION"; msg: string };

function reducer(state: DockState, action: Action): DockState {
  switch (action.type) {
    case "SET_BALANCE":
      return { ...state, balanceUsdc: action.balance };
    case "ADD_PLACEMENT":
      if (state.placements.some((p) => p.placement_id === action.placement.placement_id)) return state;
      return { ...state, placements: [action.placement, ...state.placements].slice(0, 8) };
    case "UPDATE_STATUS":
      return {
        ...state,
        placements: state.placements.map((p) =>
          p.placement_id === action.placement_id ? { ...p, status: action.status } : p
        ),
      };
    case "SET_PENDING":
      return { ...state, [action.key]: action.value };
    case "SET_LAST_ACTION":
      return { ...state, lastAction: action.msg };
  }
}

const INITIAL: DockState = {
  balanceUsdc: null,
  placements: [],
  forceEventPending: false,
  fullBreakPending: false,
  lastAction: null,
};

export interface DockHooks {
  onBalance?: (handler: (usdc: number) => void) => () => void;
  onPlacement?: (handler: (p: RecentPlacement) => void) => () => void;
  onStatusChange?: (handler: (id: string, s: PlacementStatus) => void) => () => void;
}

export default function DockClient({ hooks }: { hooks?: DockHooks }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const lastActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    dispatch({ type: "SET_LAST_ACTION", msg });
    if (lastActionTimer.current) clearTimeout(lastActionTimer.current);
    lastActionTimer.current = setTimeout(() => dispatch({ type: "SET_LAST_ACTION", msg: "" }), 3000);
  }, []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (hooks?.onBalance)
      cleanups.push(hooks.onBalance((balance) => dispatch({ type: "SET_BALANCE", balance })));
    if (hooks?.onPlacement)
      cleanups.push(hooks.onPlacement((p) => dispatch({ type: "ADD_PLACEMENT", placement: p })));
    if (hooks?.onStatusChange)
      cleanups.push(hooks.onStatusChange((id, s) => dispatch({ type: "UPDATE_STATUS", placement_id: id, status: s })));
    return () => cleanups.forEach((f) => f());
  }, [hooks]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") triggerForceEvent();
      if (e.key === "b" || e.key === "B") triggerFullBreak();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.forceEventPending, state.fullBreakPending]);

  async function triggerForceEvent() {
    if (state.forceEventPending) return;
    dispatch({ type: "SET_PENDING", key: "forceEventPending", value: true });
    try {
      await fetch("/api/auctions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "epic_moment" }),
      });
      flash("⚡ Force event dispatched");
    } catch {
      flash("⚠️ Force event failed — check server");
    } finally {
      dispatch({ type: "SET_PENDING", key: "forceEventPending", value: false });
    }
  }

  async function triggerFullBreak() {
    if (state.fullBreakPending) return;
    dispatch({ type: "SET_PENDING", key: "fullBreakPending", value: true });
    try {
      await fetch("/api/auctions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fullscreen_takeover" }),
      });
      flash("🎬 Full break dispatched");
    } catch {
      flash("⚠️ Full break failed — check server");
    } finally {
      dispatch({ type: "SET_PENDING", key: "fullBreakPending", value: false });
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 min-w-[260px] max-w-[380px] font-sans text-sm select-none bg-[var(--page)] text-[var(--text)]">
      {/* Balance */}
      <section className="rounded-lg bg-[var(--card)] border border-[var(--line)] p-3">
        <p className="text-[var(--text-2)] text-xs uppercase tracking-wider mb-1">Creator balance</p>
        {state.balanceUsdc !== null ? (
          <p className="text-2xl font-bold text-[#22d3ee]">
            ${state.balanceUsdc.toFixed(2)}{" "}
            <span className="text-xs font-normal text-[#2775ca]">USDC</span>
          </p>
        ) : (
          <p className="text-[var(--text-3)] text-sm">Connecting…</p>
        )}
      </section>

      {/* Hotkeys */}
      <section className="flex flex-col gap-2">
        <button
          onClick={triggerForceEvent}
          disabled={state.forceEventPending}
          className="w-full rounded-lg py-2.5 px-3 font-semibold bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-between text-white"
        >
          <span>⚡ FORCE EVENT</span>
          <kbd className="text-[10px] bg-[#4f46e5] rounded px-1.5 py-0.5 opacity-70">F</kbd>
        </button>
        <button
          onClick={triggerFullBreak}
          disabled={state.fullBreakPending}
          className="w-full rounded-lg py-2.5 px-3 font-semibold bg-[#ef4444] hover:bg-[#dc2626] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-between text-white"
        >
          <span>🎬 FULL BREAK</span>
          <kbd className="text-[10px] bg-[#dc2626] rounded px-1.5 py-0.5 opacity-70">B</kbd>
        </button>
      </section>

      {/* Last action flash */}
      {state.lastAction && (
        <p className="text-center text-xs text-[#22c55e] animate-pulse">{state.lastAction}</p>
      )}

      {/* Recent placements */}
      <section className="rounded-lg bg-[var(--card)] border border-[var(--line)] p-3">
        <p className="text-[var(--text-2)] text-xs uppercase tracking-wider mb-2">Recent placements</p>
        {state.placements.length === 0 ? (
          <p className="text-[var(--text-3)] text-xs">No placements yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.placements.map((p) => (
              <PlacementRow key={p.placement_id} placement={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const STATUS_STYLES: Record<PlacementStatus, string> = {
  locked: "bg-[#f59e0b]/20 text-[#f59e0b]",
  released: "bg-[#22c55e]/20 text-[#22c55e]",
  refunded: "bg-[#ef4444]/20 text-[#ef4444]",
};

function PlacementRow({ placement: p }: { placement: RecentPlacement }) {
  return (
    <li className="flex items-start justify-between gap-2 text-xs">
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate text-[var(--text)]">
          {p.brand} · {p.ad_label}
        </span>
        <span className="text-[var(--text-3)]">
          {p.zone} · {formatAgo(p.ts)}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[#22d3ee] font-semibold">${p.amount_usdc.toFixed(2)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[p.status]}`}>
          {p.status}
        </span>
      </div>
    </li>
  );
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

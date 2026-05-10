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

// ─── Pending request (incoming, awaits creator approval) ────────────────────

export interface PendingRequest {
  id: string;
  brand_id: string;
  brand_display_name: string;
  message: string;
  bid_usdc: number;
  reason: string | null;
  brand_match: number | null;
  has_asset: boolean;
  ts: number;
}

interface DockState {
  balanceUsdc: number | null;
  placements: RecentPlacement[];
  pending: PendingRequest[];
  acting: Set<string>; // request ids currently being approved/denied (optimistic UI)
  forceEventPending: boolean;
  fullBreakPending: boolean;
  lastAction: string | null;
}

type Action =
  | { type: "SET_BALANCE"; balance: number }
  | { type: "ADD_PLACEMENT"; placement: RecentPlacement }
  | { type: "UPDATE_STATUS"; placement_id: string; status: PlacementStatus }
  | { type: "ADD_PENDING"; request: PendingRequest }
  | { type: "REMOVE_PENDING"; id: string }
  | { type: "SET_ACTING"; id: string; acting: boolean }
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
    case "ADD_PENDING":
      if (state.pending.some((p) => p.id === action.request.id)) return state;
      return { ...state, pending: [action.request, ...state.pending].slice(0, 12) };
    case "REMOVE_PENDING": {
      const acting = new Set(state.acting);
      acting.delete(action.id);
      return {
        ...state,
        pending: state.pending.filter((p) => p.id !== action.id),
        acting,
      };
    }
    case "SET_ACTING": {
      const acting = new Set(state.acting);
      if (action.acting) acting.add(action.id);
      else acting.delete(action.id);
      return { ...state, acting };
    }
    case "SET_PENDING":
      return { ...state, [action.key]: action.value };
    case "SET_LAST_ACTION":
      return { ...state, lastAction: action.msg };
  }
}

const INITIAL: DockState = {
  balanceUsdc: null,
  placements: [],
  pending: [],
  acting: new Set(),
  forceEventPending: false,
  fullBreakPending: false,
  lastAction: null,
};

export interface DockHooks {
  onBalance?: (handler: (usdc: number) => void) => () => void;
  onPlacement?: (handler: (p: RecentPlacement) => void) => () => void;
  onStatusChange?: (handler: (id: string, s: PlacementStatus) => void) => () => void;
}

const ZONE_LABELS: Record<string, string> = {
  lower_third: "Banner inferior",
  bottom_right_corner: "Logo esquina",
  fullscreen_takeover: "Pantalla completa",
};

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL;

/**
 * Mapea una row de placement_requests (server side) al shape que renderiza el
 * Dock. Defensa contra payloads parciales — usamos defaults razonables.
 */
function rowToPending(row: Record<string, unknown>): PendingRequest | null {
  if (typeof row.id !== "string") return null;
  const payload = (row.payload ?? null) as Record<string, unknown> | null;
  return {
    id: row.id,
    brand_id: String(row.brand_id ?? ""),
    brand_display_name: String(row.brand_display_name ?? row.brand_id ?? "(brand)"),
    message: String(row.message ?? ""),
    bid_usdc: Number(row.bid_usdc ?? 0),
    reason: (row.reason as string | null) ?? null,
    brand_match: row.brand_match != null ? Number(row.brand_match) : null,
    has_asset: !!(payload && payload.asset_url),
    ts: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
  };
}

export default function DockClient({
  hooks,
  creatorId,
  demo,
}: {
  hooks?: DockHooks;
  creatorId: string;
  demo: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const lastActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    dispatch({ type: "SET_LAST_ACTION", msg });
    if (lastActionTimer.current) clearTimeout(lastActionTimer.current);
    lastActionTimer.current = setTimeout(() => dispatch({ type: "SET_LAST_ACTION", msg: "" }), 3000);
  }, []);

  // Hooks externos (balance, placements históricos)
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

  // SSE: placement_requests del creator. En demo skipeamos.
  useEffect(() => {
    if (demo) return;
    if (!WORKER_URL) {
      console.warn(
        "[dock] NEXT_PUBLIC_WORKER_URL no seteado — no se reciben placement_requests en vivo",
      );
      return;
    }

    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const url = `${WORKER_URL}/requests/${encodeURIComponent(creatorId)}`;
      es = new EventSource(url);

      es.addEventListener("hello", () => {});

      // Nuevo request entrante (o catch-up al reconectar)
      es.addEventListener("request_new", (msgEvent) => {
        try {
          const row = JSON.parse((msgEvent as MessageEvent).data) as Record<string, unknown>;
          const pending = rowToPending(row);
          if (pending) dispatch({ type: "ADD_PENDING", request: pending });
        } catch {
          // ignore malformed
        }
      });

      // Cambio de status (approve/deny/expire) — sacamos de pending
      es.addEventListener("request_status", (msgEvent) => {
        try {
          const data = JSON.parse((msgEvent as MessageEvent).data) as { id: string; status: string };
          if (data.status !== "pending") {
            dispatch({ type: "REMOVE_PENDING", id: data.id });
          }
        } catch {
          // ignore
        }
      });

      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          if (!stopped) setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [creatorId, demo]);

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

  async function decide(id: string, action: "approve" | "deny") {
    if (state.acting.has(id)) return;
    dispatch({ type: "SET_ACTING", id, acting: true });
    try {
      const res = await fetch(`/api/placements/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 409 = ya decidido, 410 = expirado → sacar de pending igual
        if (res.status === 409 || res.status === 410) {
          dispatch({ type: "REMOVE_PENDING", id });
          flash(`⚠️ ${body.error ?? "ya resuelto"}`);
        } else {
          flash(`⚠️ ${action} falló: ${body.error ?? res.statusText}`);
          dispatch({ type: "SET_ACTING", id, acting: false });
        }
        return;
      }
      // El SSE request_status nos va a sacar de la lista, pero saquemos
      // optimistic para feedback inmediato.
      dispatch({ type: "REMOVE_PENDING", id });
      flash(action === "approve" ? "✅ Aprobado — ad en pantalla" : "✋ Rechazado");
    } catch (err) {
      flash(`⚠️ ${action} error de red`);
      dispatch({ type: "SET_ACTING", id, acting: false });
      console.error(err);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 min-w-[260px] max-w-[380px] font-sans text-sm select-none bg-[var(--page)] text-[var(--text)]">
      {/* Balance */}
      <section className="rounded-lg bg-[var(--card)] border border-[var(--line)] p-3">
        <p className="text-[var(--text-2)] text-xs uppercase tracking-wider mb-1">Saldo creador</p>
        {state.balanceUsdc !== null ? (
          <p className="text-2xl font-bold text-[#22d3ee]">
            ${state.balanceUsdc.toFixed(2)}{" "}
            <span className="text-xs font-normal text-[#2775ca]">USDC</span>
          </p>
        ) : (
          <p className="text-[var(--text-3)] text-sm">Conectando…</p>
        )}
      </section>

      {/* Pedidos pendientes — el corazón del nuevo flow */}
      <section className="rounded-lg bg-[var(--card)] border border-[var(--line)] p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[var(--text-2)] text-xs uppercase tracking-wider">
            Pedidos pendientes
          </p>
          {state.pending.length > 0 && (
            <span className="text-[10px] bg-[#f59e0b]/20 text-[#f59e0b] rounded px-1.5 py-0.5 font-semibold">
              {state.pending.length}
            </span>
          )}
        </div>
        {state.pending.length === 0 ? (
          <p className="text-[var(--text-3)] text-xs">
            {demo
              ? "(demo: sin SSE)"
              : WORKER_URL
              ? "Sin pedidos por ahora — esperando match"
              : "Worker no configurado (NEXT_PUBLIC_WORKER_URL)"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.pending.map((p) => (
              <PendingRow
                key={p.id}
                request={p}
                acting={state.acting.has(p.id)}
                onApprove={() => decide(p.id, "approve")}
                onDeny={() => decide(p.id, "deny")}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Hotkeys */}
      <section className="flex flex-col gap-2">
        <button
          onClick={triggerForceEvent}
          disabled={state.forceEventPending}
          className="w-full rounded-lg py-2.5 px-3 font-semibold bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-between text-white"
        >
          <div className="flex flex-col items-start text-left">
            <span>⚡ AD momento</span>
            <span className="text-[10px] opacity-60 font-normal">Dispara un aviso en el momento actual</span>
          </div>
          <kbd className="text-[10px] bg-[#4f46e5] rounded px-1.5 py-0.5 opacity-70 shrink-0">F</kbd>
        </button>
        <button
          onClick={triggerFullBreak}
          disabled={state.fullBreakPending}
          className="w-full rounded-lg py-2.5 px-3 font-semibold bg-[#ef4444] hover:bg-[#dc2626] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-between text-white"
        >
          <div className="flex flex-col items-start text-left">
            <span>🎬 Corte publicitario</span>
            <span className="text-[10px] opacity-60 font-normal">Pantalla completa para una marca</span>
          </div>
          <kbd className="text-[10px] bg-[#dc2626] rounded px-1.5 py-0.5 opacity-70 shrink-0">B</kbd>
        </button>
      </section>

      {/* Last action flash */}
      {state.lastAction && (
        <p className="text-center text-xs text-[#22c55e] animate-pulse">{state.lastAction}</p>
      )}

      {/* Recent placements */}
      <section className="rounded-lg bg-[var(--card)] border border-[var(--line)] p-3">
        <p className="text-[var(--text-2)] text-xs uppercase tracking-wider mb-2">Avisos recientes</p>
        {state.placements.length === 0 ? (
          <p className="text-[var(--text-3)] text-xs">Sin avisos todavía</p>
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
          {p.brand}
        </span>
        <span className="text-[var(--text-3)]">
          {ZONE_LABELS[p.zone] ?? p.zone} · {formatAgo(p.ts)}
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

function PendingRow({
  request,
  acting,
  onApprove,
  onDeny,
}: {
  request: PendingRequest;
  acting: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <li className="rounded-md border border-[var(--line)] bg-black/20 p-2 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-sm truncate text-[var(--text)]">
            {request.brand_display_name}
          </span>
          <span className="text-[10px] text-[var(--text-3)]">
            {request.has_asset ? "video/imagen" : "texto"} · {formatAgo(request.ts)}
          </span>
        </div>
        <span className="text-[#22d3ee] text-base font-bold shrink-0">
          ${request.bid_usdc.toFixed(2)}
        </span>
      </div>
      {request.reason && (
        <p className="text-[10px] text-[var(--text-3)] line-clamp-2 italic">
          “{request.reason}”
        </p>
      )}
      <div className="flex gap-1.5 mt-1">
        <button
          onClick={onApprove}
          disabled={acting}
          className="flex-1 rounded py-1.5 text-xs font-semibold bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-50 transition-colors text-white"
        >
          {acting ? "…" : "Aprobar"}
        </button>
        <button
          onClick={onDeny}
          disabled={acting}
          className="flex-1 rounded py-1.5 text-xs font-semibold bg-[#1f2937] hover:bg-[#374151] disabled:opacity-50 transition-colors text-[var(--text)]"
        >
          Rechazar
        </button>
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

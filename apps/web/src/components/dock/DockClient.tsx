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

/**
 * Pending offer del agent — esperando ✅/❌ del streamer.
 * `created_at_ms` se usa para calcular el countdown contra OFFER_TTL_MS.
 * `local_status` es el estado UI: `pending` → mientras esperamos input,
 * `accepting`/`rejecting` → mientras la API call está in-flight,
 * `done` → 800ms de stamp visual antes de remover de la lista.
 */
export interface PendingOffer {
  event_id: string;
  brand_id: string | null;
  brand_label: string;
  brand_color?: string;
  bid_usdc: number | null;
  message: string;
  zone: string;
  reason: string;
  created_at_ms: number;
  local_status: "pending" | "accepting" | "rejecting" | "accepted" | "rejected" | "expired";
}

interface DockState {
  balanceUsdc: number | null;
  placements: RecentPlacement[];
  pendingOffers: PendingOffer[];
  forceEventPending: boolean;
  fullBreakPending: boolean;
  lastAction: string | null;
}

type Action =
  | { type: "SET_BALANCE"; balance: number }
  | { type: "ADD_PLACEMENT"; placement: RecentPlacement }
  | { type: "UPDATE_STATUS"; placement_id: string; status: PlacementStatus }
  | { type: "ADD_OFFER"; offer: PendingOffer }
  | { type: "SET_OFFER_LOCAL_STATUS"; event_id: string; local_status: PendingOffer["local_status"] }
  | { type: "REMOVE_OFFER"; event_id: string }
  | { type: "EXPIRE_STALE_OFFERS"; now_ms: number; ttl_ms: number }
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
    case "ADD_OFFER":
      if (state.pendingOffers.some((o) => o.event_id === action.offer.event_id)) return state;
      return { ...state, pendingOffers: [action.offer, ...state.pendingOffers] };
    case "SET_OFFER_LOCAL_STATUS":
      return {
        ...state,
        pendingOffers: state.pendingOffers.map((o) =>
          o.event_id === action.event_id ? { ...o, local_status: action.local_status } : o
        ),
      };
    case "REMOVE_OFFER":
      return {
        ...state,
        pendingOffers: state.pendingOffers.filter((o) => o.event_id !== action.event_id),
      };
    case "EXPIRE_STALE_OFFERS":
      return {
        ...state,
        pendingOffers: state.pendingOffers.map((o) =>
          o.local_status === "pending" && action.now_ms - o.created_at_ms > action.ttl_ms
            ? { ...o, local_status: "expired" }
            : o
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
  pendingOffers: [],
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

// TTL de un offer pendiente (default 8s). Tiene que matchear MANAGER_OFFER_TTL_S
// del server (env var en apps/web). Si difieren, el server gana — el endpoint
// /accept devuelve 410 cuando el offer venció aunque la UI todavía mostrara
// timer. Configurable via NEXT_PUBLIC_MANAGER_OFFER_TTL_S si se quiere overrider.
const OFFER_TTL_MS =
  Number(process.env.NEXT_PUBLIC_MANAGER_OFFER_TTL_S ?? 8) * 1000;
// Cuánto se queda visible la card después de ✅/❌/⏱ antes de removerse.
const RESOLVED_LINGER_MS = 1200;

interface SSEOfferEvent {
  id: string;
  creator_id: string;
  created_at: string;
  kind?: string;
  status?: string;
  message?: string;
  brand_id?: string | null;
  brand_label?: string;
  brand_color?: string;
  bid_usdc?: number | null;
  zone_id?: string;
  reason?: string;
}

export default function DockClient({
  hooks,
  creatorId,
}: {
  hooks?: DockHooks;
  /** Si está, abre SSE a /api/creators/<creatorId>/stream para recibir offers
   *  pendientes en vivo. Sin esto el dock funciona solo con datos seed/hooks. */
  creatorId?: string;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const lastActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    dispatch({ type: "SET_LAST_ACTION", msg });
    if (lastActionTimer.current) clearTimeout(lastActionTimer.current);
    lastActionTimer.current = setTimeout(() => dispatch({ type: "SET_LAST_ACTION", msg: "" }), 3000);
  }, []);

  // Hooks props (existente — para tests + datos seed del server).
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

  // SSE para offers en vivo. Solo si nos pasaron creatorId.
  // Reusa /api/creators/<id>/stream — el handler emite TODOS los events pero
  // filtramos por kind="offer" status="pending" (offers para moderar) y
  // kind="brand" (ad ya aceptado, lo metemos al historial).
  useEffect(() => {
    if (!creatorId) return;
    let stopped = false;
    let es: EventSource | null = null;
    let lastEventId: string | null = null;

    const connect = () => {
      if (stopped) return;
      const url = lastEventId
        ? `/api/creators/${encodeURIComponent(creatorId)}/stream?since=${encodeURIComponent(lastEventId)}`
        : `/api/creators/${encodeURIComponent(creatorId)}/stream`;
      es = new EventSource(url);

      es.addEventListener("hello", () => {});

      es.addEventListener("render", (msgEvent) => {
        try {
          const data = JSON.parse((msgEvent as MessageEvent).data) as SSEOfferEvent;
          lastEventId = data.id;

          // Solo metemos al dock offers con brand_id real. Los offers con
          // brand_id=null son chunks procesados que no matchearon ninguna
          // brand (audio vacío, sin keyword, gates rechazaron, etc) — son
          // ruido del firehose, no algo para moderar.
          if (data.kind === "offer" && data.status === "pending" && data.brand_id) {
            dispatch({
              type: "ADD_OFFER",
              offer: {
                event_id: data.id,
                brand_id: data.brand_id,
                brand_label: data.brand_label ?? data.brand_id ?? "marca",
                brand_color: data.brand_color,
                bid_usdc: data.bid_usdc ?? null,
                message: data.message ?? "",
                zone: data.zone_id ?? "lower_third",
                reason: data.reason ?? "",
                created_at_ms: new Date(data.created_at).getTime(),
                local_status: "pending",
              },
            });
          } else if (data.kind === "brand") {
            // Ad accepted → historial. Si vino de un offer, removemos el
            // offer pendiente local (responded_at del server hace lo mismo
            // server-side, esto es solo limpieza UI inmediata).
            dispatch({
              type: "ADD_PLACEMENT",
              placement: {
                placement_id: data.id,
                brand: data.brand_label ?? data.brand_id ?? "marca",
                ad_label: data.message?.slice(0, 60) ?? "",
                amount_usdc: (data.bid_usdc ?? 0),
                zone: data.zone_id ?? "lower_third",
                status: "released",
                ts: new Date(data.created_at).getTime(),
              },
            });
          }
        } catch {
          // ignore malformed
        }
      });

      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [creatorId]);

  // Tick para expirar offers vencidos — corre cada 250ms mientras haya
  // offers pendientes. Marca local_status='expired' (el server decide la
  // verdad cuando llegue accept/reject, pero para UI lo mostramos al toque).
  useEffect(() => {
    if (state.pendingOffers.every((o) => o.local_status !== "pending")) return;
    const interval = setInterval(() => {
      dispatch({ type: "EXPIRE_STALE_OFFERS", now_ms: Date.now(), ttl_ms: OFFER_TTL_MS });
    }, 250);
    return () => clearInterval(interval);
  }, [state.pendingOffers]);

  // Auto-remove offers ya resueltos después de RESOLVED_LINGER_MS.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    state.pendingOffers.forEach((o) => {
      if (o.local_status === "accepted" || o.local_status === "rejected" || o.local_status === "expired") {
        timers.push(
          setTimeout(() => dispatch({ type: "REMOVE_OFFER", event_id: o.event_id }), RESOLVED_LINGER_MS),
        );
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [state.pendingOffers]);

  // Hotkeys (existente).
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

  async function acceptOffer(offer: PendingOffer) {
    if (!creatorId || offer.local_status !== "pending") return;
    dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "accepting" });
    try {
      const res = await fetch(
        `/api/creators/${encodeURIComponent(creatorId)}/offers/${encodeURIComponent(offer.event_id)}/accept`,
        { method: "POST" },
      );
      if (!res.ok) {
        // 410 = expirado, 409 = ya respondido, 4xx/5xx = error
        const status = res.status === 410 ? "expired" : "rejected";
        dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: status });
        flash(res.status === 410 ? "⏱ Offer expirado" : `⚠️ Accept falló (${res.status})`);
        return;
      }
      dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "accepted" });
      flash(`✅ ${offer.brand_label} aprobado`);
    } catch {
      dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "pending" });
      flash("⚠️ Network error");
    }
  }

  async function rejectOffer(offer: PendingOffer) {
    if (!creatorId || offer.local_status !== "pending") return;
    dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "rejecting" });
    try {
      const res = await fetch(
        `/api/creators/${encodeURIComponent(creatorId)}/offers/${encodeURIComponent(offer.event_id)}/reject`,
        { method: "POST" },
      );
      if (!res.ok) {
        dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "pending" });
        flash(`⚠️ Reject falló (${res.status})`);
        return;
      }
      dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "rejected" });
      flash(`❌ ${offer.brand_label} rechazado`);
    } catch {
      dispatch({ type: "SET_OFFER_LOCAL_STATUS", event_id: offer.event_id, local_status: "pending" });
      flash("⚠️ Network error");
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

      {/* Pending offers — la sección NUEVA, lo que el streamer modera en vivo */}
      {state.pendingOffers.length > 0 && (
        <section className="flex flex-col gap-2">
          {state.pendingOffers.map((o) => (
            <OfferCard
              key={o.event_id}
              offer={o}
              onAccept={() => acceptOffer(o)}
              onReject={() => rejectOffer(o)}
            />
          ))}
        </section>
      )}

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
        <span className="font-medium truncate text-[var(--text)]">{p.brand}</span>
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

/**
 * Card de un offer pendiente. Estados visuales:
 *   - pending: countdown bar visible, botones ✅/❌ activos
 *   - accepting/rejecting: botones disabled + spinner
 *   - accepted: stamp verde + lingering 1.2s antes de removerse
 *   - rejected: stamp rojo + lingering 1.2s
 *   - expired: stamp gris "expirado" + lingering 1.2s
 */
function OfferCard({
  offer,
  onAccept,
  onReject,
}: {
  offer: PendingOffer;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isPending = offer.local_status === "pending";
  const isInflight = offer.local_status === "accepting" || offer.local_status === "rejecting";
  const isResolved =
    offer.local_status === "accepted" ||
    offer.local_status === "rejected" ||
    offer.local_status === "expired";

  // Countdown bar — recalc en cada render del padre (cada 250ms via interval)
  const ageMs = Date.now() - offer.created_at_ms;
  const remainingMs = Math.max(0, OFFER_TTL_MS - ageMs);
  const remainingPct = isPending ? Math.max(0, Math.min(100, (remainingMs / OFFER_TTL_MS) * 100)) : 0;

  const bidLabel =
    offer.bid_usdc != null ? `$${offer.bid_usdc.toFixed(2)} USDC` : "—";

  const stampLabel =
    offer.local_status === "accepted"
      ? "✅ ACEPTADO"
      : offer.local_status === "rejected"
        ? "❌ RECHAZADO"
        : offer.local_status === "expired"
          ? "⏱ EXPIRADO"
          : null;

  const stampColor =
    offer.local_status === "accepted"
      ? "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30"
      : offer.local_status === "rejected"
        ? "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30"
        : "text-[var(--text-3)] bg-[var(--text-3)]/10 border-[var(--text-3)]/30";

  return (
    <article
      className={
        "rounded-lg border p-3 transition-all " +
        (isResolved
          ? "opacity-60 bg-[var(--card)] border-[var(--line)]"
          : "bg-[var(--card)] border-[#6366f1]/40 ring-1 ring-[#6366f1]/20")
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p
            className="font-semibold truncate"
            style={offer.brand_color ? { color: offer.brand_color } : undefined}
          >
            {offer.brand_label}
          </p>
          <p className="text-[var(--text-3)] text-xs">
            {ZONE_LABELS[offer.zone] ?? offer.zone}
          </p>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-[#22d3ee] font-bold text-base">{bidLabel}</span>
          {isPending && (
            <span className="text-[10px] text-[var(--text-3)]">{Math.ceil(remainingMs / 1000)}s</span>
          )}
        </div>
      </div>

      {offer.message && (
        <p className="text-xs italic text-[var(--text-2)] mb-2 leading-snug">
          “{offer.message}”
        </p>
      )}

      {isPending && (
        <>
          <div className="h-1 w-full bg-[var(--line)] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-[#6366f1] transition-all duration-200"
              style={{ width: `${remainingPct}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onReject}
              disabled={isInflight}
              className="rounded-md py-2 font-semibold text-xs bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 disabled:opacity-40 transition-colors"
            >
              ❌ Rechazar
            </button>
            <button
              onClick={onAccept}
              disabled={isInflight}
              className="rounded-md py-2 font-semibold text-xs bg-[#22c55e] text-white hover:bg-[#16a34a] disabled:opacity-40 transition-colors"
            >
              ✅ Aprobar
            </button>
          </div>
        </>
      )}

      {stampLabel && (
        <div
          className={`mt-1 rounded-md border py-1.5 text-center font-semibold text-xs ${stampColor}`}
        >
          {stampLabel}
        </div>
      )}
    </article>
  );
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

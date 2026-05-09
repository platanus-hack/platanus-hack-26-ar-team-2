"use client";

import { useReducer, useRef } from "react";
import { useToast } from "@/components/Toast";

export type ZoneId = "lower_third" | "bottom_right_corner" | "fullscreen_takeover";

export interface Zone {
  zone_id: ZoneId;
  label: string;
  description: string;
  dimensions: string;
  manual_only: boolean;
  floor_usdc: number;
  max_duration_s: number;
}

export interface InventoryData { zones: Zone[] }

const ZONE_META: Record<ZoneId, Pick<Zone, "label" | "description" | "dimensions" | "manual_only">> = {
  lower_third: {
    label: "Lower Third",
    description: "Banner across the bottom — used in automatic context-match auctions.",
    dimensions: "1920 × 180 px · 5–8 s",
    manual_only: false,
  },
  bottom_right_corner: {
    label: "Corner",
    description: "Persistent logo in the bottom-right — low friction, long exposure.",
    dimensions: "240 × 240 px · up to 60 s",
    manual_only: false,
  },
  fullscreen_takeover: {
    label: "Full Break",
    description: "Full-screen takeover triggered manually via FULL BREAK hotkey.",
    dimensions: "1920 × 1080 px · 30 s",
    manual_only: true,
  },
};

const DEFAULT_ZONES: Zone[] = [
  { zone_id: "lower_third", ...ZONE_META.lower_third, floor_usdc: 0.50, max_duration_s: 8 },
  { zone_id: "bottom_right_corner", ...ZONE_META.bottom_right_corner, floor_usdc: 0.25, max_duration_s: 60 },
  { zone_id: "fullscreen_takeover", ...ZONE_META.fullscreen_takeover, floor_usdc: 3.00, max_duration_s: 30 },
];

const ZONE_ICONS: Record<ZoneId, string> = {
  lower_third: "▬",
  bottom_right_corner: "◼",
  fullscreen_takeover: "⬛",
};

interface State { zones: Zone[]; dirty: boolean; saving: boolean; saved: boolean; saveError: boolean }
type Action =
  | { type: "SET_FLOOR"; zone_id: ZoneId; value: number }
  | { type: "SET_DURATION"; zone_id: ZoneId; value: number }
  | { type: "SET_SAVING" } | { type: "SET_SAVED" } | { type: "SET_ERROR" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_FLOOR":
      return { ...state, dirty: true, saved: false, saveError: false, zones: state.zones.map((z) => z.zone_id === action.zone_id ? { ...z, floor_usdc: action.value } : z) };
    case "SET_DURATION":
      return { ...state, dirty: true, saved: false, saveError: false, zones: state.zones.map((z) => z.zone_id === action.zone_id ? { ...z, max_duration_s: action.value } : z) };
    case "SET_SAVING": return { ...state, saving: true, saveError: false };
    case "SET_SAVED": return { ...state, saving: false, saved: true, dirty: false };
    case "SET_ERROR": return { ...state, saving: false, saveError: true };
  }
}

export default function InventoryClient({ initial }: { initial?: InventoryData }) {
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, { zones: initial?.zones ?? DEFAULT_ZONES, dirty: false, saving: false, saved: true, saveError: false });

  async function save() {
    dispatch({ type: "SET_SAVING" });
    try {
      const res = await fetch("/api/settings/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zones: state.zones }) });
      dispatch({ type: "SET_SAVED" });
      toast.show({ kind: res.ok ? "ok" : "err", message: res.ok ? "Guardado" : "Error al guardar" });
    } catch {
      dispatch({ type: "SET_ERROR" });
      toast.show({ kind: "err", message: "Error al guardar" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-[var(--text-3)]">
        Floor prices are visible to brand-agents. They cannot win below your floor.
      </p>

      <div className="flex flex-col gap-3">
        {state.zones.map((zone) => (
          <ZoneCard key={zone.zone_id} zone={zone} dispatch={dispatch} />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state.saving || !state.dirty}
          className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
        >
          {state.saving ? "Saving…" : "Save changes"}
        </button>
        {state.saved && !state.dirty && <span className="text-xs text-[#22c55e]">✓ Saved</span>}
        {state.saveError && <span className="text-xs text-[#ef4444]">Save failed — check server</span>}
      </div>
    </div>
  );
}

function ZoneCard({ zone, dispatch }: { zone: Zone; dispatch: React.Dispatch<Action> }) {
  const floorRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line)]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-3)] text-xs font-mono">{ZONE_ICONS[zone.zone_id]}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">{zone.label}</span>
              {zone.manual_only && (
                <span className="text-[10px] bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/25 rounded px-1.5 py-0.5 font-medium">
                  manual only
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-3)] mt-0.5">{zone.description}</p>
          </div>
        </div>
        <span className="text-[10px] font-mono text-[var(--text-4)] shrink-0 ml-4">{zone.dimensions}</span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--card-3)]">
        <label className="bg-[var(--card)] px-5 py-3 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium">Floor price</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-3)] text-sm">$</span>
            <input
              ref={floorRef}
              type="number"
              min={0}
              step={0.1}
              value={zone.floor_usdc}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0) dispatch({ type: "SET_FLOOR", zone_id: zone.zone_id, value: v });
              }}
              className="w-20 bg-transparent text-base font-semibold text-[#22d3ee] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-[var(--text-4)]">USDC</span>
          </div>
        </label>

        <label className="bg-[var(--card)] px-5 py-3 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium">Max duration</span>
          <div className="flex items-center gap-1.5">
            <input
              ref={durRef}
              type="number"
              min={1}
              max={zone.zone_id === "fullscreen_takeover" ? 30 : 120}
              step={1}
              value={zone.max_duration_s}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1) dispatch({ type: "SET_DURATION", zone_id: zone.zone_id, value: v });
              }}
              className="w-16 bg-transparent text-base font-semibold text-[var(--text)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-[var(--text-4)]">sec</span>
          </div>
        </label>
      </div>
    </div>
  );
}

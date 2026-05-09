"use client";

import { useReducer, useRef } from "react";

// ------------------------------------------------------------------
// Types — mirrors 0002_inventory.sql (C-03)
// ------------------------------------------------------------------

export type ZoneId = "lower_third" | "bottom_right_corner" | "fullscreen_takeover";

export interface Zone {
  zone_id: ZoneId;
  label: string;
  description: string;
  dimensions: string;
  manual_only: boolean;
  floor_usdc: number;       // minimum bid in USDC
  max_duration_s: number;   // seconds
}

export interface InventoryData {
  zones: Zone[];
}

// ------------------------------------------------------------------
// Defaults — pre-seeded with design-spec values from §5 DESIGN.md
// ------------------------------------------------------------------

const ZONE_META: Record<ZoneId, Pick<Zone, "label" | "description" | "dimensions" | "manual_only">> = {
  lower_third: {
    label: "Lower Third",
    description: "Banda inferior del stream — aparece en momentos épicos automáticos.",
    dimensions: "1920 × 180 px",
    manual_only: false,
  },
  bottom_right_corner: {
    label: "Corner",
    description: "Logo esquina inferior derecha — subasta automática de larga duración.",
    dimensions: "240 × 240 px",
    manual_only: false,
  },
  fullscreen_takeover: {
    label: "Full Break",
    description: "Pantalla completa — solo manual vía hotkey FULL BREAK.",
    dimensions: "1920 × 1080 px",
    manual_only: true,
  },
};

const DEFAULT_ZONES: Zone[] = [
  { zone_id: "lower_third", ...ZONE_META.lower_third, floor_usdc: 0.5, max_duration_s: 8 },
  { zone_id: "bottom_right_corner", ...ZONE_META.bottom_right_corner, floor_usdc: 0.25, max_duration_s: 60 },
  { zone_id: "fullscreen_takeover", ...ZONE_META.fullscreen_takeover, floor_usdc: 3.0, max_duration_s: 30 },
];

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

interface State {
  zones: Zone[];
  dirty: boolean;
  saving: boolean;
  saved: boolean;
}

type Action =
  | { type: "SET_FLOOR"; zone_id: ZoneId; value: number }
  | { type: "SET_DURATION"; zone_id: ZoneId; value: number }
  | { type: "SET_SAVING" }
  | { type: "SET_SAVED" }
  | { type: "SAVE_FAILED" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_FLOOR":
      return {
        ...state,
        dirty: true,
        saved: false,
        zones: state.zones.map((z) =>
          z.zone_id === action.zone_id ? { ...z, floor_usdc: action.value } : z
        ),
      };
    case "SET_DURATION":
      return {
        ...state,
        dirty: true,
        saved: false,
        zones: state.zones.map((z) =>
          z.zone_id === action.zone_id ? { ...z, max_duration_s: action.value } : z
        ),
      };
    case "SET_SAVING":
      return { ...state, saving: true };
    case "SET_SAVED":
      return { ...state, saving: false, saved: true, dirty: false };
    case "SAVE_FAILED":
      return { ...state, saving: false };
  }
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

interface Props {
  initial?: InventoryData;
}

export default function InventoryClient({ initial }: Props) {
  const [state, dispatch] = useReducer(reducer, {
    zones: initial?.zones ?? DEFAULT_ZONES,
    dirty: false,
    saving: false,
    saved: true,
  });

  async function save() {
    dispatch({ type: "SET_SAVING" });
    try {
      await fetch("/api/settings/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones: state.zones }),
      });
      dispatch({ type: "SET_SAVED" });
    } catch {
      dispatch({ type: "SAVE_FAILED" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-[#55556a]">
        Set the minimum bid and max duration for each ad zone. Brand-agents see these floors and
        cannot win below them.
      </p>

      <div className="flex flex-col gap-4">
        {state.zones.map((zone) => (
          <ZoneRow key={zone.zone_id} zone={zone} dispatch={dispatch} />
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-[#2a2a38]">
        <button
          onClick={save}
          disabled={state.saving || !state.dirty}
          className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
        >
          {state.saving ? "Saving…" : "Save changes"}
        </button>
        {state.saved && !state.dirty && (
          <span className="text-xs text-[#22c55e]">Saved</span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Zone row
// ------------------------------------------------------------------

function ZoneRow({
  zone,
  dispatch,
}: {
  zone: Zone;
  dispatch: React.Dispatch<Action>;
}) {
  const floorRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg bg-[#111118] border border-[#2a2a38] p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#f0f0f5]">{zone.label}</span>
            {zone.manual_only && (
              <span className="text-[10px] bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 rounded px-1.5 py-0.5">
                manual only
              </span>
            )}
          </div>
          <p className="text-xs text-[#55556a] mt-0.5">{zone.description}</p>
          <p className="text-[10px] text-[#2a2a38] mt-0.5 font-mono">{zone.dimensions}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Floor price */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#9090a8]">Floor price</span>
          <div className="flex items-center gap-1.5 rounded-lg bg-[#0a0a0f] border border-[#2a2a38] px-3 py-2 focus-within:border-[#6366f1] transition-colors">
            <span className="text-[#55556a] text-sm">$</span>
            <input
              ref={floorRef}
              type="number"
              min={0}
              step={0.1}
              value={zone.floor_usdc}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0) {
                  dispatch({ type: "SET_FLOOR", zone_id: zone.zone_id, value: v });
                }
              }}
              className="flex-1 bg-transparent text-sm text-[#f0f0f5] focus:outline-none min-w-0"
            />
            <span className="text-[#55556a] text-xs">USDC</span>
          </div>
        </label>

        {/* Max duration */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#9090a8]">Max duration</span>
          <div className="flex items-center gap-1.5 rounded-lg bg-[#0a0a0f] border border-[#2a2a38] px-3 py-2 focus-within:border-[#6366f1] transition-colors">
            <input
              ref={durRef}
              type="number"
              min={1}
              max={zone.zone_id === "fullscreen_takeover" ? 30 : 120}
              step={1}
              value={zone.max_duration_s}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1) {
                  dispatch({ type: "SET_DURATION", zone_id: zone.zone_id, value: v });
                }
              }}
              className="flex-1 bg-transparent text-sm text-[#f0f0f5] focus:outline-none min-w-0"
            />
            <span className="text-[#55556a] text-xs">sec</span>
          </div>
        </label>
      </div>
    </div>
  );
}

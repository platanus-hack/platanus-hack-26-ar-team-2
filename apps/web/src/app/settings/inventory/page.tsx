import InventoryClient, { type InventoryData, type Zone } from "@/components/settings/InventoryClient";
import { getDemoCreatorId, getInventory } from "@/lib/db";
import type { InventoryRow } from "@/lib/db";

const ZONE_META: Record<string, Pick<Zone, "label" | "description" | "dimensions">> = {
  lower_third:         { label: "Lower Third",  description: "Banner across the bottom — used in automatic context-match auctions.", dimensions: "1920 × 180 px · 5–8 s" },
  bottom_right_corner: { label: "Corner",        description: "Persistent logo in the bottom-right — low friction, long exposure.",  dimensions: "240 × 240 px · up to 60 s" },
  fullscreen_takeover: { label: "Full Break",    description: "Full-screen takeover triggered manually via FULL BREAK hotkey.",      dimensions: "1920 × 1080 px · 30 s" },
};

function rowToZone(r: InventoryRow): Zone {
  const meta = ZONE_META[r.zone] ?? { label: r.zone, description: "", dimensions: "" };
  return {
    zone_id: r.zone,
    ...meta,
    manual_only: r.manual_only,
    floor_usdc: r.floor_usdc_cents / 100,
    max_duration_s: r.max_duration_ms / 1000,
  };
}

export default async function InventoryPage() {
  let initial: InventoryData | undefined;
  try {
    const creatorId = await getDemoCreatorId();
    const rows = await getInventory(creatorId);
    initial = { zones: rows.map(rowToZone) };
  } catch {
    // DB unavailable — InventoryClient falls back to its hardcoded defaults
  }
  return <InventoryClient initial={initial} />;
}

import { NextResponse } from "next/server";
import { getDemoCreatorId, getInventory, upsertInventory } from "@/lib/db";
import { requireInternalBearer } from "@/lib/route-security";
import type { InventoryRow } from "@/lib/db";
import type { Zone } from "@/components/settings/InventoryClient";

// Zone UI ↔ DB conversion helpers
function zoneToRow(z: Zone): InventoryRow {
  return {
    zone: z.zone_id,
    floor_usdc_cents: Math.round(z.floor_usdc * 100),
    max_duration_ms: z.max_duration_s * 1000,
    manual_only: z.manual_only,
    enabled: true,
  };
}

export async function GET() {
  try {
    const creatorId = await getDemoCreatorId();
    const rows = await getInventory(creatorId);
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = requireInternalBearer(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as { zones: Zone[] };
    const creatorId = await getDemoCreatorId();
    await upsertInventory(creatorId, body.zones.map(zoneToRow));
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "database error" }, { status: 500 });
  }
}

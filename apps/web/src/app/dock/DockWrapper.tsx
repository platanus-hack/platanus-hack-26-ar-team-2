"use client";

import { useMemo } from "react";
import type { PlacementRow } from "@/lib/db";
import DockClient, { type DockHooks, type RecentPlacement } from "@/components/dock/DockClient";

const DEMO_PLACEMENTS: RecentPlacement[] = [
  {
    placement_id: "demo-1",
    brand: "Adidas",
    ad_label: "epic_goal_lower",
    amount_usdc: 1.80,
    zone: "lower_third",
    status: "released",
    ts: Date.now() - 120_000,
  },
  {
    placement_id: "demo-2",
    brand: "Coca-Cola",
    ad_label: "premium_takeover",
    amount_usdc: 5.20,
    zone: "fullscreen_takeover",
    status: "released",
    ts: Date.now() - 45_000,
  },
  {
    placement_id: "demo-3",
    brand: "Mercado Pago",
    ad_label: "persistent_logo",
    amount_usdc: 0.20,
    zone: "bottom_right_corner",
    status: "locked",
    ts: Date.now() - 8_000,
  },
];

function makeDemoHooks(): DockHooks {
  return {
    onBalance: (handler) => {
      handler(23.45);
      return () => {};
    },
    onPlacement: (handler) => {
      DEMO_PLACEMENTS.forEach((p) => handler(p));
      return () => {};
    },
  };
}

function makeLiveHooks(rows: PlacementRow[]): DockHooks {
  return {
    onPlacement: (handler) => {
      rows.forEach((r) =>
        handler({
          placement_id: r.id,
          brand: r.brand_display_name,
          ad_label: r.ad_variant_name,
          amount_usdc: r.amount_usdc_cents / 100,
          zone: r.zone,
          status: r.status as RecentPlacement["status"],
          ts: new Date(r.created_at).getTime(),
        }),
      );
      return () => {};
    },
  };
}

export default function DockWrapper({
  demo,
  recentPlacements,
}: {
  demo: boolean;
  recentPlacements: PlacementRow[];
}) {
  const hooks = useMemo(
    () => (demo ? makeDemoHooks() : makeLiveHooks(recentPlacements)),
    [demo, recentPlacements],
  );

  return (
    <main className="p-0">
      <DockClient hooks={hooks} />
    </main>
  );
}

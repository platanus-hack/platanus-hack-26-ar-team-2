"use client";

import { useMemo } from "react";
import type { PlacementRow } from "@/lib/db";
import DockClient, { type DockHooks, type RecentPlacement } from "@/components/dock/DockClient";
<<<<<<< Updated upstream
=======
import { useRef } from "react";
import type { PlacementRow } from "@/lib/db";
>>>>>>> Stashed changes

const DEMO_PLACEMENTS: RecentPlacement[] = [
  {
    placement_id: "demo-1",
    brand: "GamerGear AR",
    ad_label: "banner_epic",
    amount_usdc: 2.40,
    zone: "lower_third",
    status: "released",
    ts: Date.now() - 120_000,
  },
  {
    placement_id: "demo-2",
    brand: "FitMax Argentina",
    ad_label: "pantalla_completa",
    amount_usdc: 4.80,
    zone: "fullscreen_takeover",
    status: "released",
    ts: Date.now() - 45_000,
  },
  {
    placement_id: "demo-3",
    brand: "PixelBros Studio",
    ad_label: "logo_esquina",
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
<<<<<<< Updated upstream
  const hooks = useMemo(
    () => (demo ? makeDemoHooks() : makeLiveHooks(recentPlacements)),
    [demo, recentPlacements],
  );

=======
  const hooksRef = useRef<DockHooks | undefined>(
    demo ? makeDemoHooks() : makeLiveHooks(recentPlacements),
  );
>>>>>>> Stashed changes
  return (
    <main className="p-0">
      <DockClient hooks={hooks} />
    </main>
  );
}

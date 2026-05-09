"use client";

import DockClient, { type DockHooks, type RecentPlacement } from "@/components/dock/DockClient";
import { useRef } from "react";

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

export default function DockWrapper({ demo }: { demo: boolean }) {
  const hooksRef = useRef<DockHooks | undefined>(demo ? makeDemoHooks() : undefined);
  return (
    <main className="p-0">
      <DockClient hooks={hooksRef.current} />
    </main>
  );
}

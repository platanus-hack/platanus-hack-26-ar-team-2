import DockClient, { type RecentPlacement } from "@/components/dock/DockClient";

interface Props {
  searchParams: Promise<{ demo?: string }>;
}

const DEMO_HOOKS = {
  onBalance: (handler: (usdc: number) => void) => {
    handler(23.45);
    return () => {};
  },
  onPlacement: (handler: (p: RecentPlacement) => void) => {
    handler({
      placement_id: "demo-1",
      brand: "Adidas",
      ad_label: "epic_goal_lower",
      amount_usdc: 1.80,
      zone: "lower_third",
      status: "released",
      ts: Date.now() - 120_000,
    });
    handler({
      placement_id: "demo-2",
      brand: "Coca-Cola",
      ad_label: "premium_takeover",
      amount_usdc: 5.20,
      zone: "fullscreen_takeover",
      status: "released",
      ts: Date.now() - 45_000,
    });
    handler({
      placement_id: "demo-3",
      brand: "Mercado Pago",
      ad_label: "persistent_logo",
      amount_usdc: 0.20,
      zone: "bottom_right_corner",
      status: "locked",
      ts: Date.now() - 8_000,
    });
    return () => {};
  },
} as const;

export default async function DockPage({ searchParams }: Props) {
  const { demo } = await searchParams;
  return (
    <main className="p-0">
      <DockClient hooks={demo === "1" ? DEMO_HOOKS : undefined} />
    </main>
  );
}

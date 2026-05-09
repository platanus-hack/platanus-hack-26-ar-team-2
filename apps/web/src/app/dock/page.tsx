import DockWrapper from "./DockWrapper";
import { getRecentPlacements } from "@/lib/db";
import type { PlacementRow } from "@/lib/db";

interface Props {
  searchParams: Promise<{ demo?: string }>;
}

export default async function DockPage({ searchParams }: Props) {
  const { demo } = await searchParams;
  const isDemo = demo === "1";

  let recentPlacements: PlacementRow[] = [];
  if (!isDemo) {
    try {
      recentPlacements = await getRecentPlacements(8);
    } catch {
      // DB unavailable — Dock shows empty state
    }
  }

  return <DockWrapper demo={isDemo} recentPlacements={recentPlacements} />;
}

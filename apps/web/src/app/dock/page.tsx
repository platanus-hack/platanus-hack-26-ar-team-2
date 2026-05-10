import DockWrapper from "./DockWrapper";
import { getRecentPlacements } from "@/lib/db";
import type { PlacementRow } from "@/lib/db";

interface Props {
  searchParams: Promise<{ demo?: string; creator_id?: string }>;
}

// Open me at /dock?creator_id=streamer-team para moderar offers en vivo de
// ese stream. Sin creator_id el dock queda en modo display-only del historial.
export default async function DockPage({ searchParams }: Props) {
  const { demo, creator_id } = await searchParams;
  const isDemo = demo === "1";

  let recentPlacements: PlacementRow[] = [];
  if (!isDemo) {
    try {
      recentPlacements = await getRecentPlacements(8);
    } catch {
      // DB unavailable — Dock shows empty state
    }
  }

  return (
    <DockWrapper
      demo={isDemo}
      recentPlacements={recentPlacements}
      creatorId={creator_id}
    />
  );
}

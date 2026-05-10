import DockWrapper from "./DockWrapper";
import { getRecentPlacements } from "@/lib/db";
import type { PlacementRow } from "@/lib/db";

interface Props {
  searchParams: Promise<{ demo?: string; creator?: string }>;
}

const DEFAULT_CREATOR = "demo";

export default async function DockPage({ searchParams }: Props) {
  const { demo, creator } = await searchParams;
  const isDemo = demo === "1";
  // creator_id es el streamKey con el que el worker matchea placement_requests
  // (mismo valor que /o/<creator_id> usa para el overlay de OBS).
  const creatorId = creator?.trim() || DEFAULT_CREATOR;

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
      creatorId={creatorId}
    />
  );
}

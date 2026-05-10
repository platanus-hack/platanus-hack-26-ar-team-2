/**
 * Per-creator overlay iframe.
 *
 * Embed in any creator's stream page (or load directly in OBS Browser
 * Source) to receive ad-render events for that specific creator.
 *
 * Subscribes to /api/creators/[creator_id]/stream via EventSource and
 * displays incoming `render` events (currently just `message` text;
 * later `asset_url` videos/images from S3).
 *
 * Iframe-friendly: transparent background, no auth required.
 */

import OverlayClient from "@/components/overlay-creator/OverlayClient";

export default async function CreatorOverlayPage({
  params,
}: {
  params: Promise<{ creator_id: string }>;
}) {
  const { creator_id } = await params;
  return (
    <main className="w-screen h-screen overflow-hidden" style={{ background: "transparent" }}>
      <OverlayClient creator_id={creator_id} />
    </main>
  );
}

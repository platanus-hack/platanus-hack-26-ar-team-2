import PlacementOverlay from "@/components/overlay/PlacementOverlay";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OverlayPage({ params }: Props) {
  const { id } = await params;
  return (
    <main className="w-screen h-screen overflow-hidden bg-transparent">
      {/* onPlacement wired by D-02 (PlacementRenderer) once Supabase Realtime is ready */}
      <PlacementOverlay streamId={id} />
    </main>
  );
}

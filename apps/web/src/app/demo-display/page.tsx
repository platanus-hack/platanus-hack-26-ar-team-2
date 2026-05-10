import DemoDisplayClient from "./DemoDisplayClient";

interface Props {
  searchParams: Promise<{ demo?: string; creator_id?: string }>;
}

// /demo-display?creator_id=streamer-team conecta al SSE del creator y
// alimenta el TxFeed con los pagos USDC del settlement worker. Sin
// creator_id la pantalla queda en modo "vacío" sin abrir SSE.
export default async function DemoDisplayPage({ searchParams }: Props) {
  const { demo, creator_id } = await searchParams;
  return <DemoDisplayClient demo={demo === "1"} creatorId={creator_id} />;
}

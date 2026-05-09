import DockWrapper from "./DockWrapper";

interface Props {
  searchParams: Promise<{ demo?: string }>;
}

export default async function DockPage({ searchParams }: Props) {
  const { demo } = await searchParams;
  return <DockWrapper demo={demo === "1"} />;
}

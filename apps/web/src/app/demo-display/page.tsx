import DemoDisplayClient from "./DemoDisplayClient";

interface Props {
  searchParams: Promise<{ demo?: string }>;
}

export default async function DemoDisplayPage({ searchParams }: Props) {
  const { demo } = await searchParams;
  return <DemoDisplayClient demo={demo === "1"} />;
}

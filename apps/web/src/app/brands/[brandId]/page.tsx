import BrandConsoleClient from "@/components/brands/BrandConsoleClient";

interface Props {
  params: Promise<{ brandId: string }>;
}

export default async function BrandConsolePage({ params }: Props) {
  const { brandId } = await params;
  return <BrandConsoleClient brandId={brandId} />;
}

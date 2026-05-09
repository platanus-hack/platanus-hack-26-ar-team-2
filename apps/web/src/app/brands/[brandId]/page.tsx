import BrandConsoleClient, { type BrandInitial } from "@/components/brands/BrandConsoleClient";
import { getBrandAccountId, getBrandAds, getBrandWalletAddress } from "@/lib/db";

interface Props {
  params: Promise<{ brandId: string }>;
}

export default async function BrandConsolePage({ params }: Props) {
  const { brandId } = await params;

  let initial: BrandInitial | undefined;
  try {
    const brandAccountId = await getBrandAccountId(brandId);
    if (brandAccountId) {
      const [ads, wallet_address] = await Promise.all([
        getBrandAds(brandAccountId),
        getBrandWalletAddress(brandAccountId),
      ]);
      initial = { ads, wallet_address };
    }
  } catch {
    // DB unavailable — BrandConsoleClient falls back to static defaults
  }

  return <BrandConsoleClient brandId={brandId} initial={initial} />;
}

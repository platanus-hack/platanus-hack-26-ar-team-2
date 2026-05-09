import BrandConsoleClient, { type BrandInitial } from "@/components/brands/BrandConsoleClient";
import { getBrandAccountId, getBrandMandateData, getBrandStats, getBrandAds, getBrandWalletAddress } from "@/lib/db";

interface Props {
  params: Promise<{ brandId: string }>;
}

export default async function BrandConsolePage({ params }: Props) {
  const { brandId } = await params;

  let initial: BrandInitial | undefined;
  try {
    const brandAccountId = await getBrandAccountId(brandId);
    if (brandAccountId) {
      const [mandate, stats, ads, wallet_address] = await Promise.all([
        getBrandMandateData(brandAccountId),
        getBrandStats(brandAccountId),
        getBrandAds(brandAccountId),
        getBrandWalletAddress(brandAccountId),
      ]);
      initial = { mandate, stats, ads, wallet_address };
    }
  } catch {
    // DB unavailable — BrandConsoleClient falls back to lib/brands.ts defaults
  }

  return <BrandConsoleClient brandId={brandId} initial={initial} />;
}

<<<<<<< Updated upstream
import { redirect } from "next/navigation";
=======
import BrandConsoleClient, { type BrandInitial } from "@/components/brands/BrandConsoleClient";
import { getBrandAccountId, getBrandMandateData, getBrandStats, getBrandAds } from "@/lib/db";
>>>>>>> Stashed changes

interface Props {
  params: Promise<{ brandId: string }>;
}

export default async function BrandConsoleRedirect({ params }: Props) {
  const { brandId } = await params;
<<<<<<< Updated upstream
  redirect(`/brand/${brandId}`);
=======

  let initial: BrandInitial | undefined;
  try {
    const brandAccountId = await getBrandAccountId(brandId);
    if (brandAccountId) {
      const [mandate, stats, ads] = await Promise.all([
        getBrandMandateData(brandAccountId),
        getBrandStats(brandAccountId),
        getBrandAds(brandAccountId),
      ]);
      initial = { mandate, stats, ads };
    }
  } catch {
    // DB unavailable — BrandConsoleClient falls back to BRAND_REGISTRY defaults
  }

  return <BrandConsoleClient brandId={brandId} initial={initial} />;
>>>>>>> Stashed changes
}

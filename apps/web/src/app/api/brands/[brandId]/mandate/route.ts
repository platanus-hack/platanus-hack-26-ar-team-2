import { NextResponse } from "next/server";
import { getBrandAccountId, upsertBrandMandateData } from "@/lib/db";
import { requireInternalBearer } from "@/lib/route-security";

const BRAND_DISPLAY_NAMES: Record<string, string> = {
  adidas:   "Adidas Argentina",
  nike:     "Nike Argentina",
  quilmes:  "Quilmes",
  mp:       "Mercado Pago",
  steam:    "Steam",
  rappi:    "Rappi Argentina",
  globant:  "Globant",
  cocacola: "Coca-Cola Argentina",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const authError = requireInternalBearer(request);
  if (authError) return authError;

  try {
    const { brandId } = await params;
    const body = (await request.json()) as {
      daily_cap_usdc: number;
      min_bid_usdc: number;
      max_bid_usdc: number;
      safety_keywords: string[];
    };

    const brandAccountId = await getBrandAccountId(brandId);
    if (!brandAccountId) {
      return NextResponse.json({ error: `Unknown brand: ${brandId}` }, { status: 404 });
    }

    const displayName = BRAND_DISPLAY_NAMES[brandId] ?? brandId;
    await upsertBrandMandateData(brandAccountId, displayName, {
      daily_cap_usdc: body.daily_cap_usdc,
      min_bid_usdc: body.min_bid_usdc,
      max_bid_usdc: body.max_bid_usdc,
      safety_keywords: body.safety_keywords,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "database error" }, { status: 500 });
  }
}

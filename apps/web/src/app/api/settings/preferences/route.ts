import { NextResponse } from "next/server";
import { getDemoCreatorId, getStreamerPrefs, upsertStreamerPrefs } from "@/lib/db";

export async function GET() {
  try {
    const creatorId = await getDemoCreatorId();
    const prefs = await getStreamerPrefs(creatorId);
    return NextResponse.json(prefs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      approvedBrands: string[];
      safetyKeywords: string[];
    };
    const creatorId = await getDemoCreatorId();
    await upsertStreamerPrefs(creatorId, {
      approved_brand_slugs: body.approvedBrands,
      blocked_keywords: body.safetyKeywords,
      hard_floor_usdc: 0.10,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

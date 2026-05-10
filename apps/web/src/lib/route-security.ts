import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireInternalBearer(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (isProductionRuntime()) {
      return NextResponse.json(
        { error: "CRON_SECRET must be configured for this endpoint" },
        { status: 503 },
      );
    }
    return null;
  }

  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const token = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  if (!token || !constantTimeEqual(token, expected)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  return null;
}

/**
 * Auth gate for protected routes. Uses Better Auth's cookie-only check
 * (NOT a DB call) — fast, runs on every protected request.
 *
 * The page-level server check in apps/web/src/app/dashboard/page.tsx
 * does the real DB session validation; the middleware only filters out
 * the obvious unauth case so the page handler is never even invoked.
 *
 * Why cookie-only here: Better Auth recommends against DB calls in
 * Next.js middleware (Edge runtime, plus per-request cost). The cookie
 * check is enough to reject 99% of unauthorized traffic; expired/revoked
 * sessions get caught by the page-level check.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED_PREFIXES = ["/dashboard"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (sessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match the protected paths only — keeps middleware off /, /login, /signup,
  // /api/*, static assets, /overlay/* (must stay public for OBS), etc.
  matcher: ["/dashboard/:path*", "/dashboard"],
};

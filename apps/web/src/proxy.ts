import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard"];

// better-auth default cookie name: cookiePrefix.cookieName
// see node_modules/better-auth/dist/cookies/index.mjs
const SESSION_COOKIE = "better-auth.session_token";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/dashboard"],
};

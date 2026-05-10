import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const USER = "admin";
const PASS = "!43test12!";

export function proxy(request: NextRequest) {
  const auth = request.headers.get("authorization");

  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice("Basic ".length));
    const sep = decoded.indexOf(":");
    const u = decoded.slice(0, sep);
    const p = decoded.slice(sep + 1);
    if (u === USER && p === PASS) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Addie dashboard", charset="UTF-8"' },
  });
}

export const config = {
  // Gate everything EXCEPT:
  //  - /api/*       (consumed by pipeline, overlay SSE, etc.)
  //  - /o/*         (OBS overlay iframe — can't do Basic Auth)
  //  - /overlay/*   (overlay assets)
  //  - /demo-display, /mock (demo entry points, no auth)
  //  - /_next/*, favicon, robots, sitemap
  matcher: ["/((?!api|o/|overlay|demo-display|mock|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)"],
};

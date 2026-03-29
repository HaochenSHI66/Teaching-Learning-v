import { NextRequest, NextResponse } from "next/server";

/**
 * Auth middleware: redirects unauthenticated users to /login when
 * NEXT_PUBLIC_REQUIRE_AUTH is set to "true" (deployed environment).
 *
 * Local development (NEXT_PUBLIC_REQUIRE_AUTH unset or "false") skips auth.
 */
export function middleware(request: NextRequest) {
  const requireAuth = process.env.NEXT_PUBLIC_REQUIRE_AUTH === "true";
  if (!requireAuth) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth_token")?.value;
  if (!token) {
    // Also check the Authorization header for API-style requests
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login (the login page itself)
     * - /api (backend proxied requests handle their own auth)
     * - /privacy, /terms (public pages)
     * - /_next (Next.js internals)
     * - Static files
     */
    "/((?!login|api|privacy|terms|_next/static|_next/image|favicon.ico|.*\\.).*)",
  ],
};

import { NextRequest, NextResponse } from "next/server";

const adminSessionCookie = "cinedark_admin_session";
const appBasePath = "/cinedark";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/^\/cinedark(?=\/|$)/, "") || "/";
  const isPublicAsset =
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/cinedark-logo.png";

  if (pathname === "/login" || pathname.startsWith("/api/") || isPublicAsset) {
    return NextResponse.next();
  }

  if (!request.cookies.get(adminSessionCookie)?.value) {
    return NextResponse.redirect(new URL(`${appBasePath}/login`, request.url));
  }

  return NextResponse.next();
}

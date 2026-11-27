import { NextResponse, type NextRequest } from "next/server";
import { NAV_COOKIE } from "@/lib/nav-layout";

// GET /api/nav-layout?mode=sidebar|top — sceglie il menu della dashboard e
// torna alla pagina di provenienza. È anche la "porta di servizio": se il menu
// in alto non va, aprire /api/nav-layout?mode=sidebar riporta la sidebar.
export function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "sidebar" ? "sidebar" : "top";
  const back = req.nextUrl.searchParams.get("back");
  const target = back && back.startsWith("/") && !back.startsWith("//") ? back : "/dashboard";
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(NAV_COOKIE, mode, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365 * 5,
  });
  return res;
}

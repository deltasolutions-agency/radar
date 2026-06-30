import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Protezione delle aree riservate.
 *
 * - Le rotte sotto /dashboard richiedono una sessione valida; in mancanza
 *   si viene reindirizzati a /login (con ?next per tornare alla pagina).
 * - Un utente già autenticato che apre /login viene mandato a /dashboard.
 *
 * Il middleware gira sull'Edge runtime, quindi può importare solo codice
 * edge-safe (jose), non Prisma/bcrypt.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  const isLogin = pathname === "/login";
  const isProtected = pathname === "/" || pathname.startsWith("/dashboard");

  if (isLogin && session) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (isProtected && !session) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Esclude asset statici e le API (che gestiscono l'auth da sé).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

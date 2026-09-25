import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Routes accessibles sans session. Tout le reste exige d'être connecté.
 * `/api/cron` est appelée par Vercel, sans cookie : elle vérifie elle-même
 * son secret (CRON_SECRET) et refuse tout le reste.
 */
const PUBLIC_PATHS = ["/login", "/auth", "/api/cron"];

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Non connecté sur une route protégée -> /login (on mémorise la destination).
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Déjà connecté sur /login -> on renvoie vers l'app.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/cockpit";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf : fichiers statiques Next, images optimisées,
     * favicon et assets à extension. La session est ainsi rafraîchie sur
     * chaque navigation applicative.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Routes accessibles sans session. Tout le reste exige d'être connecté.
 */
const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Routes MACHINE : appelées par n8n ou par le planificateur Vercel, jamais par
 * un navigateur. Elles n'ont pas de cookie de session et n'en auront jamais.
 *
 * Le bug : `/api/inbound` n'y figurait pas. Un POST de n8n recevait donc une
 * redirection 307 vers `/login` — le webhook ne voyait jamais la route, et
 * n8n rejouait l'email indéfiniment.
 *
 * Elles ne sont pas pour autant ouvertes : chacune vérifie son propre secret
 * partagé, par comparaison à TEMPS CONSTANT (`x-orion-inbound-secret` pour
 * l'inbound, `Authorization: Bearer <CRON_SECRET>` pour le cron). Le
 * middleware n'a rien à ajouter ; il ne ferait que gêner.
 */
const MACHINE_PATHS = ["/api/inbound", "/api/cron"];

const matches = (pathname: string, paths: readonly string[]): boolean =>
  paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export const isPublicPath = (pathname: string): boolean => matches(pathname, PUBLIC_PATHS);

/** `true` pour une route protégée par son propre secret, pas par la session. */
export const isMachinePath = (pathname: string): boolean => matches(pathname, MACHINE_PATHS);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Route machine : on ne rafraîchit même pas la session. Il n'y a pas de
  // cookie à rafraîchir, et l'appel à Supabase coûterait un aller-retour sur
  // chaque webhook.
  if (isMachinePath(pathname)) return NextResponse.next();

  const { response, user } = await updateSession(request);

  // Non connecté sur une route protégée -> /login (on mémorise la destination).
  if (!user && !isPublicPath(pathname)) {
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

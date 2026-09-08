import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Rafraîchit la session Supabase à chaque requête et renvoie l'utilisateur
 * courant avec la réponse portant les cookies mis à jour.
 * La redirection est décidée par middleware.ts à la racine.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        headers: Record<string, string>,
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Interdit la mise en cache (CDN, proxy) d'une réponse qui pose des
        // cookies d'auth : sinon la session d'un visiteur pourrait être servie
        // à un autre.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // `getUser()` (et non `getSession()`) : valide le JWT auprès de Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, requireEnv } from "@/lib/env";

/**
 * Client Supabase côté serveur (Server Components, Route Handlers, Server Actions).
 * Lit la session dans les cookies et la rafraîchit quand c'est possible.
 * À créer par requête — ne jamais mettre en cache dans une variable de module.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Appelé depuis un Server Component : l'écriture de cookies y est
          // interdite. Le middleware rafraîchit déjà la session, on peut ignorer.
        }
      },
    },
  });
}

/**
 * Client "service_role" : ignore la RLS. Réservé au serveur (jobs, webhooks n8n,
 * imports en masse). Ne jamais l'exposer à un Client Component.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(SUPABASE_URL(), requireEnv("SUPABASE_SERVICE_ROLE"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

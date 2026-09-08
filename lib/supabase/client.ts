"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Client Supabase pour les Client Components.
 * `createBrowserClient` mémoïse l'instance : appeler à chaque rendu est sûr.
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL(), SUPABASE_ANON_KEY());
}

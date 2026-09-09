"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types";

/**
 * Next.js ne remplace une variable `NEXT_PUBLIC_` dans le bundle navigateur que
 * si elle est référencée LITTÉRALEMENT (`process.env.NEXT_PUBLIC_X`). Un accès
 * dynamique — `process.env[name]`, ce que fait `requireEnv` dans lib/env.ts —
 * n'est pas inliné au build : dans le navigateur `process.env` est un objet vide
 * et la valeur vaut `undefined`. D'où ces deux lectures en dur, à ne surtout pas
 * refactoriser derrière un helper.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. ` +
        `Vérifiez qu'elle est définie dans .env.local (local) ou dans les ` +
        `variables d'environnement Vercel, puis relancez un build : les ` +
        `variables NEXT_PUBLIC_ sont figées au moment de la compilation.`,
    );
  }
  return value;
}

/**
 * Client Supabase pour les Client Components.
 * `createBrowserClient` mémoïse l'instance : appeler à chaque rendu est sûr.
 */
export function createClient() {
  return createBrowserClient<Database>(
    required("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY),
  );
}

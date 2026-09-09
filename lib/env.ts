/**
 * Lit une variable d'environnement et échoue tôt (et clairement) si absente.
 *
 * SERVEUR UNIQUEMENT. L'accès `process.env[name]` est dynamique : Next.js ne
 * peut pas l'inliner dans un bundle navigateur, où il renverrait toujours
 * `undefined`. Pour une variable `NEXT_PUBLIC_` lue côté client, écrire
 * `process.env.NEXT_PUBLIC_X` en toutes lettres (cf. lib/supabase/client.ts).
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Voir .env.local.example.`,
    );
  }
  return value;
}

export const SUPABASE_URL = () => requireEnv("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

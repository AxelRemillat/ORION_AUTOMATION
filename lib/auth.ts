import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Utilisateur courant, ou null si non connecté. */
export async function getUser(): Promise<User | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * À utiliser en tête des Server Components de /app/(app) qui ont besoin de
 * l'utilisateur : garantit un `User` non nul (le middleware protège déjà les
 * routes, ce garde-fou couvre les accès directs et satisfait TypeScript).
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

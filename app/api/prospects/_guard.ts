import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types";

/**
 * Garde commune aux routes de recherche : refuse les appels anonymes.
 * Les APIs tierces sont facturées, on ne les expose pas sans session.
 */
export async function requireSession(): Promise<
  { ok: true; supabase: SupabaseClient<Database>; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session expirée. Reconnectez-vous." }, { status: 401 }),
    };
  }
  return { ok: true, supabase, userId: user.id };
}

/** Parse le corps JSON sans jamais lever (corps vide, JSON invalide…). */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

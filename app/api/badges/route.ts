import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { badgeCounts, ZERO_BADGES } from "@/lib/badges/counts";

/**
 * Les badges de la barre, recalculés à la demande.
 *
 * La barre de navigation vit dans le layout : en navigation côté client, Next
 * ne la rejoue pas, et ses compteurs restaient figés jusqu'au rechargement
 * complet. Elle appelle donc cette route à chaque changement de page.
 *
 * Lecture seule, session de l'utilisateur (RLS) : aucune écriture, jamais de
 * cache.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(ZERO_BADGES, { status: 401 });

  const badges = await badgeCounts(supabase);
  return NextResponse.json(badges, { headers: { "cache-control": "no-store" } });
}

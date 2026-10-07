import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { generateFollowUp } from "@/lib/opportunities/follow-up";
import { opportunityAsk } from "@/lib/opportunities/run";
import type { Opportunity } from "@/lib/opportunities/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rédige la RELANCE suggérée d'une proposition restée sans réponse (moins de
 * 400 caractères, aucune coordonnée) et l'enregistre sur la fiche. Rien n'est
 * envoyé : Axel la copie, puis « Marquer relancée ».
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data } = await db.from("opportunities").select("id, platform, title, need, proposal, language").eq("id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Opportunité introuvable." }, { status: 404 });
  const outcome = await generateFollowUp(opportunityAsk(), data as Opportunity);
  const { error } = await db.from("opportunities").update({ follow_up_text: outcome.text, updated_at: new Date().toISOString() }).eq("id", params.id);
  if (error) return NextResponse.json({ error: `Non enregistré : ${error.message}` }, { status: 500 });
  return NextResponse.json({ text: outcome.text, source: outcome.source });
}

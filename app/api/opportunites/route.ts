import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { parseNewOpportunity } from "@/lib/opportunities/input";
import { analyzeAndPropose } from "@/lib/opportunities/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Analyse + proposition (jusqu'à trois rédactions notées) : bien au-delà des 10 s par défaut. */
export const maxDuration = 120;

/**
 * Ajout d'une opportunité (saisie manuelle, V1), puis analyse et proposition.
 * Aucun envoi, aucune connexion à la plateforme : la proposition est à copier.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const parsed = parseNewOpportunity(await readJson<Record<string, unknown>>(request));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data, error } = await db.from("opportunities").insert({ ...parsed.value, user_id: session.userId }).select("id").single();
  if (error || !data) return NextResponse.json({ error: `Opportunité non enregistrée : ${error?.message ?? "inconnue"}` }, { status: 500 });

  // L'opportunité est gardée même si l'analyse échoue : on peut la relancer.
  const run = await analyzeAndPropose(db, session.userId, data.id);
  return NextResponse.json({ id: data.id, ...(run.ok ? { ok: true } : { ok: false, warning: run.error }) });
}

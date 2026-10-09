import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { analyzeAndPropose } from "@/lib/opportunities/run";
import { shouldAlertAfterPaste } from "@/lib/opportunities/ingest";
import { codeurProjectAlert } from "@/lib/opportunities/email/ingest-email";
import { appUrl, pushNtfy } from "@/lib/notify/ntfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Relance l'analyse et la proposition (après une erreur, ou une annonce corrigée).
 * Fiche « Titre seul » complétée par l'annonce collée : alerte ntfy si le score
 * atteint 8, comme pour une annonce reçue par la veille (plateformes #11).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data: before } = await db.from("opportunities").select("analysis_state").eq("id", params.id).maybeSingle();
  const run = await analyzeAndPropose(session.supabase as never, session.userId, params.id);
  if (!run.ok) return NextResponse.json({ error: run.error }, { status: 502 });
  if (shouldAlertAfterPaste((before as { analysis_state?: string | null } | null)?.analysis_state, run.score)) {
    const { data: row } = await db.from("opportunities").select("title, fit_reasons, budget").eq("id", params.id).maybeSingle();
    const item = row as { title: string; fit_reasons: string[] | null; budget: string | null } | null;
    if (item) {
      const url = `${appUrl()}/opportunites?id=${encodeURIComponent(params.id)}`;
      await pushNtfy(codeurProjectAlert({ title: item.title, score: run.score, reasons: item.fit_reasons ?? [], budget: item.budget }, url, "Analysée après collage de l'annonce complète.")).catch(() => false);
    }
  }
  return NextResponse.json(run);
}

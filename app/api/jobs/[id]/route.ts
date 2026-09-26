import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { getJob, getJobOutput } from "@/lib/jobs/store";
import { isTerminal } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/:id → { job, output?, details? } (RLS : seulement les siens).
 *
 * `output` n'est rendu qu'une fois le job terminé : c'est la réponse complète
 * d'une génération de mail, que l'écran réaffiche au retour sur le prospect.
 * `details` accompagne un refus que l'écran sait interpréter (accroche absente).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const job = await getJob(session.supabase, params.id);
  if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  if (!isTerminal(job.status)) return NextResponse.json({ job });

  const extra = await getJobOutput(session.supabase, params.id);
  return NextResponse.json({ job, output: extra?.output ?? null, details: extra?.details ?? null });
}

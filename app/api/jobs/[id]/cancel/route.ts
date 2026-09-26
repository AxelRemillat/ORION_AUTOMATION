import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { requestStop } from "@/lib/search/runs";
import { cancelJob, getJob } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/cancel
 *
 * On pose le statut, on ne tue rien : l'étape en cours le relit entre deux
 * lots (les appels déjà payés sont gardés) et son écriture finale, conditionnée
 * à `running`, ne peut plus ressusciter le job.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const cancelled = await cancelJob(session.supabase, params.id);
  if (!cancelled) {
    const job = await getJob(session.supabase, params.id);
    if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
    return NextResponse.json({ job });
  }

  // Une recherche pilote une ligne `search_runs` : elle doit s'arrêter aussi.
  const runId = cancelled.state?.runId ?? cancelled.result?.runId;
  if (typeof runId === "string") await requestStop(session.supabase, runId);

  return NextResponse.json({ job: await getJob(session.supabase, params.id) });
}

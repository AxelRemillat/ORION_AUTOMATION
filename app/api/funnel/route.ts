import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { latestFunnel } from "@/lib/funnel/latest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/funnel → le dernier run de l'entonnoir « signaux d'abord » :
 * avancement du job, compteurs bruts → filtrés → retenus → contactables, coût,
 * cartes (retenus et creusés) et rejets motivés. Lecture seule : le lancement
 * passe par POST /api/jobs {type: "search_signals", params: {kind: "funnel"}}.
 */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  try {
    return NextResponse.json(await latestFunnel(session.supabase, session.userId));
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Lecture impossible." }, { status: 500 });
  }
}

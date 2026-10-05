import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { analyzeAndPropose } from "@/lib/opportunities/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Relance l'analyse et la proposition (après une erreur, ou une annonce corrigée). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const run = await analyzeAndPropose(session.supabase as never, session.userId, params.id);
  return run.ok ? NextResponse.json(run) : NextResponse.json({ error: run.error }, { status: 502 });
}

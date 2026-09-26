import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { getJob } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs/:id → le job (RLS : seulement les siens). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const job = await getJob(session.supabase, params.id);
  if (!job) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  return NextResponse.json({ job });
}

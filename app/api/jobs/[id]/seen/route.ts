import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { markSeen } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/seen — le résultat a été montré : il quitte la liste active. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  await markSeen(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}

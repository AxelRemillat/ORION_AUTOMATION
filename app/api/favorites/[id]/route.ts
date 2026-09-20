import { NextResponse } from "next/server";
import { requireSession } from "../../prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retire une entreprise du stock de favoris. La RLS limite au proprietaire. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { error } = await session.supabase.from("favorites").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: `Suppression impossible : ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

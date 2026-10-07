import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { buildOpportunityPatch } from "@/lib/opportunities/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Suivi d'une opportunité : statut, notes, montant signé, proposition retouchée. Jamais d'envoi. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data: current } = await db.from("opportunities").select("status, sent_at, replied_at, conversation_at, won_at").eq("id", params.id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Opportunité introuvable." }, { status: 404 });
  const built = buildOpportunityPatch(await readJson<Record<string, unknown>>(request), current);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  const { error } = await db.from("opportunities").update(built.patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: `Non enregistré : ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, patch: built.patch });
}

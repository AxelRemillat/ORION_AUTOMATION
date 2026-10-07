import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * E-mail de plateforme « à trier » : classé à la main (`trie`), ou rattaché à
 * une opportunité choisie par Axel. Rien n'est supprimé.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const raw = await readJson<Record<string, unknown>>(request);
  const db = session.supabase as unknown as { from: (table: string) => any };
  const patch: Record<string, unknown> = {};
  if (raw?.status === "trie" || raw?.status === "a_trier") patch.status = raw.status;
  if (typeof raw?.opportunity_id === "string" && raw.opportunity_id) {
    const { data: opportunity } = await db.from("opportunities").select("id").eq("id", raw.opportunity_id).maybeSingle();
    if (!opportunity) return NextResponse.json({ error: "Opportunité introuvable." }, { status: 404 });
    patch.opportunity_id = raw.opportunity_id;
    patch.status = "rattache";
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à enregistrer." }, { status: 400 });
  const { error } = await db.from("opportunity_emails").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: `Non enregistré : ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, patch });
}

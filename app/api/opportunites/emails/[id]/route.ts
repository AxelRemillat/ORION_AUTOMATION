import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vue « À trier » : un e-mail de plateforme non reconnu est IGNORÉ (statut
 * `ignore`, gardé pour audit) ou RATTACHÉ à une fiche existante choisie par
 * Axel. Rien n'est supprimé. (Créer une fiche : POST …/fiche.)
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const raw = await readJson<Record<string, unknown>>(request);
  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data: email } = await db.from("opportunity_emails").select("id, received_at").eq("id", params.id).maybeSingle();
  if (!email) return NextResponse.json({ error: "E-mail introuvable." }, { status: 404 });
  const patch: Record<string, unknown> = {};
  // « trie » : ancien bouton « Classé » (#103), équivalent d'« ignorer ».
  if (raw?.status === "ignore" || raw?.status === "a_trier" || raw?.status === "trie") patch.status = raw.status;
  if (typeof raw?.opportunity_id === "string" && raw.opportunity_id) {
    const { data: opportunity } = await db.from("opportunities").select("id").eq("id", raw.opportunity_id).maybeSingle();
    if (!opportunity) return NextResponse.json({ error: "Opportunité introuvable." }, { status: 404 });
    patch.opportunity_id = raw.opportunity_id;
    patch.status = "rattache";
    await db
      .from("opportunities")
      .update({ last_event_at: (email as { received_at: string | null }).received_at ?? new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", raw.opportunity_id);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à enregistrer." }, { status: 400 });
  const { error } = await db.from("opportunity_emails").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: `Non enregistré : ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, patch });
}

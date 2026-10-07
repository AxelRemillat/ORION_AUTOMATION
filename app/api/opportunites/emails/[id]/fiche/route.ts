import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { needsProposal, opportunityFromEmail, parseTriageCreate, type TriageEmail } from "@/lib/opportunities/email/triage";
import { analyzeAndPropose } from "@/lib/opportunities/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Demande ou invitation : analyse et proposition, comme une annonce collée. */
export const maxDuration = 120;

/**
 * Vue « À trier » : crée une fiche depuis un e-mail non reconnu, avec la
 * plateforme et le type choisis par Axel. Le statut suit le type (commande →
 * Gagnée, offre → Conversation, message → Réponse). Rien n'est envoyé.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const choice = parseTriageCreate(await readJson<Record<string, unknown>>(request));
  if (!choice.ok) return NextResponse.json({ error: choice.error }, { status: 400 });
  const db = session.supabase as unknown as { from: (table: string) => any };
  const { data: email } = await db.from("opportunity_emails").select("id, subject, excerpt, from_address, received_at, external_id, opportunity_id").eq("id", params.id).maybeSingle();
  if (!email) return NextResponse.json({ error: "E-mail introuvable." }, { status: 404 });
  if ((email as { opportunity_id: string | null }).opportunity_id) return NextResponse.json({ error: "Cet e-mail est déjà lié à une fiche." }, { status: 409 });

  const row = opportunityFromEmail(email as TriageEmail, choice.platform, choice.kind, session.userId);
  const { data, error } = await db.from("opportunities").insert(row).select("id").single();
  if (error || !data) return NextResponse.json({ error: `Fiche non créée : ${error?.message ?? "inconnue"}` }, { status: 500 });
  const id = (data as { id: string }).id;
  await db.from("opportunity_emails").update({ status: "cree", kind: choice.kind, platform: choice.platform, opportunity_id: id }).eq("id", params.id);

  // La fiche est gardée même si l'analyse échoue : « Analyser » la relance.
  const run = needsProposal(choice.kind) ? await analyzeAndPropose(db, session.userId, id) : null;
  return NextResponse.json({ id, ...(run && !run.ok ? { warning: run.error } : {}) });
}

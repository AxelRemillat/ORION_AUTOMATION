import { NextResponse } from "next/server";
import type { Prospect } from "@/types";
import { activeProspects } from "@/lib/trash/scope";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { runJobInline } from "@/lib/jobs/inline";
import { EMAIL_PARAMS_SCHEMA, emailBlocker } from "@/lib/jobs/handlers/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Contact + stratège + rédaction + juge, et jusqu'à une réécriture : trois
 * étapes pilotées l'une après l'autre. Plafond du plan Hobby.
 */
export const maxDuration = 300;

/**
 * Génération d'un brouillon : un job `email_generate` (ou `email_rewrite`),
 * dont les étapes vivent dans lib/jobs/handlers/email.ts.
 *
 * La route vérifie d'abord ce qui ne coûte rien (corps, prospect, statut, clé)
 * pour répondre comme avant sans créer de job, puis pilote le job et rend la
 * même réponse. TOUT brouillon généré est enregistré sur le prospect
 * (`saveDraft: true`) : il réécrit le dernier brouillon non envoyé plutôt que
 * d'en empiler un second, et ne touche jamais un mail programmé.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsed = EMAIL_PARAMS_SCHEMA.safeParse(await readJson<unknown>(request));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const params = { ...parsed.data, saveDraft: true };

  // Corbeille exclue : aucun crédit dépensé pour un prospect supprimé.
  const { data } = await activeProspects(session.supabase).eq("id", params.prospectId).maybeSingle();
  const prospect = data as Prospect | null;
  if (!prospect) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });

  const blocker = emailBlocker(prospect);
  if (blocker) return NextResponse.json({ error: blocker.message }, { status: blocker.status });

  return runJobInline(request, session.supabase, {
    type: params.mode === "rewrite" ? "email_rewrite" : "email_generate",
    target: { prospectId: prospect.id, label: `Mail · ${prospect.company_name}`.slice(0, 160) },
    params,
  });
}

import { enrichCompany } from "@/lib/enrichment";
import { resolveCompany } from "@/lib/enrichment/gouv";
import { activeProspects } from "@/lib/trash/scope";
import type { Prospect } from "@/types";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";

/**
 * Réanalyse d'un prospect : la chaîne d'enrichissement complète rejouée sur
 * une fiche existante (même logique que scripts/reenrich.ts), puis réécriture
 * de ses signaux et chiffres clés.
 *
 * Une seule étape : `enrichCompany` est d'un seul tenant (lib/enrichment).
 * Elle est idempotente — rejouée, elle réécrit la même fiche.
 */
async function reanalyze(ctx: StepContext): Promise<StepOutcome> {
  const prospectId =
    (ctx.job.target as { prospectId?: string }).prospectId ?? (ctx.job.params.prospectId as string | undefined);
  if (!prospectId) throw new JobError("Prospect manquant.", false, 400);

  const { data } = await activeProspects(ctx.db).eq("id", prospectId).eq("user_id", ctx.userId).maybeSingle();
  const prospect = data as Prospect | null;
  if (!prospect) throw new JobError("Prospect introuvable.", false, 404);

  await ctx.progress({ step: "Réanalyse de la fiche", pct: 20, counts: { scanned: 0, signals: 0, sheets: 0 } });

  const resolved = await resolveCompany(prospect.siren ?? prospect.company_name);
  if (!resolved.ok) throw new JobError(`Résolution impossible : ${resolved.error}`, false, 404);

  // On repart de l'annuaire MAIS on garde ce que la fiche sait déjà.
  const enriched = await enrichCompany({
    ...resolved.data,
    email: resolved.data.email ?? prospect.email,
    website: resolved.data.website ?? prospect.website,
  });

  const { error } = await ctx.db
    .from("prospects")
    .update({
      website: enriched.website,
      email: enriched.email ?? prospect.email,
      sector: enriched.sector,
      size_range: enriched.size_range,
      signals: enriched.signals,
      key_figures: enriched.key_figures,
    })
    .eq("id", prospect.id);
  if (error) throw new Error(`fiche non mise à jour : ${error.message}`);

  return {
    result: { prospectIds: [prospect.id] },
    progress: {
      step: "Fiche réanalysée",
      pct: 100,
      counts: { scanned: 1, signals: enriched.signals.length, sheets: 1 },
    },
  };
}

export const reanalyzeHandler: JobHandler = { steps: [reanalyze] };

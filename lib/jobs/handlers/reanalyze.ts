import { enrichCompany } from "@/lib/enrichment";
import { resolveCompany } from "@/lib/enrichment/gouv";
import { activeProspects } from "@/lib/trash/scope";
import type { Prospect, ProspectKeyFigures } from "@/types";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";
import { findContact } from "@/lib/contact-finder";

/**
 * `scope: "contact"` : seule l'étape contact tourne (bouton « Trouver le
 * contact (IA) », site saisi à la main). Sans scope, la réanalyse complète est
 * suivie de l'étape contact QUAND la fiche n'a toujours ni site ni adresse.
 */
const scopeOf = (ctx: StepContext) => (ctx.job.params.scope === "contact" ? "contact" : "full");
const prospectIdOf = (ctx: StepContext) =>
  (ctx.job.target as { prospectId?: string }).prospectId ?? (ctx.job.params.prospectId as string | undefined);

/**
 * Réanalyse d'un prospect : la chaîne d'enrichissement complète rejouée sur
 * une fiche existante (même logique que scripts/reenrich.ts), puis réécriture
 * de ses signaux et chiffres clés.
 *
 * Une seule étape : `enrichCompany` est d'un seul tenant (lib/enrichment).
 * Elle est idempotente — rejouée, elle réécrit la même fiche.
 */
/**
 * Chiffres clés d'une fiche réanalysée : FUSION, et non remplacement.
 *
 * Les faits du SIGNAL qui a fait remonter la fiche — `signal_source`,
 * `signal_date`, `new_leader_name`, `job_title`, `capital_after_eur` — sont
 * écrits par la recherche, pas par l'enrichissement. Les remplacer en bloc les
 * effaçait, et une fiche réanalysée perdait la raison pour laquelle on l'avait
 * ouverte : une annonce sortie de la fenêtre de soixante jours n'est plus
 * recalculable, une offre d'emploi est dépubliée.
 *
 * L'enrichissement garde la priorité sur ce qu'il RECALCULE : effectif,
 * ouvertures d'établissements, dirigeant, groupe, contenu de site.
 */
export function mergedFigures(
  existing: ProspectKeyFigures | null | undefined,
  enriched: ProspectKeyFigures,
): ProspectKeyFigures {
  return { ...(existing ?? {}), ...enriched };
}

async function reanalyze(ctx: StepContext): Promise<StepOutcome> {
  if (scopeOf(ctx) === "contact") return {};
  const prospectId = prospectIdOf(ctx);
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

  /*
   * UNE LECTURE RATEE N'EFFACE PAS CE QU'ON SAVAIT.
   *
   * Premiere reanalyse reelle de SELECTION HABITAT, le 27/09/2026 : la lecture
   * de site a echoue ce jour-la (site_status « non trouve »), et la fiche a
   * perdu son domaine — `selectionhabitat.com`, pourtant verifie. Consequence
   * immediate : plus de domaine, donc plus de recherche Hunter possible, donc
   * plus de contact nominatif. Une reanalyse ne doit jamais appauvrir une fiche.
   *
   * Regle : chaque champ n'est ecrase que si le nouvel enrichissement a
   * quelque chose a mettre a la place. Et quand le site n'a pas ete retrouve,
   * on garde AUSSI ce qu'on en savait — son statut et son contenu — plutot que
   * de declarer « non trouve » un site lu la semaine derniere.
   */
  const lostTheSite = !enriched.website && Boolean(prospect.website);
  const previousSiteFacts = lostTheSite
    ? {
        ...(prospect.key_figures?.site_status ? { site_status: prospect.key_figures.site_status } : {}),
        ...(prospect.key_figures?.site_offer ? { site_offer: prospect.key_figures.site_offer } : {}),
        ...(prospect.key_figures?.site_customers ? { site_customers: prospect.key_figures.site_customers } : {}),
        ...(prospect.key_figures?.site_vocabulary ? { site_vocabulary: prospect.key_figures.site_vocabulary } : {}),
      }
    : {};

  const { error } = await ctx.db
    .from("prospects")
    .update({
      website: enriched.website ?? prospect.website,
      email: enriched.email ?? prospect.email,
      sector: enriched.sector ?? prospect.sector,
      size_range: enriched.size_range ?? prospect.size_range,
      signals: enriched.signals.length ? enriched.signals : prospect.signals,
      key_figures: { ...mergedFigures(prospect.key_figures, enriched.key_figures), ...previousSiteFacts },
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

/**
 * Étape contact : site officiel + adresse (lib/contact-finder), avec ses
 * plafonds de coût. Automatique après une réanalyse qui n'a trouvé ni site ni
 * adresse ; systématique quand on l'a demandée.
 */
async function contact(ctx: StepContext): Promise<StepOutcome> {
  const prospectId = prospectIdOf(ctx);
  if (!prospectId) throw new JobError("Prospect manquant.", false, 400);
  const { data } = await activeProspects(ctx.db).eq("id", prospectId).eq("user_id", ctx.userId).maybeSingle();
  const prospect = data as Prospect | null;
  if (!prospect) throw new JobError("Prospect introuvable.", false, 404);
  if (scopeOf(ctx) === "full" && prospect.website && prospect.email) return {};

  await ctx.progress({ step: "Recherche du site et du contact", pct: 60, counts: { scanned: 0, signals: 0, sheets: 1 } });
  const website = typeof ctx.job.params.website === "string" ? ctx.job.params.website : null;
  const found = await findContact(prospect.id, { db: ctx.db, userId: ctx.userId, website });
  return {
    state: { contact: found },
    result: { prospectIds: [prospect.id] },
    progress: {
      step: found.email
        ? `Contact trouvé : ${found.email}`
        : found.website
          ? "Site trouvé, aucune adresse publiée"
          : "Aucun site prouvé pour cette entreprise",
      pct: 100,
      counts: { scanned: 1, signals: 0, sheets: 1 },
    },
  };
}

export const reanalyzeHandler: JobHandler = { steps: [reanalyze, contact] };

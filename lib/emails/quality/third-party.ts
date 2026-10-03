import { isStaffingNaf } from "@/lib/signals";

/**
 * « SIGNAL POUR UN CLIENT » — l'entreprise publie des offres d'emploi pour des
 * tiers : le recrutement ne la concerne pas, le mail tomberait à côté.
 *
 * Constaté le 03/10/2026 : 1PACT (salariés en temps partagé, NAF 70.22Z) et
 * NEW NET 3D (« Groupe Talents Handicap », cabinet de recrutement, NAF 62.02A)
 * ont reçu un brouillon bâti sur une offre qu'ils avaient publiée POUR un
 * client. Le NAF seul ne suffit pas (ni l'un ni l'autre n'est en 78.xx) : on
 * lit aussi la raison sociale, le site, le profil métier et le texte de l'offre.
 *
 * Code pur : utilisé par le filtre de l'entonnoir (en amont, avant tout coût),
 * par le « hors cible » des fiches déjà ouvertes, et par la génération.
 */

export const THIRD_PARTY_BADGE = "signal pour un client";

export interface ThirdPartyInput {
  naf?: string | null;
  /** Raison sociale, enseigne : tout nom connu. */
  names?: readonly (string | null | undefined)[];
  website?: string | null;
  /** Offre lue sur le site (profil métier), activité déclarée. */
  activity?: string | null;
  /** Texte de l'offre d'emploi ou du signal. */
  signalText?: string | null;
}

/** Activité : mise à disposition, portage, recrutement pour des tiers. */
const ACTIVITY =
  /(temps partag[ée]|mise [àa] disposition (de|du) (personnel|salari[ée]s?)|groupement d['’]employeurs|portage salarial|cabinet de recrutement|agence de recrutement|plateforme de recrutement|job ?board|site d['’]emploi|chasseurs? de t[êe]tes|int[ée]rim\b|travail temporaire|recrut(e|ons|ement) pour (le compte de |nos |ses |des )?(clients?|entreprises partenaires))/i;

/** Raison sociale ou domaine : marques de recruteurs (Comptalents, Talents Handicap, …). */
const NAME =
  /(\btalents?\b|\w+talents?\b|recrut|int[ée]rim|staffing|\bjobs?\b|\bemploi\b|portage|groupement d['’ ]?employeurs|^ge\s|temps partag)/i;

/** L'offre elle-même dit qu'elle est pour un client. */
const SIGNAL =
  /(notre client|nos clients|pour (le compte d['’]|l['’]un de nos|un de nos|une entreprise cliente|son client|ses clients)|entreprise cliente|client final|mission (de travail temporaire|d['’]int[ée]rim)|poste [àa] pourvoir chez (notre|un) client)/i;

/** Motif, ou `null` si rien n'indique un recruteur pour tiers. */
export function thirdPartyEmployer(input: ThirdPartyInput): string | null {
  if (isStaffingNaf(input.naf)) return `agence d'emploi (NAF ${input.naf}) : elle recrute pour ses clients`;
  const activity = input.activity ?? "";
  const hit = activity.match(ACTIVITY);
  if (hit) return `activité « ${hit[0].toLowerCase()} » : ses offres sont publiées pour des clients`;
  const domain = (input.website ?? "").replace(/^https?:\/\/(www\.)?/i, "").split(/[/.]/)[0] ?? "";
  for (const name of [...(input.names ?? []), domain]) {
    const match = (name ?? "").match(NAME);
    if (match) return `nom « ${(name ?? "").trim()} » : recruteur ou mise à disposition pour des tiers`;
  }
  const signal = (input.signalText ?? "").match(SIGNAL);
  if (signal) return `l'offre est publiée pour un client (« ${signal[0].toLowerCase()} »)`;
  return null;
}

import { disqualify, isSmallB2C, type DigFacts } from "./eligible";
import type { Prospect } from "@/types";
import { thirdPartyEmployer } from "@/lib/emails/quality/third-party";
import { subsidiaryOf } from "@/lib/enrichment/subsidiary";
import { competitorReason } from "@/lib/segments";

/**
 * HORS CIBLE — la même règle, appliquée aux fiches DÉJÀ OUVERTES.
 *
 * Les exclusions de l'entonnoir ne valaient que pour les fiches nouvelles :
 * celles ouvertes avant restaient proposées à l'envoi, alors qu'on sait
 * maintenant qu'elles ne devraient pas l'être. Une entreprise qui s'oppose à la
 * prospection ne devient pas contactable parce que sa fiche est ancienne.
 *
 * Les quatre motifs, dans l'ordre où on les lit :
 *   - opposition à l'usage commercial des données (registre, via Pappers) ;
 *   - aucun salarié déclaré ;
 *   - capitaux propres sous la moitié du capital ;
 *   - commerce de détail ou service aux particuliers de moins de 20 salariés.
 *
 * Fonction PURE : elle lit ce que la fiche porte déjà, sans appel réseau. Une
 * fiche enrichie avant que ces champs n'existent ne dit rien — et c'est le bon
 * comportement : on ne devine pas, on affiche ce qu'on sait.
 */
export function offTargetReason(
  prospect: Pick<Prospect, "key_figures" | "size_range"> &
    Partial<Pick<Prospect, "company_name" | "website" | "business_profile">>,
): string | null {
  const figures = prospect.key_figures ?? {};
  /*
   * Offres publiées pour des clients (temps partagé, recrutement, portage) :
   * hors cible, la fiche reste en base. Lu sur ce que la fiche porte déjà.
   */
  const profile = (prospect.business_profile ?? {}) as { offer?: unknown };
  const forClient = thirdPartyEmployer({
    naf: typeof figures.naf_code === "string" ? figures.naf_code : null,
    names: [prospect.company_name],
    website: prospect.website,
    activity: typeof profile.offer === "string" ? profile.offer : null,
  });
  if (forClient) return `signal pour un client : ${forClient}`;
  /*
   * SEGMENT (agent3) : l'entreprise vend déjà la prestation qu'on lui
   * proposerait. C'est un partenaire possible, pas une cible — et surtout, lui
   * écrire une offre de sous-traitance qu'elle produit elle-même est le plus
   * sûr moyen de griller le contact. Deux lignes, lues sur la fiche.
   */
  const competitor = competitorReason(prospect);
  if (competitor) return `concurrent / partenaire possible : ${competitor}`;
  /*
   * FILIALE DE GROUPE : la décision se prend au siège — pas proposée par défaut
   * (Cowork, 05/10/2026 : MAVIFLEX, groupe Hörmann, affichée en « Nouveaux »
   * avec 10/10). Avant, seuls les drapeaux « grand groupe » et « société mère
   * étrangère » excluaient ; le reste n'était qu'un badge.
   */
  const group = subsidiaryOf(figures, prospect.company_name);
  if (group) return `filiale de groupe (${group}) : la décision se prend au siège`;
  const num = (value: unknown) => (typeof value === "number" ? value : null);

  const facts: DigFacts = {
    refusesProspecting: figures.refuses_prospecting === true,
    noStaff: figures.no_staff === true,
    capitalEur: num(figures.capital_eur),
    equityEur: num(figures.equity_eur),
    headcount: num(figures.headcount),
    largeGroup: figures.is_large_group_subsidiary === true,
    foreignParent: figures.parent_foreign === true,
  };
  const verdict = disqualify(facts);
  if (verdict) return verdict.reason;

  const headcount = num(figures.headcount);
  // La tranche INSEE sert de repli quand l'effectif réel manque : « 21 » et
  // au-delà valent vingt salariés (cf. lib/funnel/filter.ts).
  const code = typeof figures.effectif_code === "string" ? figures.effectif_code : null;
  const naf = typeof figures.naf_code === "string" ? figures.naf_code : null;
  const smallEnough = headcount !== null ? headcount < 20 : true;
  if (smallEnough && isSmallB2C(naf, code)) {
    return `commerce de détail ou service aux particuliers de moins de 20 salariés (NAF ${naf})`;
  }
  return null;
}

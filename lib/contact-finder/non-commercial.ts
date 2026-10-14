/**
 * NON COMMERCIAL (Cowork #55) : association, fondation, syndicat, structure
 * publique… n'achètent pas une prestation d'automatisation. Aucun crédit
 * Hunter, même si la fiche est en stock (ex. un centre social, un GEIQ).
 * Lu sur la forme juridique de la fiche, à défaut sur son nom. Pur.
 */
const LEGAL = /association|fondation|syndicat|mutuelle|comit[ée]|[ée]tablissement public|collectivit|commune|d[ée]partement|r[ée]gion|groupement d['’]int[ée]r[êe]t public|\bgip\b|congr[ée]gation|ordre professionnel/i;
const NAME = /\b(association|asso|fondation|geiq|centre social|l[ée]o lagrange|syndicat|mutuelle|comit[ée] d['’]entreprise|ccas|mairie|commune de|communaut[ée] de communes)\b/i;

export function nonCommercialReason(prospect: { company_name?: string | null; key_figures?: Record<string, unknown> | null }): string | null {
  const form = typeof prospect.key_figures?.legal_form === "string" ? (prospect.key_figures.legal_form as string) : "";
  if (LEGAL.test(form)) return `non commercial : ${form}`;
  if (NAME.test(prospect.company_name ?? "")) return "non commercial (association, structure publique…)";
  return null;
}

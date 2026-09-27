import { searchCompanies } from "@/lib/enrichment/gouv";
import type { CompanyBase } from "@/lib/enrichment/types";
import { normalizeCity, simplifyName } from "@/lib/signals";
import type { HarvestedSignal, Identity } from "./types";

/**
 * Identité gratuite d'un signal (API Recherche d'entreprises).
 *
 * BODACC donne le SIREN : il fait foi. Une offre d'emploi n'en a pas : on
 * cherche le nom dans le département de l'offre, et on n'accepte que un nom
 * qui correspond vraiment (l'annuaire répond de façon floue).
 */

export type Lookup = (signal: HarvestedSignal) => Promise<CompanyBase | null>;

const departementOf = (postalCode: string | null | undefined) => {
  if (!postalCode) return null;
  return postalCode.startsWith("97") ? postalCode.slice(0, 3) : postalCode.slice(0, 2);
};

const sameName = (left: string, right: string) => {
  const a = simplifyName(left);
  const b = simplifyName(right);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
};

/** Recherche annuaire réelle, avec le limiteur de débit de lib/enrichment. */
export const annuaireLookup: Lookup = async (signal) => {
  if (signal.siren) {
    const page = await searchCompanies({ q: signal.siren }, 1);
    return page.ok ? (page.data.companies.find((company) => company.siren === signal.siren) ?? null) : null;
  }
  const departement = departementOf(signal.facts.postalCode);
  const zone = departement
    ? { kind: "departement" as const, label: `département ${departement}`, param: "departement" as const, value: departement, departement }
    : undefined;
  const page = await searchCompanies({ q: signal.companyName }, 3, zone ? { zone } : {});
  return page.ok ? (page.data.companies.find((company) => sameName(signal.companyName, company.company_name)) ?? null) : null;
};

/** Identité du filtre, à partir d'une fiche annuaire. */
export function toIdentity(signal: HarvestedSignal, base: CompanyBase): Identity {
  const figures = base.figures;
  // Établissement secondaire : la ville du signal n'est pas celle du siège.
  const headOffice = figures.head_office_city ?? base.city;
  const signalCity = normalizeCity(signal.facts.city);
  const isBranch =
    base.matched_branch || Boolean(signalCity && headOffice && normalizeCity(headOffice) !== signalCity);

  return {
    siren: base.siren ?? signal.siren ?? "",
    name: base.company_name,
    naf: base.naf_code,
    effectifCode: figures.effectif_code,
    diffusion: figures.diffusion ?? null,
    adminState: figures.administrative_state ?? null,
    createdOn: figures.founded_on,
    legalCode: figures.legal_code,
    isBranch,
    headOfficeCity: isBranch ? headOffice : null,
    city: base.city,
    revenue: figures.revenue_eur,
    revenueYear: figures.revenue_year,
    // Une offre n'est « confirmée » que si l'annuaire a trouvé l'employeur.
    employerConfirmed: signal.source !== "france-travail" || sameName(signal.companyName, base.company_name),
  };
}

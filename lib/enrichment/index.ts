/**
 * Orchestrateur d'enrichissement.
 *
 * Chaîne : référentiel public (gouv) → Pappers (légal/financier) →
 * Linkup (signaux web) → qualification. Chaque source est optionnelle et
 * indépendante : une panne ou une clé manquante produit un `warning`, jamais
 * une erreur — la carte s'affiche avec ce qui a pu être récupéré.
 */
import type { ProspectInsert, ProspectKeyFigures, ProspectSource } from "@/types";
import { mapWithConcurrency, toDomain } from "./http";
import { resolveCompany, searchCompanies } from "./gouv";
import { fetchPappers, hasPappersKey } from "./pappers";
import { fetchWebResults, hasLinkupKey } from "./linkup";
import { qualifyWebResults, structuralSignals } from "./signals";
import { effectifFloor } from "./naf";
import type { CompanyBase, EnrichedCompany, EnrichmentWarning, SearchCriteria } from "./types";

/** Nombre d'enrichissements menés en parallèle (ménage les quotas tiers). */
const CONCURRENCY = 4;

/** Enrichit une identité d'entreprise avec les sources payantes disponibles. */
export async function enrichCompany(
  base: CompanyBase,
  options: { withSignals?: boolean } = {},
): Promise<EnrichedCompany> {
  const warnings: EnrichmentWarning[] = [];
  const company = { ...base };
  const keyFigures: ProspectKeyFigures = {
    founded_year: base.founded_year ?? undefined,
    legal_form: base.legal_form ?? undefined,
    naf_code: base.naf_code ?? undefined,
    headcount: effectifFloor(base.figures.effectif_code) ?? undefined,
    size_range: base.size_range ?? undefined,
  };
  if (base.leader) keyFigures.leader = base.leader;
  // Chiffres déjà fournis gratuitement par l'annuaire public.
  if (base.figures.revenue_eur != null) keyFigures.revenue_eur = base.figures.revenue_eur;
  if (base.figures.revenue_year != null) keyFigures.revenue_year = base.figures.revenue_year;
  if (base.figures.net_income_eur != null) keyFigures.net_income_eur = base.figures.net_income_eur;
  if (base.figures.company_category) keyFigures.company_category = base.figures.company_category;
  if (base.figures.head_office_city) keyFigures.head_office_city = base.figures.head_office_city;

  // --- Pappers : effectif réel, CA, dirigeant, site web -------------------
  if (base.siren && hasPappersKey()) {
    const pappers = await fetchPappers(base.siren);
    if (pappers.ok) {
      const data = pappers.data;
      company.website = company.website ?? data.website;
      company.email = company.email ?? data.email;
      company.sector = data.sector ?? company.sector;
      company.legal_form = data.legal_form ?? company.legal_form;
      company.leader = data.leader ?? company.leader;
      if (data.headcount != null) keyFigures.headcount = data.headcount;
      if (data.revenue_eur != null) keyFigures.revenue_eur = data.revenue_eur;
      if (data.revenue_year != null) keyFigures.revenue_year = data.revenue_year;
      if (data.net_income_eur != null) keyFigures.net_income_eur = data.net_income_eur;
      if (data.capital_eur != null) keyFigures.capital_eur = data.capital_eur;
      if (data.leader) keyFigures.leader = data.leader;
      if (data.leader_role) keyFigures.leader_role = data.leader_role;
    } else {
      warnings.push({ source: "pappers", message: pappers.error });
    }
  } else if (base.siren && !hasPappersKey()) {
    warnings.push({ source: "pappers", message: "clé absente : site web, effectif réel et dirigeant non complétés" });
  }

  // --- Linkup : signaux d'actualité ---------------------------------------
  let signals = structuralSignals(company, keyFigures.headcount);
  if (options.withSignals !== false) {
    if (hasLinkupKey()) {
      const web = await fetchWebResults({
        name: company.company_name,
        city: company.city,
        website: company.website,
      });
      if (web.ok) {
        // La qualification a besoin de l'identite de l'entreprise pour verifier
        // que chaque resultat la concerne reellement.
        const proven = qualifyWebResults(web.data, {
          name: company.company_name,
          website: company.website,
        });
        signals = [...proven, ...signals].slice(0, 8);
      } else {
        warnings.push({ source: "linkup", message: web.error });
      }
    } else {
      warnings.push({ source: "linkup", message: "clé absente : signaux web non récupérés" });
    }
  }

  return { ...company, key_figures: keyFigures, signals, warnings };
}

/** Mode A — recherche par critères, puis enrichissement des résultats. */
export async function searchAndEnrich(
  criteria: SearchCriteria,
): Promise<{ results: EnrichedCompany[]; total: number; warnings: EnrichmentWarning[] } | { error: string }> {
  const search = await searchCompanies(criteria);
  if (!search.ok) return { error: search.error };

  const enriched = await mapWithConcurrency(search.data.companies, CONCURRENCY, (company) =>
    enrichCompany(company, { withSignals: criteria.withSignals }),
  );

  return { results: enriched, total: search.data.total, warnings: dedupeWarnings(enriched) };
}

/** Mode B — saisie libre (nom, SIREN ou URL) → une entreprise enrichie. */
export async function resolveAndEnrich(
  query: string,
  options: { withSignals?: boolean } = {},
): Promise<{ result: EnrichedCompany } | { error: string }> {
  const resolved = await resolveCompany(query);
  if (!resolved.ok) return { error: resolved.error };
  return { result: await enrichCompany(resolved.data, options) };
}

/** Une entreprise enrichie devient une ligne `prospects` sans transformation. */
export function toProspectInsert(
  company: EnrichedCompany,
  source: ProspectSource,
): ProspectInsert {
  return {
    company_name: company.company_name,
    siren: company.siren,
    website: company.website,
    email: company.email,
    sector: company.sector,
    size_range: company.size_range,
    city: company.city,
    source,
    signals: company.signals,
    key_figures: company.key_figures,
    pain_point: null,
    status: "nouveau",
  };
}

/** Une clé manquante concerne toutes les lignes : on ne l'affiche qu'une fois. */
function dedupeWarnings(companies: EnrichedCompany[]): EnrichmentWarning[] {
  const seen = new Map<string, EnrichmentWarning>();
  for (const company of companies) {
    for (const warning of company.warnings) {
      seen.set(`${warning.source}:${warning.message}`, warning);
    }
  }
  return [...seen.values()];
}

export { toDomain };
export type { CompanyBase, EnrichedCompany, EnrichmentWarning, SearchCriteria };

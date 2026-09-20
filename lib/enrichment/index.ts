/**
 * Orchestrateur d'enrichissement — recherche en DEUX PHASES.
 *
 * Les signaux d'actualite sont rares. Enrichir les trois premieres fiches que
 * renvoie l'annuaire revient donc a tirer au sort : on payait Pappers pour
 * trois entreprises froides sans jamais tomber sur un prospect mur.
 *
 *   PHASE 1 — scan large et bon marche. On demande ~18 candidats a l'annuaire
 *   public (gratuit) et on passe CHACUN au crible de Linkup. Nom et ville
 *   suffisent : aucune fiche payante n'est encore ouverte.
 *
 *   PHASE 2 — enrichissement profond, reserve aux gagnants. Pappers n'est
 *   appele QUE sur les entreprises portant au moins un signal atteste, les
 *   plus chaudes d'abord, dans la limite du plafond d'analyse. Une entreprise
 *   sans signal n'est jamais enrichie, et n'est jamais presentee comme un
 *   prospect.
 *
 * Chaque source reste optionnelle : une panne ou une cle manquante produit un
 * `warning`, jamais une erreur.
 */
import type {
  ProspectInsert,
  ProspectKeyFigures,
  ProspectSignal,
  ProspectSource,
} from "@/types";
import { compareHeat, heatScore } from "@/lib/scoring";
import { mapWithConcurrency, toDomain } from "./http";
import { resolveCompany, searchCompanies } from "./gouv";
import { fetchPappers, hasPappersKey } from "./pappers";
import { fetchWebResults, hasLinkupKey } from "./linkup";
import { guessOwnWebsite, hasProvenSignal, qualifyWebResults, structuralSignals } from "./signals";
import { effectifFloor } from "./naf";
import {
  clampAnalysisLimit,
  clampScanWidth,
  DEFAULT_ANALYSIS_LIMIT,
  DEFAULT_SCAN_WIDTH,
} from "./limits";
import type { CompanyBase, EnrichedCompany, EnrichmentWarning, SearchCriteria } from "./types";

/** Enrichissements profonds menes en parallele (menage les quotas Pappers). */
const CONCURRENCY = 4;
/** Le scan est plus large mais plus leger : on le parallelise davantage. */
const SCAN_CONCURRENCY = 6;

/** Colonnes chiffrees deja fournies gratuitement par l'annuaire public. */
function baseKeyFigures(base: CompanyBase): ProspectKeyFigures {
  const figures: ProspectKeyFigures = {
    founded_year: base.founded_year ?? undefined,
    legal_form: base.legal_form ?? undefined,
    naf_code: base.naf_code ?? undefined,
    headcount: effectifFloor(base.figures.effectif_code) ?? undefined,
    size_range: base.size_range ?? undefined,
  };
  if (base.leader) figures.leader = base.leader;
  if (base.figures.revenue_eur != null) figures.revenue_eur = base.figures.revenue_eur;
  if (base.figures.revenue_year != null) figures.revenue_year = base.figures.revenue_year;
  if (base.figures.net_income_eur != null) figures.net_income_eur = base.figures.net_income_eur;
  if (base.figures.company_category) figures.company_category = base.figures.company_category;
  if (base.figures.head_office_city) figures.head_office_city = base.figures.head_office_city;
  return figures;
}

/** Resultat du scan d'un candidat : ce qu'on sait avant toute depense profonde. */
interface ScanResult {
  base: CompanyBase;
  /** Site officiel deduit des resultats, l'annuaire n'en fournissant pas. */
  website: string | null;
  /** Signaux ATTESTES uniquement — aucun signal structurel a ce stade. */
  signals: ProspectSignal[];
  warning?: EnrichmentWarning;
}

/**
 * PHASE 1 — scan d'un candidat : une seule recherche Linkup.
 *
 * Volontairement limite aux signaux prouves : les signaux structurels sont des
 * deductions que TOUTE entreprise obtient, ils fausseraient le classement.
 */
async function scanSignals(base: CompanyBase): Promise<ScanResult> {
  const web = await fetchWebResults({
    name: base.company_name,
    city: base.city,
    website: base.website,
  });
  if (!web.ok) {
    return { base, website: null, signals: [], warning: { source: "linkup", message: web.error } };
  }

  // Le site officiel retrouve ici sert deux fois : il ancre la qualification
  // (sans lui on perd la moitie de la confiance d'un signal), et il evite plus
  // tard a Hunter de chercher le domaine.
  const website = base.website ?? guessOwnWebsite(base.company_name, web.data);
  const signals = qualifyWebResults(web.data, { name: base.company_name, website });

  return { base, website, signals };
}

/**
 * PHASE 2 — enrichissement profond : la fiche Pappers, puis fusion.
 *
 * N'est appele que sur une entreprise deja qualifiee par le scan. Les signaux
 * structurels sont ajoutes ici, en complement des signaux attestes.
 */
async function deepEnrich(
  base: CompanyBase,
  webSignals: ProspectSignal[],
): Promise<EnrichedCompany> {
  const warnings: EnrichmentWarning[] = [];
  const company = { ...base };
  const keyFigures = baseKeyFigures(base);

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
    warnings.push({
      source: "pappers",
      message: "clé absente : site web, effectif réel et dirigeant non complétés",
    });
  }

  const signals = [...webSignals, ...structuralSignals(company, keyFigures.headcount)].slice(0, 8);
  return { ...company, key_figures: keyFigures, signals, warnings };
}

/**
 * Les deux phases sur une entreprise explicitement nommee (mode manuel).
 *
 * Ici l'utilisateur a designe la cible : l'enrichissement profond est justifie
 * meme sans signal, contrairement a la recherche par criteres.
 */
export async function enrichCompany(
  base: CompanyBase,
  options: { withSignals?: boolean } = {},
): Promise<EnrichedCompany> {
  const warnings: EnrichmentWarning[] = [];
  let webSignals: ProspectSignal[] = [];
  let identity = base;

  if (options.withSignals !== false) {
    if (hasLinkupKey()) {
      const scan = await scanSignals(base);
      webSignals = scan.signals;
      if (scan.warning) warnings.push(scan.warning);
      if (scan.website) identity = { ...base, website: base.website ?? scan.website };
    } else {
      warnings.push({ source: "linkup", message: "clé absente : signaux web non récupérés" });
    }
  }

  const enriched = await deepEnrich(identity, webSignals);
  return { ...enriched, warnings: [...warnings, ...enriched.warnings] };
}

/** Ce que la recherche par criteres rapporte, depenses comprises. */
export interface SearchOutcome {
  /** Uniquement des entreprises porteuses d'un signal, enrichies en profondeur. */
  results: EnrichedCompany[];
  /** Entreprises correspondant aux criteres dans l'annuaire. */
  total: number;
  /** Candidats reellement passes au scan Linkup. */
  scanned: number;
  /** Parmi eux, ceux portant au moins un signal atteste. */
  withSignal: number;
  /** Enrichissements profonds (Pappers) reellement effectues. */
  analysed: number;
  warnings: EnrichmentWarning[];
}

/**
 * Mode A — recherche par criteres, en deux phases.
 *
 * `withSignals` n'est plus lu ici : le scan EST la recherche. Sans lui, rien
 * ne permettrait de distinguer une entreprise mure d'une ligne d'annuaire.
 */
export async function searchAndEnrich(
  criteria: SearchCriteria,
): Promise<SearchOutcome | { error: string }> {
  const limit = clampAnalysisLimit(criteria.limit ?? DEFAULT_ANALYSIS_LIMIT);
  const scanWidth = clampScanWidth(criteria.scanWidth ?? DEFAULT_SCAN_WIDTH);

  const search = await searchCompanies(criteria, scanWidth);
  if (!search.ok) return { error: search.error };

  const candidates = search.data.companies.slice(0, scanWidth);

  // Sans Linkup on ne sait pas qui est chaud. Plutot que d'ouvrir des fiches
  // Pappers au hasard — l'erreur que cette refonte corrige — on ne depense rien.
  if (!hasLinkupKey()) {
    return {
      results: [],
      total: search.data.total,
      scanned: 0,
      withSignal: 0,
      analysed: 0,
      warnings: [
        {
          source: "linkup",
          message:
            "clé absente : impossible de repérer les entreprises actives, aucune fiche n'a été ouverte",
        },
      ],
    };
  }

  // --- PHASE 1 : scan large, bon marche -----------------------------------
  const scanned = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, scanSignals);
  const scanWarnings = scanned
    .map((item) => item.warning)
    .filter((warning): warning is EnrichmentWarning => Boolean(warning));

  const hot = scanned
    .filter((item) => hasProvenSignal(item.signals))
    .sort((a, b) =>
      compareHeat(
        heatScore(a.signals, { seed: a.base.company_name }),
        heatScore(b.signals, { seed: b.base.company_name }),
      ),
    );

  // --- PHASE 2 : enrichissement des seuls gagnants -------------------------
  const results = await mapWithConcurrency(hot.slice(0, limit), CONCURRENCY, (item) =>
    deepEnrich({ ...item.base, website: item.base.website ?? item.website }, item.signals),
  );

  return {
    results,
    total: search.data.total,
    scanned: candidates.length,
    withSignal: hot.length,
    analysed: results.length,
    warnings: dedupeWarnings(results, scanWarnings),
  };
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
function dedupeWarnings(
  companies: EnrichedCompany[],
  extra: EnrichmentWarning[] = [],
): EnrichmentWarning[] {
  const seen = new Map<string, EnrichmentWarning>();
  for (const warning of [...companies.flatMap((company) => company.warnings), ...extra]) {
    seen.set(`${warning.source}:${warning.message}`, warning);
  }
  return [...seen.values()];
}

export { toDomain };
export {
  clampAnalysisLimit,
  clampScanWidth,
  DEFAULT_ANALYSIS_LIMIT,
  DEFAULT_SCAN_WIDTH,
  MAX_ANALYSIS_LIMIT,
  MAX_SCAN_WIDTH,
  MIN_SCAN_WIDTH,
} from "./limits";
export type { CompanyBase, EnrichedCompany, EnrichmentWarning, SearchCriteria };

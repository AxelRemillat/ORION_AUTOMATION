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
import { resolveZone, type ResolvedZone } from "./geo";
import {
  filterCandidates,
  pagePlan,
  plannedPages,
  scanBudget,
  searchSeed,
  shouldContinue,
  STOP_LABELS,
  type ScanStop,
} from "./scan-plan";
import { fetchPappers, hasPappersKey } from "./pappers";
import { fetchWebResults, hasLinkupKey } from "./linkup";
import { guessOwnWebsite, hasProvenSignal, qualifyWebResults, structuralSignals } from "./signals";
import { effectifFloor } from "./naf";
import { extractSignals, type Extraction } from "./extract";
import { extractionToSignals, mergeSignals } from "./structured-signals";
import { checkJobPosting } from "./job-posting";
import { assessGroup } from "./group";
import { coverSite, looksLikeDomain, type SiteCoverage } from "./site";
import type { PappersRepresentative } from "./pappers";
import type { WebResult } from "./linkup";
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
  if (base.leader_person) figures.leader_person = base.leader_person;
  if (base.parent_company) figures.parent_company = base.parent_company;
  if (base.figures.founded_on) figures.founded_on = base.figures.founded_on;
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
  /**
   * Resultats web bruts du scan. Conserves pour la phase 2 : l'extraction
   * structuree travaille sur ces textes, et les re-demander couterait une
   * seconde recherche Linkup par entreprise.
   */
  web: WebResult[];
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
    return {
      base,
      website: null,
      signals: [],
      web: [],
      warning: { source: "linkup", message: web.error },
    };
  }

  // Le site officiel retrouve ici sert deux fois : il ancre la qualification
  // (sans lui on perd la moitie de la confiance d'un signal), et il evite plus
  // tard a Hunter de chercher le domaine.
  const website = base.website ?? guessOwnWebsite(base.company_name, web.data);
  const signals = qualifyWebResults(web.data, { name: base.company_name, website });

  return { base, website, signals, web: web.data };
}

/**
 * PHASE 2 — enrichissement profond. C'est ici que tout se joue.
 *
 * Quatre depenses, dans cet ordre, et uniquement sur les entreprises retenues
 * par le scan (donc dans la limite de `clampAnalysisLimit`) :
 *
 *   1. PAPPERS (1 credit) — finances, effectif reel, representants legaux.
 *   2. SITE OFFICIEL (gratuit, repli Linkup a 0,001 $) — decouverte ordonnee,
 *      validation que la page parle bien de cette entreprise, 3 pages au plus.
 *   3. EXTRACTION (1 appel LLM leger) — signaux structures, dates calculees,
 *      citations verifiees, groupe parent.
 *   4. HOLDING (1 credit Pappers, en cache 30 jours) — seulement si un
 *      representant est une personne morale : c'est la qu'on retrouve le
 *      dirigeant personne physique et la taille du groupe.
 */
async function deepEnrich(
  base: CompanyBase,
  webSignals: ProspectSignal[],
  webResults: WebResult[] = [],
): Promise<EnrichedCompany> {
  const warnings: EnrichmentWarning[] = [];
  const company = { ...base };
  const keyFigures = baseKeyFigures(base);

  // --- 1. Pappers ---------------------------------------------------------
  let legalRepresentatives: PappersRepresentative[] = [];
  let pappersWebsite: string | null = null;

  if (base.siren && hasPappersKey()) {
    const pappers = await fetchPappers(base.siren);
    if (pappers.ok) {
      const data = pappers.data;
      pappersWebsite = data.website;
      legalRepresentatives = data.representatives;
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

  // --- 2. Site officiel ---------------------------------------------------
  const site: SiteCoverage = await coverSite({
    name: base.company_name,
    siren: base.siren,
    city: base.city,
    postalCode: base.postal_code,
    pappersWebsite,
    knownWebsite: company.website,
    contactEmail: company.email,
  });

  // Un site non valide (adresse IP, libelle sans extension) vaut mieux absent :
  // il serait affiche tel quel et lu par le modele comme une source.
  const fallbackSite = [company.website, pappersWebsite].find((candidate) =>
    looksLikeDomain(toDomain(candidate ?? null)),
  );
  company.website = site.url ?? fallbackSite ?? null;
  keyFigures.site_status = site.status;
  if (site.status === "non trouvé") {
    warnings.push({
      source: "linkup",
      message: site.note ?? "site officiel introuvable : modèle économique non confirmé",
    });
  }

  // --- 3. Extraction structuree -------------------------------------------
  let extraction: Extraction | null = null;
  // Le site officiel passe EN PREMIER. L'extraction travaille sous budget de
  // contexte : quand les extraits web etaient en tete, ils le consommaient et
  // les pages du site — les seules a porter les offres d'emploi — arrivaient
  // tronquees ou pas du tout.
  const documents = [
    ...site.pages.map((page) => ({
      url: page.url,
      title: base.company_name,
      content: page.text,
      sourceDate: null,
    })),
    ...webResults.map((result) => ({
      url: result.url,
      title: result.title,
      content: result.snippet,
      sourceDate: result.date ?? null,
    })),
  ];

  if (documents.length) {
    try {
      extraction = await extractSignals(
        {
          name: base.company_name,
          siren: base.siren,
          city: base.city,
          postalCode: base.postal_code,
          website: company.website,
        },
        documents,
      );
    } catch (error) {
      warnings.push({
        source: "openai",
        message: `extraction indisponible : ${error instanceof Error ? error.message : "erreur"}`,
      });
    }
  }

  if (extraction && extraction.siteSummary) {
    keyFigures.site_offer = extraction.siteSummary.offer;
    keyFigures.site_customers = extraction.siteSummary.customers;
    keyFigures.site_vocabulary = extraction.siteSummary.vocabulary;
  }

  // --- 4. Groupe et dirigeant derriere la holding -------------------------
  const group = await assessGroup({
    representatives: legalRepresentatives,
    knownLeaderPerson: base.leader_person,
    parentGroup: extraction ? extraction.parentGroup : null,
    allowHoldingLookup: hasPappersKey(),
  });

  if (group.leaderPerson) {
    company.leader_person = group.leaderPerson;
    keyFigures.leader_person = group.leaderPerson;
  }
  if (group.leaderVia) keyFigures.leader_via = group.leaderVia;
  if (group.leaderRole) keyFigures.leader_role = group.leaderRole;
  if (group.parentCompany) {
    company.parent_company = group.parentCompany;
    keyFigures.parent_company = group.parentCompany;
  }
  if (group.parentGroup) {
    keyFigures.parent_group = group.parentGroup;
    if (group.parentGroupQuote) keyFigures.parent_group_quote = group.parentGroupQuote;
    if (group.parentGroupUrl) keyFigures.parent_group_url = group.parentGroupUrl;
  }
  keyFigures.is_large_group_subsidiary = group.isLargeGroupSubsidiary;
  if (group.evidence.length) keyFigures.group_evidence = group.evidence;

  // --- 5. Verification des offres d'emploi --------------------------------
  // On relit la page de chaque offre : une annonce dont `validThrough` est
  // passe ne prouve plus rien, et une annonce sans date mais toujours servie
  // sur le domaine officiel merite mieux que zero.
  if (extraction?.jobPostings.length) {
    const checked = await mapWithConcurrency(extraction.jobPostings, 3, async (posting) => {
      const verdict = await checkJobPosting(posting.url, company.website);
      return {
        ...posting,
        postedAt: posting.postedAt ?? verdict.datePosted,
        dateBasis: posting.postedAt ? posting.dateBasis : verdict.datePosted ? "source" : posting.dateBasis,
        freshness: verdict.freshness,
      };
    });
    extraction = { ...extraction, jobPostings: checked };
  }

  // --- Fusion des signaux -------------------------------------------------
  const structured = extraction ? extractionToSignals(extraction) : [];
  const webMerged = mergeSignals(structured, webSignals);
  const signals = [...webMerged, ...structuralSignals(company, keyFigures.headcount)].slice(0, 8);

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

  let webResults: WebResult[] = [];
  if (options.withSignals !== false) {
    if (hasLinkupKey()) {
      const scan = await scanSignals(base);
      webSignals = scan.signals;
      webResults = scan.web;
      if (scan.warning) warnings.push(scan.warning);
      if (scan.website) identity = { ...base, website: base.website ?? scan.website };
    } else {
      warnings.push({ source: "linkup", message: "clé absente : signaux web non récupérés" });
    }
  }

  const enriched = await deepEnrich(identity, webSignals, webResults);
  return { ...enriched, warnings: [...warnings, ...enriched.warnings] };
}

/** Ce que la recherche par criteres rapporte, depenses comprises. */
export interface SearchOutcome {
  /** Uniquement des entreprises porteuses d'un signal, enrichies en profondeur. */
  results: EnrichedCompany[];
  /** Entreprises correspondant aux criteres dans l'annuaire. */
  total: number;
  /** `true` quand l'annuaire plafonne son total : « plus de 10 000 ». */
  totalCapped: boolean;
  /** Zone reellement appliquee (« Paris (75) »), ou null si aucune. */
  zoneLabel: string | null;
  /** Candidats reellement passes au scan Linkup. */
  scanned: number;
  /** Parmi eux, ceux portant au moins un signal atteste. */
  withSignal: number;
  /** Enrichissements profonds (Pappers) reellement effectues. */
  analysed: number;
  /** Entreprises ecartees parce que deja vues (prospects, favoris, scan < 30 j). */
  skippedKnown: number;
  /** Pages d'annuaire lues pour y arriver. */
  pagesRead: number;
  /** Pourquoi la boucle s'est arretee, en clair. */
  stopReason: string;
  warnings: EnrichmentWarning[];
}

/** Ce que la route fournit a l'orchestrateur en plus des criteres. */
export interface SearchContext {
  /** SIREN a ne pas rescanner : deja en portefeuille ou vus recemment. */
  exclude?: ReadonlySet<string>;
  /** Journalise les entreprises scannees (table `scan_history`). */
  onScanned?: (rows: { siren: string; company_name: string; had_signal: boolean }[]) => Promise<void>;
  /** Date du jour, injectee pour rendre la graine testable. */
  today?: string;
}

/**
 * Mode A — recherche par criteres, en deux phases.
 *
 * `withSignals` n'est plus lu ici : le scan EST la recherche. Sans lui, rien
 * ne permettrait de distinguer une entreprise mure d'une ligne d'annuaire.
 */
export async function searchAndEnrich(
  criteria: SearchCriteria,
  context: SearchContext = {},
): Promise<SearchOutcome | { error: string }> {
  const limit = clampAnalysisLimit(criteria.limit ?? DEFAULT_ANALYSIS_LIMIT);
  const scanWidth = clampScanWidth(criteria.scanWidth ?? DEFAULT_SCAN_WIDTH);
  const warnings: EnrichmentWarning[] = [];

  // --- Zone : resolue AVANT tout appel a l'annuaire ------------------------
  let zone: ResolvedZone | null = null;
  if (criteria.zone?.trim()) {
    const resolved = await resolveZone(criteria.zone);
    // Une zone saisie mais introuvable est une erreur de l'utilisateur, pas un
    // detail : on refuse plutot que de chercher dans la France entiere.
    if (!resolved.ok) return { error: resolved.error };
    zone = resolved.data;
  }

  // --- Premiere page : elle donne le total, donc le nombre de pages --------
  const first = await searchCompanies(criteria, scanWidth, { zone, page: 1 });
  if (!first.ok) return { error: first.error };

  const emptyOutcome = (stop: ScanStop): SearchOutcome => ({
    results: [],
    total: first.ok ? first.data.total : 0,
    totalCapped: first.ok ? first.data.capped : false,
    zoneLabel: zone?.label ?? null,
    scanned: 0,
    withSignal: 0,
    analysed: 0,
    skippedKnown: 0,
    pagesRead: 1,
    stopReason: STOP_LABELS[stop],
    warnings,
  });

  // Sans Linkup on ne sait pas qui est chaud. Plutot que d'ouvrir des fiches
  // Pappers au hasard — l'erreur que cette refonte corrige — on ne depense rien.
  if (!hasLinkupKey()) {
    warnings.push({
      source: "linkup",
      message:
        "clé absente : impossible de repérer les entreprises actives, aucune fiche n'a été ouverte",
    });
    return emptyOutcome("annuaire");
  }

  // --- Plan de lecture : des pages variees, mais reproductibles dans la journee
  const today = context.today ?? new Date().toISOString().slice(0, 10);
  const seed = searchSeed(
    [criteria.q, criteria.section, (criteria.tranches ?? []).join(","), zone?.value, scanWidth, limit],
    today,
  );
  const budget = scanBudget(scanWidth);
  const maxPages = plannedPages(budget, scanWidth, first.data.pages);
  const plan = pagePlan(seed, first.data.pages, maxPages);

  const exclude = context.exclude ?? new Set<string>();
  const seen = new Set<string>();
  let skippedKnown = 0;
  let pagesRead = 0;
  let stop: ScanStop = "annuaire";

  type Scanned = Awaited<ReturnType<typeof scanSignals>>;
  const hot: Scanned[] = [];
  let scannedCount = 0;

  for (const page of plan) {
    const check = shouldContinue(
      { scanned: scannedCount, withSignal: hot.length, pagesRead },
      limit,
      budget,
      plan.length,
    );
    if (!check.go) {
      stop = check.stop;
      break;
    }

    const search = page === 1 ? first : await searchCompanies(criteria, scanWidth, { zone, page });
    pagesRead += 1;
    if (!search.ok) {
      warnings.push({ source: "gouv", message: `page ${page} illisible : ${search.error}` });
      continue;
    }

    // Deduplication : deja en portefeuille, deja en favori, ou deja scanne.
    const filtered = filterCandidates(search.data.companies, { exclude, seen });
    skippedKnown += filtered.skippedKnown;
    const candidates = filtered.kept;
    if (!candidates.length) continue;

    // On ne depasse jamais le budget, meme au milieu d'un lot.
    const room = Math.max(0, budget - scannedCount);
    const batch = candidates.slice(0, room);
    if (!batch.length) {
      stop = "plafond";
      break;
    }

    const scanned = await mapWithConcurrency(batch, SCAN_CONCURRENCY, scanSignals);
    scannedCount += batch.length;

    for (const item of scanned) {
      if (item.warning) warnings.push(item.warning);
      if (hasProvenSignal(item.signals)) hot.push(item);
    }

    // Memoire du scan : ecrite lot par lot, pour qu'un abandon en cours de
    // route ne fasse pas rescanner ce qu'on vient de payer.
    if (context.onScanned) {
      // Mesurer ne doit jamais casser ce qu'on mesure : si la table n'est pas
      // encore migree, le scan continue, il sera juste moins econome demain.
      await context.onScanned(
        batch
          .filter((company): company is typeof company & { siren: string } => Boolean(company.siren))
          .map((company, index) => ({
            siren: company.siren,
            company_name: company.company_name,
            had_signal: hasProvenSignal(scanned[index]?.signals ?? []),
          })),
      ).catch((cause) => {
        warnings.push({
          source: "gouv",
          message: `historique de scan non enregistré : ${cause instanceof Error ? cause.message : "erreur"}`,
        });
      });
    }
  }

  // Le plan epuise sans atteindre l'objectif : on le dit tel quel.
  if (hot.length >= limit) stop = "objectif";
  else if (scannedCount >= budget) stop = "plafond";

  // --- PHASE 2 : enrichissement des seuls gagnants -------------------------
  hot.sort((a, b) =>
    compareHeat(
      // Au scan, on n'a pas encore ouvert de fiche : pas de contexte groupe.
      heatScore(a.signals, { seed: a.base.company_name }),
      heatScore(b.signals, { seed: b.base.company_name }),
    ),
  );

  const results = await mapWithConcurrency(hot.slice(0, limit), CONCURRENCY, (item) =>
    deepEnrich(
      { ...item.base, website: item.base.website ?? item.website },
      item.signals,
      item.web,
    ),
  );

  return {
    results,
    total: first.data.total,
    totalCapped: first.data.capped,
    zoneLabel: zone?.label ?? null,
    scanned: scannedCount,
    withSignal: hot.length,
    analysed: results.length,
    skippedKnown,
    pagesRead,
    stopReason: STOP_LABELS[stop],
    warnings: dedupeWarnings(results, warnings),
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

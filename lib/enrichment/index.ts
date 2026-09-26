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
import { bracketOfTranches, checkBracket, outOfBracketReason } from "./headcount";
import { exclusionOf } from "@/lib/signals/targeting";
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
import { fetchWebResults, LINKUP_CONCURRENCY, hasLinkupKey } from "./linkup";
import { guessOwnWebsite, hasProvenSignal, qualifyWebResults, structuralSignals } from "./signals";
import { effectifFloor } from "./naf";
import { extractSignals, type Extraction } from "./extract";
import { extractionToSignals, mergeSignals } from "./structured-signals";
import { checkJobPosting } from "./job-posting";
import { assessGroup } from "./group";
import { attachSignals } from "./entity-match";
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
export const ENRICH_CONCURRENCY = 4;
const CONCURRENCY = ENRICH_CONCURRENCY;
/**
 * Concurrence du scan.
 *
 * Abaissee de 6 a 3 : chaque candidat declenche un appel Linkup ET, en
 * cascade, des lectures de site. A 6 en parallele sur 60 candidats, l'annuaire
 * repondait 429 (« page 463/41/57 illisible »). Le limiteur de debit protege
 * deja l'annuaire ; borner la concurrence protege les autres sources.
 */
// Concurrence du scan = celle de Linkup, mesuree, et distincte du limiteur de
// l'annuaire (qui ne vaut que pour recherche-entreprises.api.gouv.fr).
const SCAN_CONCURRENCY = LINKUP_CONCURRENCY;

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
export interface DeepEnrichOptions {
  /**
   * Signaux dont le rattachement est deja prouve en amont (SIREN d'une annonce
   * officielle). Ils contournent l'anti-homonymie, qui ne sait juger que des
   * preuves textuelles, et sortent en premier.
   */
  attachedSignals?: ProspectSignal[];
}

/**
 * Exporte parce que le mode « Signaux d'abord » (`lib/signals`) rejoue
 * exactement cette phase 2 : une fois l'entreprise identifiée, ouvrir la fiche
 * ne dépend plus de la façon dont on l'a trouvée. La dupliquer aurait fait
 * diverger deux chemins qui doivent coûter et rendre la même chose.
 */
export async function deepEnrich(
  base: CompanyBase,
  webSignals: ProspectSignal[],
  webResults: WebResult[] = [],
  options: DeepEnrichOptions = {},
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
    revenueEur: keyFigures.revenue_eur ?? null,
    headcount: keyFigures.headcount ?? null,
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
  // Anti-homonymie : un signal qui ne porte ni le SIREN, ni le domaine
  // verifie, ni la denomination exacte n'est pas celui du prospect. S'il
  // nomme une entite voisine liee par un lien capitalistique prouve, il
  // devient un signal de groupe ; sinon il est ecarte.
  const attachment = attachSignals(
    mergeSignals(structured, webSignals),
    {
      name: base.company_name,
      siren: base.siren,
      website: site.status === "non trouvé" ? null : company.website,
    },
    {
      parentCompany: group.parentCompany,
      parentGroup: group.parentGroup,
      parentGroupQuote: group.parentGroupQuote,
    },
  );
  for (const rejected of attachment.rejected.filter((item) => item.reason === "homonyme probable")) {
    warnings.push({
      source: "linkup",
      message: `signal écarté, homonyme probable : ${rejected.entity ?? rejected.label}`,
    });
  }
  if (attachment.foreignEntities.length) keyFigures.foreign_entities = attachment.foreignEntities;
  // Les signaux officiels passent AVANT l'anti-homonymie et en tete de liste.
  // Le controle leur serait nuisible : une annonce BODACC est rattachee par son
  // SIREN, pas par la presence de la denomination dans un texte — elle etait
  // donc systematiquement rejetee comme « homonyme probable ». Et ils passent en
  // tete parce qu'un evenement date au registre prime sur un resultat web.
  const signals = [
    ...(options.attachedSignals ?? []),
    ...attachment.kept,
    ...structuralSignals(company, keyFigures.headcount),
  ].slice(0, 8);

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
  /**
   * Entreprises dont l'appel Linkup a echoue : elles ne sont NI chaudes NI
   * froides, on ne sait rien d'elles. Les confondre avec « sans signal »
   * faisait passer une panne reseau pour un marche vide.
   */
  unverified: number;
  /** Entreprises ecartees parce que deja vues (prospects, favoris, scan < 30 j). */
  skippedKnown: number;
  /**
   * Entreprises enrichies puis ECARTEES parce que leur effectif reel sort de
   * la tranche demandee. Une ligne par entreprise, affichee dans le detail.
   */
  outOfBracket: string[];
  /**
   * Entreprises ecartees par le CIBLAGE, pas par la tranche : association,
   * organisme public, entreprise individuelle sans salarie, secteur exclu.
   * Comptees a part pour qu'un resultat maigre ne passe pas pour un marche
   * vide alors que c'est un reglage qui filtre.
   */
  excluded: string[];
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
  /** Prefixes NAF ecartes, tels que regles par l'utilisateur. */
  excludedSectors?: readonly string[];
  /** Passe outre le ciblage, pour une recherche ponctuelle. */
  includeExcluded?: boolean;
  /**
   * Avancement, appele apres chaque lot.
   *
   * Le scan n'a pas a savoir ou va cette information : la route l'ecrit dans
   * `search_runs`, les tests la collectent en memoire.
   */
  onProgress?: (progress: ScanProgress) => Promise<void>;
  /**
   * Demande d'arret, relue entre deux lots. On ne coupe jamais au milieu d'un
   * lot : les appels sont deja payes, autant en garder le resultat.
   */
  shouldStop?: () => Promise<boolean>;
}

/** Ce que l'ecran affiche pendant qu'un scan tourne. */
export interface ScanProgress {
  /** jsonb en base : la forme doit rester assignable a un objet libre. */
  [key: string]: unknown;
  /**
   * Laquelle des deux phases tourne. L'ecran en a besoin pour choisir sur quoi
   * appuyer la barre : les pages ne bougent plus une fois le scan fini, et une
   * barre immobile pendant que les fiches s'ouvrent se lit comme un gel.
   */
  phase: ScanPhase;
  /** Pages d'annuaire lues et prevues. */
  pagesRead: number;
  pagesPlanned: number;
  scanned: number;
  withSignal: number;
  analysed: number;
  /** Fiches visees : le plafond demande, borne par les entreprises a signal. */
  analysedPlanned: number;
  /** Etape en clair, deja redigee pour l'ecran. */
  step: string;
}

export type ScanPhase = "annuaire" | "fiches";

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
    unverified: 0,
    skippedKnown: 0,
    outOfBracket: [],
    excluded: [],
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
  // « Aller plus loin si besoin » decoche : on s'arrete au nombre demande.
  const budget = criteria.goFurther === false ? scanWidth : scanBudget(scanWidth);
  const maxPages = plannedPages(first.data.pages);
  const plan = pagePlan(seed, first.data.pages, maxPages);

  const exclude = context.exclude ?? new Set<string>();
  const seen = new Set<string>();
  let skippedKnown = 0;
  let pagesRead = 0;
  let stop: ScanStop = "annuaire";

  type Scanned = Awaited<ReturnType<typeof scanSignals>>;
  const hot: Scanned[] = [];
  let scannedCount = 0;
  /** Entreprises dont l'appel Linkup a echoue : ni chaudes, ni froides. */
  let unverified = 0;

  for (const page of plan) {
    if (context.shouldStop && (await context.shouldStop())) {
      stop = "arrete";
      break;
    }

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

    for (const item of scanned) {
      if (item.warning) {
        // Un appel perdu n'est PAS une entreprise sans signal : on ne sait
        // simplement rien d'elle. La compter comme froide serait un mensonge.
        unverified += 1;
        warnings.push(item.warning);
        continue;
      }
      scannedCount += 1;
      if (hasProvenSignal(item.signals)) hot.push(item);
    }

    await context.onProgress?.({
      phase: "annuaire",
      pagesRead,
      pagesPlanned: plan.length,
      scanned: scannedCount,
      withSignal: hot.length,
      analysed: 0,
      analysedPlanned: limit,
      step: `Lecture de l'annuaire ${pagesRead}/${plan.length}`,
    });

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

  // --- PHASE 2 : enrichissement, puis controle de la tranche ---------------
  //
  // L'annuaire filtre bien sur la tranche INSEE, mais celle-ci est parfois
  // absente (« NN ») ou perimee. Pappers donne l'effectif reel : c'est LUI qui
  // fait foi une fois la fiche ouverte. Sans ce controle, une recherche
  // « 10 a 49 salaries » rendait des entreprises de 99 et 199 personnes.
  const bracket = bracketOfTranches(criteria.tranches);
  const outOfBracket: string[] = [];
  const excluded: string[] = [];
  const results: EnrichedCompany[] = [];

  // Ciblage applique AVANT la phase 2 : une association ou une auto-ecole ne
  // doit pas consommer un appel Pappers. Le meme module sert aux deux modes,
  // pour qu'un reglage ne puisse pas valoir dans l'un et pas dans l'autre.
  const targeted = context.includeExcluded
    ? hot
    : hot.filter((item) => {
        const exclusion = exclusionOf(item.base, context.excludedSectors ?? []);
        if (exclusion) excluded.push(exclusion.reason);
        return !exclusion;
      });

  // On pioche au-dela du plafond pour pouvoir remplacer les ecartees : une
  // entreprise hors tranche ne doit pas consommer une place de fiche.
  const queue = targeted.slice(0, Math.min(targeted.length, limit * 2));

  // Cible affichee : on ne promet pas cinq fiches si le scan n'a trouve que
  // deux entreprises a signal.
  const analysedPlanned = Math.min(limit, queue.length);
  const reportEnrich = (step: string) =>
    context.onProgress?.({
      phase: "fiches",
      pagesRead,
      pagesPlanned: plan.length,
      scanned: scannedCount,
      withSignal: hot.length,
      analysed: results.length,
      analysedPlanned,
      step,
    });

  if (queue.length) await reportEnrich("Ouverture des fiches");

  for (let index = 0; index < queue.length && results.length < limit; index += CONCURRENCY) {
    const batch = queue.slice(index, index + CONCURRENCY);
    const enriched = await mapWithConcurrency(batch, CONCURRENCY, (item) =>
      deepEnrich(
        { ...item.base, website: item.base.website ?? item.website },
        item.signals,
        item.web,
      ),
    );

    for (const company of enriched) {
      if (results.length >= limit) break;
      const headcount =
        typeof company.key_figures.headcount === "number" ? company.key_figures.headcount : null;
      if (bracket && checkBracket(headcount, bracket) === "hors tranche") {
        outOfBracket.push(outOfBracketReason(company.company_name, headcount, bracket));
        continue;
      }
      results.push(company);
    }

    await reportEnrich(`Ouverture des fiches ${results.length}/${analysedPlanned}`);
  }

  return {
    results,
    total: first.data.total,
    totalCapped: first.data.capped,
    zoneLabel: zone?.label ?? null,
    scanned: scannedCount,
    withSignal: hot.length,
    analysed: results.length,
    unverified,
    skippedKnown,
    outOfBracket,
    excluded,
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

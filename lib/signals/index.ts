import { frenchDate } from "@/lib/enrichment/dates";
import { searchCompanies } from "@/lib/enrichment/gouv";
import { mapWithConcurrency } from "@/lib/enrichment/http";
import { ENRICH_CONCURRENCY, deepEnrich } from "@/lib/enrichment";
import { bracketOfTranches, checkBracket } from "@/lib/enrichment/headcount";
import { effectifLabel } from "@/lib/enrichment/naf";
import type { CompanyBase, EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import type { ProspectSignal } from "@/types";
import { recentNotices, type BodaccNotice } from "./bodacc";
import { DEFAULT_SIGNAL_DAYS, type SignalSourceId, type SignalSourceState } from "./shared";
import {
  franceTravailStatus,
  recentJobSignals,
  type EnvLike,
  type FranceTravailStatus,
  type JobSignal,
} from "./france-travail";

/**
 * Mode « Signaux d'abord » — l'entonnoir pris par l'autre bout.
 *
 * Le mode par critères part de l'annuaire (« qui ressemble à ma cible ? ») et
 * cherche ensuite un événement sur le web. Il paie donc un scan pour chaque
 * entreprise, y compris celles qui ne bougent pas — et la mesure du 25/09 le
 * disait crûment : 20 entreprises scannées pour 3 signaux.
 *
 * Ici on part de l'événement : on lit les sources officielles, qui sont
 * gratuites et datées, et on ne va chercher une identité QUE pour les
 * entreprises qui ont bougé. Un signal officiel n'a pas besoin d'ancrage ni de
 * seuil de confiance : il est publié par un greffe ou par l'entreprise
 * elle-même. C'est pour ça qu'il pèse plus lourd qu'un résultat web.
 *
 * Chiffres mesurés sur le Rhône, 60 jours (25/09/2026), qui justifient les
 * bornes ci-dessous :
 *   - 3 993 annonces BODACC dans les familles retenues ;
 *   - 76 % sont des personnes morales exploitables ;
 *   - **12,5 % d'entre elles sont en 10-49 salariés**, et 60 % ont une tranche
 *     `NN` (non déclarée) que seul Pappers peut trancher.
 */

export type { SignalSourceId, SignalSourceState } from "./shared";
export { DEFAULT_SIGNAL_DAYS } from "./shared";

/**
 * Identités à résoudre au maximum.
 *
 * L'annuaire est gratuit mais limité à 5 appels/s : 250 recherches, c'est une
 * cinquantaine de secondes, et à 12,5 % de succès ça donne ~30 candidats en
 * tranche — largement de quoi remplir un objectif de 5 fiches.
 */
export const MAX_IDENTITY_LOOKUPS = 250;

/** Annonces ramenées par source. Au-delà, on scanne du vieux pour rien. */
const MAX_NOTICES_PER_SOURCE = 600;

/** Un signal officiel, déjà rattaché à une entreprise nommée. */
export interface OfficialSignal {
  /** SIREN quand la source le donne. BODACC oui, France Travail non. */
  siren: string | null;
  companyName: string;
  city: string | null;
  postalCode: string | null;
  sourceId: SignalSourceId;
  /** Date ISO, toujours présente : c'est la raison d'être de ce mode. */
  date: string;
  signal: ProspectSignal;
}


/**
 * Confiance d'un signal officiel.
 *
 * Volontairement au plafond : la source est un journal officiel ou l'employeur
 * lui-même, et la date vient du champ de publication, pas d'une heuristique sur
 * le texte. Il n'y a rien à ancrer — l'annonce EST la preuve.
 */
const OFFICIAL_CONFIDENCE = 0.98;

/**
 * Confiance d'une offre d'emploi rapprochée par le nom.
 *
 * Plus basse que BODACC, et c'est assumé : une offre ne porte pas de SIREN, le
 * rapprochement se fait sur « nom + commune ». La preuve est bonne, le lien
 * avec CETTE entreprise l'est un peu moins.
 */
const MATCHED_CONFIDENCE = 0.9;

/** Libellé lisible d'une annonce BODACC. */
function bodaccLabel(notice: BodaccNotice): string {
  const base =
    notice.family === "Ventes et cessions"
      ? "Cession de fonds"
      : notice.family === "Modifications diverses"
        ? "Modification au registre"
        : "Immatriculation";
  return notice.nature ? `${base} — ${notice.nature}` : base;
}

function toOfficialSignal(notice: BodaccNotice): OfficialSignal {
  return {
    siren: notice.siren,
    companyName: notice.companyName,
    city: notice.city,
    postalCode: notice.postalCode,
    sourceId: "bodacc",
    date: notice.publishedAt,
    signal: {
      type: notice.signalType,
      label: `${bodaccLabel(notice)} (${frenchDate(notice.publishedAt)})`,
      url: notice.url,
      date: notice.publishedAt,
      source: "BODACC",
      dateBasis: "source",
      confidence: OFFICIAL_CONFIDENCE,
      // La citation est le libellé officiel : il n'y a pas de phrase à extraire
      // d'une page web, l'annonce est déjà normalisée par le greffe.
      quote: notice.nature ?? notice.family,
    },
  };
}

function jobToOfficialSignal(job: JobSignal): OfficialSignal {
  return {
    siren: null,
    companyName: job.companyName,
    city: job.city,
    postalCode: job.postalCode,
    sourceId: "france-travail",
    date: job.publishedAt,
    signal: {
      type: "recrutement",
      label: `Recrutement : ${job.title} (${frenchDate(job.publishedAt)})`,
      url: job.url,
      date: job.publishedAt,
      source: "France Travail",
      dateBasis: "source",
      confidence: MATCHED_CONFIDENCE,
      quote: job.title,
    },
  };
}

export interface SignalSearchCriteria {
  /** Numéro de département. Obligatoire : les deux sources filtrent dessus. */
  departement: string;
  /** Codes de tranche d'effectif visés (`["11", "12"]`). */
  tranches: string[];
  /** Fenêtre d'antériorité, en jours. */
  days?: number;
  /** Fiches à ouvrir au maximum. */
  limit: number;
  today?: Date;
  env?: EnvLike;
}

export interface CollectedSignals {
  /** Signaux datés, du plus récent au plus ancien. */
  signals: OfficialSignal[];
  sources: SignalSourceState[];
  warnings: EnrichmentWarning[];
}

/** État des sources sans rien appeler : sert à griser l'écran au chargement. */
export function sourceStates(env: EnvLike = process.env): SignalSourceState[] {
  const ft: FranceTravailStatus = franceTravailStatus(env);
  return [
    { id: "bodacc", label: "BODACC", available: true, count: 0 },
    {
      id: "france-travail",
      label: "Offres France Travail",
      available: ft.available,
      ...(ft.available ? {} : { unavailableReason: ft.reason }),
      count: 0,
    },
  ];
}

/**
 * Lit les deux sources et rend leurs signaux fusionnés.
 *
 * Une source indisponible ne fait pas échouer la recherche : elle est signalée
 * telle quelle et le mode tourne avec ce qui reste. C'est la même règle que
 * partout ailleurs dans l'app — une clé manquante dégrade, elle ne casse pas.
 */
export async function collectSignals(criteria: SignalSearchCriteria): Promise<CollectedSignals> {
  const env = criteria.env ?? process.env;
  const days = criteria.days ?? DEFAULT_SIGNAL_DAYS;
  const warnings: EnrichmentWarning[] = [];
  const sources = sourceStates(env);
  const signals: OfficialSignal[] = [];

  const bodacc = await recentNotices({
    departement: criteria.departement,
    days,
    max: MAX_NOTICES_PER_SOURCE,
    today: criteria.today,
  });

  const bodaccState = sources.find((source) => source.id === "bodacc");
  if (bodacc.ok) {
    for (const notice of bodacc.data) signals.push(toOfficialSignal(notice));
    if (bodaccState) bodaccState.count = bodacc.data.length;
  } else {
    warnings.push({ source: "gouv", message: bodacc.error });
    if (bodaccState) {
      bodaccState.available = false;
      bodaccState.unavailableReason = bodacc.error;
    }
  }

  const ftState = sources.find((source) => source.id === "france-travail");
  if (ftState?.available) {
    const jobs = await recentJobSignals({
      departement: criteria.departement,
      days: Math.min(days, 30),
      max: MAX_NOTICES_PER_SOURCE,
      today: criteria.today,
      env,
    });
    if (jobs.ok) {
      for (const job of jobs.data) signals.push(jobToOfficialSignal(job));
      ftState.count = jobs.data.length;
    } else {
      warnings.push({ source: "linkup", message: jobs.error });
      ftState.available = false;
      ftState.unavailableReason = jobs.error;
    }
  }

  // Le plus frais d'abord : c'est ce tri qui donne son sens au plafond de
  // résolutions d'identité — on coupe les vieux signaux, jamais les récents.
  signals.sort((a, b) => b.date.localeCompare(a.date));
  return { signals, sources, warnings };
}

/** Rang d'un candidat : confirmé en tranche, ou tranche non déclarée. */
export type CandidateTier = "en-tranche" | "tranche-inconnue";

export interface SignalCandidate {
  base: CompanyBase;
  signals: ProspectSignal[];
  tier: CandidateTier;
  sourceId: SignalSourceId;
}

/**
 * Rang d'un candidat d'après la tranche déclarée à l'annuaire.
 *
 * `NN` (60 % des cas mesurés) n'est PAS un rejet : la tranche est simplement non
 * déclarée, et seul l'effectif réel de Pappers peut trancher. On la garde en
 * second rang, servie uniquement si les confirmés ne suffisent pas — c'est le
 * compromis entre ne rien trouver et payer des fiches au hasard.
 */
export function tierOf(effectifCode: string | null, tranches: readonly string[]): CandidateTier | null {
  if (!effectifCode || effectifCode === "NN") return "tranche-inconnue";
  return tranches.includes(effectifCode) ? "en-tranche" : null;
}

/** Commune comparable : accents, casse et arrondissements mis de côté. */
export function normalizeCity(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+\d+$/, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Le candidat de l'annuaire correspond-il bien au signal ?
 *
 * Pour BODACC la question ne se pose pas : le SIREN fait foi. Pour une offre
 * d'emploi, le rapprochement passe par le nom, donc il faut une confirmation
 * indépendante — la commune. Sans elle, « MARTIN » à Lyon et « MARTIN » à Lille
 * deviendraient la même entreprise, exactement le faux positif que le mode par
 * critères a déjà coûté une fois.
 */
export function confirmsMatch(signal: OfficialSignal, base: CompanyBase): boolean {
  if (signal.siren) return base.siren === signal.siren;

  const signalCity = normalizeCity(signal.city);
  const baseCity = normalizeCity(base.city);
  if (!signalCity || !baseCity) return false;
  if (signalCity !== baseCity) return false;

  // Le nom doit correspondre au-delà de la casse : l'annuaire renvoie le
  // meilleur resultat d'une recherche floue, pas forcement le bon.
  const left = signal.companyName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const right = base.company_name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return left.includes(right) || right.includes(left);
}

export interface ResolveContext {
  /** SIREN déjà connus (portefeuille, corbeille) : on ne les repropose pas. */
  exclude?: Set<string>;
  /** Plafond de recherches annuaire. Baissé dans les tests. */
  maxLookups?: number;
  /** Avancement, appelé après chaque identité résolue. */
  onProgress?: (state: { looked: number; found: number }) => Promise<void>;
  shouldStop?: () => Promise<boolean>;
}

export interface ResolvedCandidates {
  candidates: SignalCandidate[];
  /** Identités effectivement demandées à l'annuaire. */
  lookups: number;
  /** Entreprises écartées parce que déjà connues. */
  skippedKnown: number;
  /** Écartées sur la tranche déclarée à l'annuaire. */
  outOfBracket: string[];
  warnings: EnrichmentWarning[];
}

/**
 * Résout l'identité des entreprises porteuses de signal.
 *
 * S'arrête dès qu'il y a de quoi remplir l'objectif : chaque résolution est un
 * appel, et l'intérêt de ce mode est précisément de n'en payer aucun pour une
 * entreprise qui n'a pas bougé.
 */
export async function resolveCandidates(
  signals: readonly OfficialSignal[],
  criteria: SignalSearchCriteria,
  context: ResolveContext = {},
): Promise<ResolvedCandidates> {
  const exclude = context.exclude ?? new Set<string>();
  const maxLookups = context.maxLookups ?? MAX_IDENTITY_LOOKUPS;
  const bracket = bracketOfTranches(criteria.tranches);

  const confirmed: SignalCandidate[] = [];
  const unknownTranche: SignalCandidate[] = [];
  const outOfBracket: string[] = [];
  const warnings: EnrichmentWarning[] = [];
  const seen = new Set<string>();
  let lookups = 0;
  let skippedKnown = 0;

  // On visera deux fois l'objectif : une entreprise peut encore sortir en
  // phase 2 sur son effectif reel, et il faut de quoi la remplacer.
  const wanted = criteria.limit * 2;

  for (const signal of signals) {
    if (confirmed.length >= wanted || lookups >= maxLookups) break;
    if (context.shouldStop && (await context.shouldStop())) break;

    if (signal.siren && exclude.has(signal.siren)) {
      skippedKnown += 1;
      continue;
    }

    const key = signal.siren ?? `${signal.companyName.toLowerCase()}|${signal.city ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lookups += 1;
    const page = await searchCompanies({ q: signal.siren ?? signal.companyName }, 1);
    if (!page.ok) {
      warnings.push({ source: "gouv", message: page.error });
      continue;
    }

    const [base] = page.data.companies;
    if (!base || !confirmsMatch(signal, base)) continue;
    if (base.siren && exclude.has(base.siren)) {
      skippedKnown += 1;
      continue;
    }

    const effectifCode = base.figures?.effectif_code ?? null;
    const tier = tierOf(effectifCode, criteria.tranches);
    if (!tier) {
      // Message volontairement distinct de celui de la phase 2 : ici la tranche
      // est DÉCLARÉE et hors cible, on n'a pas « un effectif inconnu ».
      const declared = effectifLabel(effectifCode) ?? "tranche non lisible";
      outOfBracket.push(
        `${base.company_name} — ${declared} déclarés à l'annuaire, hors de la tranche demandée` +
          (bracket ? ` (${bracket.label})` : ""),
      );
      continue;
    }

    const candidate: SignalCandidate = {
      base,
      signals: [signal.signal],
      tier,
      sourceId: signal.sourceId,
    };
    if (tier === "en-tranche") confirmed.push(candidate);
    else unknownTranche.push(candidate);

    await context.onProgress?.({ looked: lookups, found: confirmed.length });
  }

  // Les confirmés d'abord, les tranches non déclarées ensuite : c'est l'ordre
  // qui décide où part le budget Pappers.
  const candidates = [...confirmed, ...unknownTranche].slice(0, wanted);
  return { candidates, lookups, skippedKnown, outOfBracket, warnings };
}

/** Verdict d'effectif réel, une fois la fiche ouverte. */
export function keepAfterEnrichment(
  headcount: number | null,
  tranches: readonly string[],
): boolean {
  const bracket = bracketOfTranches(tranches);
  return checkBracket(headcount, bracket) !== "hors tranche";
}

/** Résultat complet du mode « Signaux d'abord ». */
export interface SignalSearchOutcome {
  results: EnrichedCompany[];
  sources: SignalSourceState[];
  /** Signaux datés ramenés par les sources, avant tout rapprochement. */
  signalsFound: number;
  /** Identités demandées à l'annuaire (gratuit, mais limité à 5/s). */
  lookups: number;
  /** Fiches réellement ouvertes chez Pappers : c'est la seule ligne payante. */
  analysed: number;
  skippedKnown: number;
  outOfBracket: string[];
  warnings: EnrichmentWarning[];
}

export interface SignalSearchContext extends ResolveContext {
  onProgress?: (state: { looked: number; found: number }) => Promise<void>;
  /** Avancement de la phase 2, séparé : c'est elle qui coûte. */
  onEnrich?: (state: { analysed: number; planned: number }) => Promise<void>;
}

/**
 * Recherche complète : sources officielles → identité → fiche.
 *
 * L'ordre est l'inverse du mode par critères, et c'est tout l'intérêt : aucune
 * fiche n'est ouverte pour une entreprise qui n'a pas bougé. Le seul poste
 * payant reste `deepEnrich`, et il est borné par `criteria.limit`.
 */
export async function searchBySignals(
  criteria: SignalSearchCriteria,
  context: SignalSearchContext = {},
): Promise<SignalSearchOutcome> {
  const collected = await collectSignals(criteria);
  const resolved = await resolveCandidates(collected.signals, criteria, context);
  const warnings = [...collected.warnings, ...resolved.warnings];

  const results: EnrichedCompany[] = [];
  const outOfBracket = [...resolved.outOfBracket];
  const planned = Math.min(criteria.limit, resolved.candidates.length);

  for (
    let index = 0;
    index < resolved.candidates.length && results.length < criteria.limit;
    index += ENRICH_CONCURRENCY
  ) {
    if (context.shouldStop && (await context.shouldStop())) break;

    const batch = resolved.candidates.slice(index, index + ENRICH_CONCURRENCY);
    const enriched = await mapWithConcurrency(batch, ENRICH_CONCURRENCY, (candidate) =>
      // Le signal est passe en `attachedSignals` et non en signaux web : son
      // rattachement est deja prouve par le SIREN de l'annonce.
      deepEnrich(candidate.base, [], [], { attachedSignals: candidate.signals }),
    );

    for (const company of enriched) {
      if (results.length >= criteria.limit) break;
      const headcount =
        typeof company.key_figures.headcount === "number" ? company.key_figures.headcount : null;
      // L'effectif réel de Pappers fait foi sur la tranche déclarée : c'est
      // lui qui tranche les 60 % de `NN` laissés en second rang.
      if (!keepAfterEnrichment(headcount, criteria.tranches)) {
        outOfBracket.push(
          `${company.company_name} — ${headcount ?? "effectif inconnu"} salariés, hors de la tranche demandée`,
        );
        continue;
      }
      results.push(company);
    }

    await context.onEnrich?.({ analysed: results.length, planned });
  }

  return {
    results,
    sources: collected.sources,
    signalsFound: collected.signals.length,
    lookups: resolved.lookups,
    analysed: results.length,
    skippedKnown: resolved.skippedKnown,
    outOfBracket,
    warnings,
  };
}

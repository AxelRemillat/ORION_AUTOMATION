import { frenchDate } from "@/lib/enrichment/dates";
import { searchCompanies } from "@/lib/enrichment/gouv";
import { mapWithConcurrency } from "@/lib/enrichment/http";
import { ENRICH_CONCURRENCY, deepEnrich } from "@/lib/enrichment";
import { bracketOfTranches, checkBracket } from "@/lib/enrichment/headcount";
import { effectifLabel } from "@/lib/enrichment/naf";
import type { CompanyBase, EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import type { ProspectKeyFigures, ProspectSignal } from "@/types";
import {
  compareNotices,
  groupBySiren,
  recentNotices,
  type BodaccLeader,
  type BodaccNotice,
  type SignalStrength,
} from "./bodacc";
import {
  DEFAULT_SIGNAL_DAYS,
  type ProducingSourceId,
  type SignalSourceId,
  type SignalSourceState,
} from "./shared";
import { STRENGTH_RANK } from "./bodacc-parse";
import { exclusionOf } from "./targeting";
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

export type { ProducingSourceId, SignalSourceId, SignalSourceState } from "./shared";
export { DEFAULT_SIGNAL_DAYS } from "./shared";

/**
 * Identités à résoudre au maximum.
 *
 * L'annuaire est gratuit mais limité à 5 appels/s : 250 recherches, c'est une
 * cinquantaine de secondes, et à 12,5 % de succès ça donne ~30 candidats en
 * tranche — largement de quoi remplir un objectif de 5 fiches.
 */
export const MAX_IDENTITY_LOOKUPS = 250;

/**
 * Annonces ramenées par source.
 *
 * Mesuré : à Paris, 600 annonces BODACC ne couvrent que DEUX jours — le
 * département en publie des centaines par jour. La fenêtre de 60 jours n'était
 * donc pas exploitée, et il ne restait que deux entreprises à tranche confirmée
 * dans tout le lot. 2 000 annonces font 20 pages, gratuites et mises en cache
 * pour la journée : le coût est du temps, quelques secondes, contre un vivier
 * plusieurs fois plus large.
 */
const MAX_NOTICES_PER_SOURCE = 2_000;

/**
 * Renforts retenus en plus du signal principal.
 *
 * Trois annonces en deux mois disent plus qu'une, mais la dixième n'apprend
 * rien : le cumul est donc plafonné. Le score décroît déjà avec le rang
 * (`1 / (1 + 0,4 × rang)`), ce plafond évite seulement d'encombrer la carte.
 */
export const MAX_REINFORCEMENTS = 2;

/** Un signal officiel, déjà rattaché à une entreprise nommée. */
export interface OfficialSignal {
  /** SIREN quand la source le donne. BODACC oui, France Travail non. */
  siren: string | null;
  companyName: string;
  city: string | null;
  postalCode: string | null;
  sourceId: ProducingSourceId;
  /** Date ISO du signal principal : c'est la raison d'être de ce mode. */
  date: string;
  /** Force du signal principal — celle qui décide de l'angle et du tri. */
  strength: SignalStrength;
  /** Signal principal EN PREMIER, puis les renforts. */
  signals: ProspectSignal[];
  /** Dirigeants entrants nommés par l'annonce, pour la rédaction. */
  newLeaders: BodaccLeader[];
  /** Capital déclaré après l'opération, quand l'annonce le donne. */
  capitalAmount: number | null;
  /** Intitulé publié, pour une offre d'emploi. */
  jobTitle: string | null;
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

/*
 * Tuyauterie juridique des annonces de vente et de cession.
 *
 * Le texte officiel d'une cession de fonds ne contient pas que l'evenement :
 * il porte l'adresse de l'ANCIEN proprietaire, le numero de dossier, la
 * reference d'enregistrement et le delai d'opposition. Sur SIAM (75) le
 * 26/09/2026, la citation retenue etait :
 *
 *   « Adresse de l'ancien proprietaire : 28 avenue Matignon 75008 Paris
 *     Date de l'acte : 21/07/26 Enregistre le : 24/07/26 a Paris Saint-Lazare
 *     Dossier 2026 00018436 Reference 7564P61 2026 A 02186 Les oppositions
 *     seront recues »
 *
 * Ce texte partait dans les faits autorises du redacteur. Rien la-dedans ne
 * doit approcher un mail : ni l'adresse d'un tiers, ni un numero de dossier.
 */
const LEGAL_PLUMBING = [
  /adresse de l['’]ancien propri[eé]taire.*/is,
  /date de l['’]acte\s*:.*/is,
  /enregistr[eé]\s+le\s*:.*/is,
  /dossier\s+\d[\d\s]*.*/is,
  /r[eé]f[eé]rence\s+\w+.*/is,
  /les oppositions.*/is,
  /\bsiret\b.*/is,
];

/**
 * Citation d'une annonce officielle, debarrassee de sa tuyauterie.
 *
 * On coupe a la premiere mention administrative : ce qui precede raconte
 * l'evenement, ce qui suit sert au greffe. Quand il ne reste rien de lisible,
 * on retombe sur le libelle normalise — court, vrai, et deja affichable.
 */
export function officialQuote(notice: BodaccNotice): string {
  let text = (notice.nature ?? "").replace(/\s+/g, " ").trim();
  for (const pattern of LEGAL_PLUMBING) text = text.replace(pattern, "").trim();
  text = text.replace(/[\s;:,-]+$/, "").trim();
  return text.length >= 12 ? text : notice.label;
}

/** Une annonce BODACC, au format consommé par le scoring et la fiche. */
export function noticeToSignal(notice: BodaccNotice): ProspectSignal {
  return {
    type: notice.signalType,
    label: `${notice.label} (${frenchDate(notice.publishedAt)})`,
    url: notice.url,
    date: notice.publishedAt,
    source: "BODACC",
    dateBasis: "source",
    confidence: OFFICIAL_CONFIDENCE,
    strength: notice.strength,
    // La citation est le libellé officiel : il n'y a pas de phrase à extraire
    // d'une page web, l'annonce est déjà normalisée par le greffe. Reste à
    // enlever la tuyauterie juridique (cf. `officialQuote`).
    quote: officialQuote(notice),
  };
}

/**
 * Une entreprise et tout ce que BODACC dit d'elle sur la fenêtre.
 *
 * La plus forte annonce donne l'angle, les suivantes ne sont que du renfort —
 * d'où le tri par force puis par date, et le plafond de renforts.
 */
export function toOfficialSignal(notices: readonly BodaccNotice[]): OfficialSignal {
  const sorted = [...notices].sort(compareNotices);
  const main = sorted[0];
  const kept = sorted.slice(0, 1 + MAX_REINFORCEMENTS);

  return {
    siren: main.siren,
    companyName: main.companyName,
    city: main.city,
    postalCode: main.postalCode,
    sourceId: "bodacc",
    date: main.publishedAt,
    strength: main.strength,
    signals: kept.map(noticeToSignal),
    // Les dirigeants entrants de TOUTES les annonces retenues : un changement
    // de gérant et une modification de capital peuvent être deux annonces.
    newLeaders: kept.flatMap((notice) => notice.newLeaders),
    capitalAmount: kept.find((notice) => notice.capitalAmount !== null)?.capitalAmount ?? null,
    jobTitle: null,
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
    // Une offre publiée est un fait daté, déclaré par l'employeur lui-même :
    // c'est aussi engageant qu'une décision au registre.
    strength: "fort",
    signals: [
      {
        type: "recrutement",
        label: `Recrutement : ${job.title} (${frenchDate(job.publishedAt)})`,
        url: job.url,
        date: job.publishedAt,
        source: "France Travail",
        dateBasis: "source",
        confidence: MATCHED_CONFIDENCE,
        strength: "fort",
        quote: job.title,
      },
    ],
    newLeaders: [],
    capitalAmount: null,
    jobTitle: job.title,
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
  /**
   * Restreint la collecte a UNE source.
   *
   * Sert a verifier une source isolement : le tri par force met les annonces
   * BODACC devant, et une offre d'emploi n'atteignait jamais l'ouverture de
   * fiche sur un departement dense. Non expose dans l'ecran de recherche.
   */
  only?: "bodacc" | "france-travail";
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
    {
      // La Bonne Boite v2 demande une autorisation validee A LA MAIN par France
      // Travail sur l'application : le jeton est bien delivre avec le scope
      // `api_labonneboitev2`, mais les endpoints repondent 403. Tant que
      // l'autorisation n'est pas accordee, la source est annoncee telle quelle
      // plutot que tentee a chaque recherche pour echouer.
      id: "labonneboite",
      label: "La Bonne Boite",
      available: false,
      unavailableReason: "non activée",
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

  const bodacc =
    criteria.only === "france-travail"
      ? ({ ok: true, data: [] } as const)
      : await recentNotices({
          departement: criteria.departement,
          days,
          max: MAX_NOTICES_PER_SOURCE,
          today: criteria.today,
        });

  const bodaccState = sources.find((source) => source.id === "bodacc");
  if (bodacc.ok) {
    // Une entreprise = un candidat, quelles que soient ses annonces.
    for (const group of groupBySiren(bodacc.data).values()) {
      signals.push(toOfficialSignal(group));
    }
    if (bodaccState) bodaccState.count = signals.length;
  } else {
    warnings.push({ source: "gouv", message: bodacc.error });
    if (bodaccState) {
      bodaccState.available = false;
      bodaccState.unavailableReason = bodacc.error;
    }
  }

  const ftState = sources.find((source) => source.id === "france-travail");
  if (ftState?.available && criteria.only !== "bodacc") {
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

  // Le plus FORT d'abord, puis le plus frais. Ce tri décide deux choses à la
  // fois : l'ordre des fiches rendues, et où part le budget de résolutions
  // d'identité — on coupe les signaux faibles, jamais les forts.
  //
  // La comparaison porte sur le JOUR, pas sur l'horodatage : BODACC date à la
  // journée (« 2026-09-25 »), France Travail à la seconde
  // (« 2026-09-25T16:05:17Z »). Comparées comme des chaînes, les secondes
  // passaient systématiquement devant — toutes les offres avant tout le BODACC
  // du même jour, ce qui consommait les 250 résolutions d'identité sur la
  // source au plus faible taux de rapprochement. Vu en production sur le 75.
  const day = (signal: OfficialSignal) => signal.date.slice(0, 10);
  signals.sort(
    (a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] || day(b).localeCompare(day(a)),
  );
  return { signals, sources, warnings };
}

/**
 * Activités d'intermédiation sur l'emploi.
 *
 * Ces entreprises publient des offres POUR LEURS CLIENTS. Le filtre par nom
 * (`looksLikeStaffingAgency`) attrape les marques connues ; celui-ci est exact
 * et gratuit, puisque l'annuaire vient de rendre le code NAF. Mesuré sur 12
 * offres du Rhône : FIDERIM, General Emploi et NEXIIUM TALENT passaient le
 * filtre par nom.
 *
 *   78.10Z activités des agences de placement de main-d'œuvre
 *   78.20Z activités des agences de travail temporaire
 *   78.30Z autre mise à disposition de ressources humaines
 */
const STAFFING_NAF = new Set(["7810Z", "7820Z", "7830Z"]);

/** Le code NAF est écrit « 78.20Z » ou « 7820Z » selon la source. */
export function isStaffingNaf(naf: string | null | undefined): boolean {
  if (!naf) return false;
  return STAFFING_NAF.has(naf.replace(/[^0-9A-Za-z]/g, "").toUpperCase());
}

/** Rang d'un candidat : confirmé en tranche, ou tranche non déclarée. */
export type CandidateTier = "en-tranche" | "tranche-inconnue";

export interface SignalCandidate {
  base: CompanyBase;
  /** Signal principal en premier, puis ses renforts. */
  signals: ProspectSignal[];
  /** Force du signal principal : c'est elle qui trie les fiches. */
  strength: SignalStrength;
  newLeaders: BodaccLeader[];
  capitalAmount: number | null;
  jobTitle: string | null;
  tier: CandidateTier;
  sourceId: ProducingSourceId;
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

/**
 * Commune comparable : accents, casse et arrondissements mis de cote.
 *
 * France Travail ecrit « Lyon 1er Arrondissement » la ou l'annuaire dit
 * « Lyon ». Sans ce nettoyage, AUCUNE offre publiee dans un arrondissement ne
 * pouvait etre rapprochee — soit tout le bassin lyonnais et tout Paris.
 */
export function normalizeCity(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // « lyon 1er arrondissement », « paris 15e arrondissement », « lyon 03 ».
    .replace(/\s*\d+\s*(?:er|ere|eme|e)?\s*arrondissement\s*$/, "")
    .replace(/\s+\d+$/, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Le candidat de l'annuaire correspond-il bien au signal ?
 *
 * Pour BODACC la question ne se pose pas : le SIREN fait foi.
 *
 * Pour une offre d'emploi il n'y a pas de SIREN, et la premiere version
 * comparait les communes. C'etait FAUX, et mesure : 1 offre sur 12 seulement
 * passait. L'annuaire rend la commune du SIEGE, l'offre donne le LIEU DE
 * TRAVAIL — IRIUM SOFTWARE a son siege a Tille et recrute a Lyon, FOKUS siege
 * a Saint-Denis et recrute a Lyon. Ce sont les memes entreprises.
 *
 * La confirmation geographique est obtenue autrement, et mieux : la recherche
 * annuaire est filtree sur le DEPARTEMENT, filtre qui porte sur les
 * etablissements. Un homonyme situe ailleurs ne remonte pas du tout, et une
 * entreprise multi-sites n'est plus perdue. Il ne reste ici qu'a verifier que
 * le nom correspond vraiment — l'annuaire repond de facon floue.
 */
export function confirmsMatch(signal: OfficialSignal, base: CompanyBase): boolean {
  if (signal.siren) return base.siren === signal.siren;

  const left = simplifyName(signal.companyName);
  const right = simplifyName(base.company_name);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

/** Nom comparable : sans accents, sans casse, sans forme juridique. */
export function simplifyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(sas|sarl|sasu|eurl|sa|sci|scop|snc|selarl|societe)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ResolveContext {
  /** SIREN déjà connus (portefeuille, corbeille) : on ne les repropose pas. */
  exclude?: Set<string>;
  /** Préfixes NAF écartés, tels que réglés par l'utilisateur. */
  excludedSectors?: readonly string[];
  /**
   * Passe outre les exclusions de ciblage, structurelles comme sectorielles.
   *
   * Pour une recherche ponctuelle : Axel veut parfois voir ce qu'il a écarté,
   * sans changer son réglage pour autant.
   */
  includeExcluded?: boolean;
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
  /** Signaux qu'on n'a pas su rattacher à une entreprise de l'annuaire. */
  unmatched: number;
  /** Écartées par le ciblage : structure juridique ou secteur exclu. */
  excluded: string[];
  /** Écartées sur la tranche déclarée à l'annuaire. */
  outOfBracket: string[];
  warnings: EnrichmentWarning[];
  /** Candidats dont la tranche est confirmée par l'annuaire. */
  confirmedCount: number;
  /** Candidats dont la tranche n'est pas déclarée : Pappers tranchera. */
  unknownTrancheCount: number;
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

  // Zone construite a la main : le numero de departement est deja connu, aller
  // le redemander a geo.api.gouv.fr serait un appel pour rien. Ce filtre porte
  // sur les ETABLISSEMENTS, c'est lui qui remplace la comparaison de communes.
  const zone = {
    kind: "departement" as const,
    label: `département ${criteria.departement}`,
    param: "departement" as const,
    value: criteria.departement,
    departement: criteria.departement,
  };

  const confirmed: SignalCandidate[] = [];
  const unknownTranche: SignalCandidate[] = [];
  const outOfBracket: string[] = [];
  const warnings: EnrichmentWarning[] = [];
  /** Cles de signaux deja traitees : evite un appel en double. */
  const seen = new Set<string>();
  /** SIREN deja retenus : evite deux fiches pour la meme entreprise. */
  const resolved = new Set<string>();
  let lookups = 0;
  let skippedKnown = 0;
  // Une offre qu'on n'a pas su rattacher n'est NI une entreprise hors cible NI
  // une absence de signal : sans ce compteur, l'echec etait invisible.
  let unmatched = 0;
  const excluded: string[] = [];

  // On visera deux fois l'objectif : une entreprise peut encore sortir en
  // phase 2 sur son effectif reel, et il faut de quoi la remplacer.
  const wanted = criteria.limit * 2;

  /**
   * Y a-t-il assez de matiere pour remplir l'objectif ?
   *
   * Un candidat a tranche CONFIRMEE aboutit presque toujours ; un candidat a
   * tranche non declaree passe environ une fois sur deux, c'est Pappers qui
   * tranche.
   *
   * Les deux conditions sont necessaires, et la seconde est celle qui compte :
   * sans elle, seize tranches inconnues « valaient » huit confirmes et la
   * boucle s'arretait apres vingt-six resolutions a Paris. Resultat, trois
   * fiches sur cinq avaient un effectif inconnu — la recherche demandait
   * « 10 a 49 salaries » et rendait des holdings. On exige donc d'avoir au
   * moins l'objectif en candidats CONFIRMES avant de se rabattre sur les
   * autres ; a defaut, c'est le plafond de resolutions qui arrete.
   */
  const enoughMaterial = () =>
    confirmed.length >= wanted ||
    (confirmed.length >= criteria.limit && confirmed.length + unknownTranche.length / 2 >= wanted);

  for (const signal of signals) {
    if (enoughMaterial() || lookups >= maxLookups) break;
    if (context.shouldStop && (await context.shouldStop())) break;

    if (signal.siren && exclude.has(signal.siren)) {
      skippedKnown += 1;
      continue;
    }

    const key = signal.siren ?? `${signal.companyName.toLowerCase()}|${signal.city ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lookups += 1;
    // Un SIREN se cherche seul : il est unique, le filtre geographique ne
    // ferait que risquer d'ecarter un siege hors departement.
    const page = signal.siren
      ? await searchCompanies({ q: signal.siren }, 1)
      : await searchCompanies({ q: signal.companyName }, 3, { zone });
    if (!page.ok) {
      warnings.push({ source: "gouv", message: page.error });
      continue;
    }

    // L'annuaire repond de facon floue : on prend le premier candidat dont le
    // nom correspond vraiment, pas le premier tout court.
    const base = page.data.companies.find((company) => confirmsMatch(signal, company));
    if (!base) {
      unmatched += 1;
      continue;
    }

    // Dedoublonnage sur le SIREN RESOLU, dans un ensemble DISTINCT de `seen`.
    //
    // Le premier dedoublonnage ne peut pas suffire pour une offre d'emploi :
    // elle n'a pas de SIREN, sa cle est « nom + commune », et une meme
    // entreprise qui recrute dans deux arrondissements produisait deux cles,
    // donc deux fois la meme fiche (vu sur GROUPE IGF dans le 75).
    //
    // L'ensemble doit etre distinct, et c'est tout sauf un detail : `seen`
    // contient DEJA le SIREN d'un signal BODACC, pose avant l'appel. Partager
    // les deux ensembles rejetait donc la totalite des candidats BODACC, en
    // silence — il ne restait que les offres d'emploi.
    if (base.siren) {
      if (resolved.has(base.siren)) continue;
      resolved.add(base.siren);
    }
    if (base.siren && exclude.has(base.siren)) {
      skippedKnown += 1;
      continue;
    }

    // Un intermédiaire recrute pour quelqu'un d'autre : viser lui plutôt que
    // l'employeur, c'est le faux positif « RAS INTERIM JERECRUTE ». Cette
    // exclusion-ci n'est PAS optionnelle : ce n'est pas un choix de ciblage,
    // c'est une erreur de rapprochement.
    if (isStaffingNaf(base.naf_code)) {
      outOfBracket.push(`${base.company_name} — agence d'emploi, elle recrute pour ses clients`);
      continue;
    }

    // Ciblage : association, organisme public, EI sans salarié, secteur exclu.
    // Écarté AVANT l'ouverture de fiche, donc sans rien dépenser.
    if (!context.includeExcluded) {
      const exclusion = exclusionOf(base, context.excludedSectors ?? []);
      if (exclusion) {
        excluded.push(exclusion.reason);
        continue;
      }
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
      signals: signal.signals,
      strength: signal.strength,
      newLeaders: signal.newLeaders,
      capitalAmount: signal.capitalAmount,
      jobTitle: signal.jobTitle,
      tier,
      sourceId: signal.sourceId,
    };
    if (tier === "en-tranche") confirmed.push(candidate);
    else unknownTranche.push(candidate);

    await context.onProgress?.({ looked: lookups, found: confirmed.length });
  }

  // Les confirmés d'abord, les tranches non déclarées ensuite : c'est l'ordre
  // qui décide où part le budget Pappers. À l'intérieur de chaque rang, le
  // signal le plus fort passe devant — les fiches sortent donc déjà triées.
  const byStrength = (a: SignalCandidate, b: SignalCandidate) =>
    STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength];
  confirmed.sort(byStrength);
  unknownTranche.sort(byStrength);
  const candidates = [...confirmed, ...unknownTranche].slice(0, wanted);
  return {
    candidates,
    lookups,
    skippedKnown,
    unmatched,
    excluded,
    outOfBracket,
    warnings,
    confirmedCount: confirmed.length,
    unknownTrancheCount: unknownTranche.length,
  };
}

/**
 * Faits du signal, ecrits sur la fiche.
 *
 * Ils sont relus BIEN plus tard : une fiche vit des semaines apres la recherche
 * qui l'a trouvee, et le signal d'origine n'est alors plus recalculable — une
 * annonce sort de la fenetre de 60 jours, une offre d'emploi est depubliee.
 * D'ou la copie a plat plutot qu'un renvoi vers la source.
 *
 * Rien ici ne formule de phrase : ce sont des faits bruts. Leur mise en mots
 * appartient a la redaction, qui n'est pas de ce cote de l'application.
 */
export function signalFacts(candidate: SignalCandidate): ProspectKeyFigures {
  const main = candidate.signals[0];
  const leader = candidate.newLeaders[0];

  return {
    signal_source: candidate.sourceId,
    signal_count: candidate.signals.length,
    ...(candidate.strength ? { signal_strength: candidate.strength } : {}),
    ...(main?.type ? { signal_type: main.type } : {}),
    ...(main?.date ? { signal_date: main.date } : {}),
    ...(main?.label ? { signal_label: main.label } : {}),
    ...(leader
      ? {
          // Prenom puis nom : l'ordre de la source est inverse (« NARBONNET
          // Bernard »), et c'est celui-ci qu'on relit.
          new_leader_name: `${leader.firstName} ${leader.surname}`,
          new_leader_role: leader.role,
        }
      : {}),
    ...(candidate.jobTitle ? { job_title: candidate.jobTitle } : {}),
    ...(candidate.jobTitle && main?.date ? { job_posted_at: main.date } : {}),
    ...(candidate.capitalAmount !== null ? { capital_after_eur: candidate.capitalAmount } : {}),
  };
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
  /** Signaux qu'on n'a pas su rattacher à une entreprise de l'annuaire. */
  unmatched: number;
  /** Candidats dont la tranche est confirmée par l'annuaire. */
  confirmedCount: number;
  /** Candidats dont la tranche n'est pas déclarée : Pappers tranchera. */
  unknownTrancheCount: number;
  /** Écartées par le ciblage : structure juridique ou secteur exclu. */
  excluded: string[];
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
    const enriched = await mapWithConcurrency(batch, ENRICH_CONCURRENCY, async (candidate) => {
      // Le signal est passe en `attachedSignals` et non en signaux web : son
      // rattachement est deja prouve par le SIREN de l'annonce.
      const company = await deepEnrich(candidate.base, [], [], {
        attachedSignals: candidate.signals,
      });
      // Les faits du signal rejoignent la fiche. `deepEnrich` ne les connait
      // pas : il ne sait pas COMMENT l'entreprise a ete trouvee.
      return {
        ...company,
        key_figures: { ...company.key_figures, ...signalFacts(candidate) },
      };
    });

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
    unmatched: resolved.unmatched,
    confirmedCount: resolved.confirmedCount,
    unknownTrancheCount: resolved.unknownTrancheCount,
    excluded: resolved.excluded,
    outOfBracket,
    warnings,
  };
}

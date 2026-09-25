/**
 * ORION — score de chaleur d'un prospect.
 *
 * Fonction PURE : aucune dépendance réseau, aucune couleur, aucun composant.
 * Les écrans mappent eux-mêmes `level` / `tone` sur les tokens de thème.
 *
 * Principe : un prospect est « chaud » quand plusieurs signaux d'intention
 * récents se cumulent. On combine trois facteurs :
 *   1. le TYPE du signal (une levée de fonds vaut plus qu'une brève de presse),
 *   2. sa RÉCENCE (quand la source la fournit),
 *   3. le NOMBRE de signaux, à rendement décroissant.
 */
import type { ProspectSignal } from "@/types";
import { FRESH_DAYS, isFresh } from "@/lib/enrichment/dates";
import { cleanText, excerpt } from "@/lib/enrichment/clean";

// ---------------------------------------------------------------------------
// Référentiel des signaux
// ---------------------------------------------------------------------------

/** Poids d'intention par type, sur une échelle interne 0-30. */
const SIGNAL_WEIGHTS: Record<string, number> = {
  levee: 30, // budget débloqué
  recrutement: 26, // douleur + capacité à payer
  support: 24, // douleur directement automatisable
  digital: 22, // chantier ouvert : fenêtre de tir
  croissance: 20, // les process vont saturer
  ecommerce: 18, // flux répétitifs
  // Officiel et daté, mais une entreprise qui vient de naître n'a ni budget ni
  // process saturés : le signal est vrai, sa valeur commerciale est faible.
  creation: 12,
  presse: 6, // simple accroche
  structure: 8, // déduit des données INSEE, pas d'une actualité
};

/** Température d'un type de signal, mappée sur les tokens par l'UI. */
export type SignalTone = "hot" | "warm" | "cool";

export interface SignalMeta {
  /** Libellé court, pour une puce. */
  label: string;
  tone: SignalTone;
}

export const SIGNAL_META: Record<string, SignalMeta> = {
  levee: { label: "Levée de fonds", tone: "hot" },
  recrutement: { label: "Recrutement", tone: "hot" },
  support: { label: "Support client", tone: "hot" },
  digital: { label: "Chantier digital", tone: "warm" },
  croissance: { label: "Croissance", tone: "warm" },
  ecommerce: { label: "E-commerce", tone: "warm" },
  creation: { label: "Création récente", tone: "cool" },
  presse: { label: "Actualité", tone: "cool" },
  structure: { label: "Structurel", tone: "cool" },
};

export function signalMeta(type: string | undefined): SignalMeta {
  return SIGNAL_META[type ?? ""] ?? { label: "Signal", tone: "cool" };
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export type HeatLevel = "froid" | "tiede" | "chaud" | "brulant";

export interface HeatScore {
  /** 0 à 100. */
  value: number;
  level: HeatLevel;
  /**
   * `false` quand le prospect n'a aucun signal exploitable : la valeur est
   * alors une DÉMONSTRATION, à présenter comme telle (jamais comme réelle).
   */
  real: boolean;
  /** Types de signaux ayant le plus contribué, du plus fort au plus faible. */
  drivers: string[];
  /** Détail lisible : d'où viennent les points, bonus et malus compris. */
  breakdown: ScoreLine[];
}

export const HEAT_LEVEL_LABELS: Record<HeatLevel, string> = {
  froid: "Froid",
  tiede: "Tiède",
  chaud: "Chaud",
  brulant: "Brûlant",
};

/**
 * Calibrage : une levée + un recrutement + un support récents saturent l'échelle.
 * Modifier cette constante déplace tout le barème d'un coup.
 */
const RAW_MAX = 55;

/**
 * Poids de fraîcheur — binaire, et c'est voulu.
 *
 * Une version précédente appliquait 0,8 à un signal NON DATÉ : une offre
 * d'emploi de 2019 pesait donc presque autant qu'une offre de mardi. Un signal
 * d'actualité non daté ou vieux de plus de 60 jours ne prouve plus rien sur
 * l'instant présent : il vaut zéro.
 *
 * Exception assumée : les signaux `structure` ne sont pas des actualités mais
 * des déductions INSEE (effectif, secteur, ancienneté). Ils n'ont pas de date
 * par construction, et les écarter reviendrait à leur appliquer une règle
 * faite pour autre chose. Ils gardent donc leur petit poids — mais ils ne
 * lèvent jamais le plafond des 60 points, faute de preuve.
 */
/**
 * Poids d'une offre d'emploi non datee mais encore servie sur le domaine
 * officiel. La moitie, pas plus : « ils cherchent quelqu'un aujourd'hui » vaut
 * moins que « ils ont publie l'offre il y a douze jours ».
 */
export const LIVE_POSTING_FACTOR = 0.5;

function recencyFactor(signal: ProspectSignal, now: number): number {
  if (signal.type === "structure") return 1;
  if (isFresh(typeof signal.date === "string" ? signal.date : null, new Date(now))) return 1;
  // Sans date, une offre verifiee en ligne garde la moitie de ses points.
  return signal.liveOnOfficialSite === true ? LIVE_POSTING_FACTOR : 0;
}

/** Postes dont l'ouverture signale un besoin d'automatisation immédiat. */
const AUTOMATION_CATEGORIES = new Set(["automation", "data", "it", "ops"]);

/** Bonus d'un recrutement frais sur un métier directement automatisable. */
export const FRESH_AUTOMATION_HIRE_BONUS = 15;
/** Bonus d'une PME autonome dont on sait à qui parler. */
export const INDEPENDENT_PME_BONUS = 10;
/** Malus d'une filiale : la décision se prend ailleurs. */
export const LARGE_GROUP_MALUS = -15;

/** Une ligne du détail de score, telle qu'affichée dans la fiche prospect. */
export interface ScoreLine {
  label: string;
  /** Points signés, sur l'échelle 0-100 du score final. */
  points: number;
  kind: "base" | "bonus" | "malus" | "info";
}

/**
 * Contexte de score lu depuis `key_figures`.
 *
 * Volontairement ici, a cote des regles : les ecrans n'ont pas a savoir
 * comment un « dirigeant identifie » se reconnait dans le JSON.
 */
export function heatContextOf(figures: Record<string, unknown> | null | undefined): HeatContext {
  const value = figures ?? {};
  const leader = value.leader_person;

  // Un representant personne morale suffit a disqualifier l'independance, meme
  // quand on n'a pas pu mesurer la taille du groupe : on ne recompense pas une
  // filiale au motif qu'on manque d'information sur sa maison mere.
  const hasGroupIndicator =
    value.is_large_group_subsidiary === true ||
    typeof value.parent_company === "string" ||
    typeof value.parent_group === "string";

  return {
    isLargeGroupSubsidiary: value.is_large_group_subsidiary === true,
    hasIdentifiedLeader:
      !hasGroupIndicator && typeof leader === "string" && leader.trim().length > 2,
  };
}

/** Ce que l'on sait de l'entreprise en dehors de ses signaux. */
export interface HeatContext {
  /** Filiale d'un grand groupe : décision probablement au niveau groupe. */
  isLargeGroupSubsidiary?: boolean;
  /** Dirigeant personne physique identifié (y compris derrière une holding). */
  hasIdentifiedLeader?: boolean;
}

const levelOf = (value: number): HeatLevel =>
  value >= 75 ? "brulant" : value >= 50 ? "chaud" : value >= 25 ? "tiede" : "froid";

/** Au-dela de ce seuil, la preuve est jugee solide (source datee et nommante). */
export const PROVEN_CONFIDENCE = 0.75;

/**
 * Plafond applique tant qu'aucun signal n'est solidement prouve.
 * « Brulant » commence a 75 : sans preuve forte, on n'y arrive jamais.
 */
const UNPROVEN_CEILING = 60;

/**
 * Plafond quand il n'y a QUE des signaux structurels.
 *
 * Ces signaux sont deduits du code NAF et de l'effectif : ils decrivent la
 * forme de l'entreprise, jamais son actualite. Trois d'entre eux donnaient
 * 17/100 — exactement le meme score pour SEMAPHORES, EG RETAIL et VIVAUTO
 * PLVL, qui n'ont rien en commun. Les plafonner dit la verite : on ne sait
 * rien de leur moment, seulement de leur taille.
 */
const STRUCTURAL_ONLY_CEILING = 20;

/** Un signal issu du web, date et attestant nommement l'entreprise. */
const isProven = (signal: ProspectSignal): boolean =>
  typeof signal.url === "string" &&
  typeof signal.quote === "string" &&
  (signal.confidence ?? 0) >= PROVEN_CONFIDENCE;

/**
 * Facteur de confiance. Un signal sans preuve explicite pese moitie moins :
 * il peut orienter un tri, jamais declencher une alerte.
 */
const confidenceFactor = (signal: ProspectSignal): number => {
  const raw = signal.confidence;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5;
  return Math.max(0, Math.min(1, raw));
};

/**
 * Qualite de la SOURCE.
 *
 * Un agregateur qui annonce « 12 offres » sans en nommer aucune ne vaut pas
 * une annonce publiee sur le site de l'entreprise. `sourceWeight` est pose par
 * la qualification (cf. `lib/enrichment/job-source.ts`).
 */
const sourceFactor = (signal: ProspectSignal): number => {
  const raw = signal.sourceWeight;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
};

/**
 * Specificite du POSTE recrute.
 *
 * Trois entreprises sortaient a 17/100 parce que leurs seuls signaux etaient
 * structurels — identiques pour tout le monde. Un recrutement d'automaticien
 * et un recrutement de vendeur ne disent pourtant pas la meme chose de notre
 * capacite a aider : le premier prouve qu'ils automatisent deja.
 */
const ROLE_FACTOR: Record<string, number> = {
  automation: 1.5,
  data: 1.35,
  it: 1.25,
  ops: 1.2,
  sales: 0.8,
  other: 0.9,
};

const roleFactor = (signal: ProspectSignal): number => {
  if (signal.type !== "recrutement") return 1;
  const category = typeof signal.category === "string" ? signal.category : null;
  return category ? (ROLE_FACTOR[category] ?? 1) : 1;
};

/**
 * Nombre de SOURCES distinctes qui disent la meme chose.
 *
 * Deux medias independants qui annoncent la meme levee valent mieux qu'un
 * seul. On plafonne vite : au-dela de trois, c'est de la reprise de depeche.
 */
export function concordanceBonus(signals: readonly ProspectSignal[], type: string): number {
  const hosts = new Set(
    signals
      .filter((signal) => (signal.type ?? "presse") === type && typeof signal.source === "string")
      .map((signal) => String(signal.source).toLowerCase()),
  );
  return 1 + Math.min(2, Math.max(0, hosts.size - 1)) * 0.15;
}

/**
 * Score démo, stable pour une même entrée (hash du nom) : sert uniquement à
 * illustrer la jauge tant qu'aucun signal n'est disponible. Toujours `real: false`.
 */
export function demoHeatScore(seed: string): HeatScore {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  const value = 22 + (hash % 39); // 22-60 : jamais « brûlant » par hasard
  return {
    value,
    level: levelOf(value),
    real: false,
    drivers: [],
    breakdown: [
      { label: "Aucun signal exploitable : score de démonstration", points: value, kind: "info" },
    ],
  };
}

/**
 * Recrutement sur un metier automatisable, et ce qu'on peut en prouver.
 *
 * Distinction importante, corrigee apres relecture : une offre publiee sur le
 * site officiel mais SANS DATE ne peut pas recevoir un bonus intitule « moins
 * de 60 jours ». On ne sait pas depuis quand elle est en ligne — elle peut
 * dater de deux ans. Elle vaut la moitie du bonus, sous son vrai libelle.
 */
export type HireProof = "datee" | "en ligne";

export interface AutomationHire {
  signal: ProspectSignal;
  proof: HireProof;
}

export function hasFreshAutomationHire(
  signals: readonly ProspectSignal[],
  now: Date,
): AutomationHire | null {
  const automatable = signals.filter(
    (signal) =>
      signal.type === "recrutement" &&
      typeof signal.category === "string" &&
      AUTOMATION_CATEGORIES.has(signal.category),
  );

  // Une offre datee et fraiche prime : c'est la seule qui prouve le « maintenant ».
  const dated = automatable.find((signal) =>
    isFresh(typeof signal.date === "string" ? signal.date : null, now),
  );
  if (dated) return { signal: dated, proof: "datee" };

  const live = automatable.find((signal) => signal.liveOnOfficialSite === true);
  return live ? { signal: live, proof: "en ligne" } : null;
}

/**
 * Score réel à partir des signaux, puis ajustements métier.
 *
 * Deux étages, volontairement séparés :
 *   1. les SIGNAUX — triés puis atténués (1, 1/1.4, 1/1.8…), pour qu'un
 *      prospect bruyant n'écrase pas un prospect réellement mûr ;
 *   2. les AJUSTEMENTS — ce que l'entreprise est, indépendamment de son
 *      actualité : un recrutement d'automaticien frais, une PME autonome
 *      avec un interlocuteur identifié, une filiale de grand groupe.
 *
 * Le plafond de 60 points sans preuve solide s'applique APRÈS les ajustements :
 * aucun bonus ne permet d'annoncer « brûlant » sans preuve.
 */
export function heatScore(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { seed?: string; now?: Date; context?: HeatContext } = {},
): HeatScore {
  const list = signals ?? [];
  const context = options.context ?? {};
  const nowDate = options.now ?? new Date();

  if (!list.length) {
    const demo = demoHeatScore(options.seed ?? "orion");
    // Même sans signal, un malus de filiale reste une information utile.
    if (!context.isLargeGroupSubsidiary) return demo;
    const value = Math.max(0, demo.value + LARGE_GROUP_MALUS);
    return {
      ...demo,
      value,
      level: levelOf(value),
      breakdown: [
        ...demo.breakdown,
        { label: "Filiale d'un grand groupe", points: LARGE_GROUP_MALUS, kind: "malus" },
      ],
    };
  }

  const now = nowDate.getTime();
  const contributions = list
    .map((signal) => ({
      type: signal.type ?? "presse",
      points:
        (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) *
        recencyFactor(signal, now) *
        confidenceFactor(signal) *
        sourceFactor(signal) *
        roleFactor(signal) *
        concordanceBonus(list, signal.type ?? "presse"),
    }))
    .sort((a, b) => b.points - a.points);

  const raw = contributions.reduce(
    (total, contribution, index) => total + contribution.points / (1 + 0.4 * index),
    0,
  );

  const base = Math.round((raw / RAW_MAX) * 100);
  const breakdown: ScoreLine[] = [];

  const counted = list.filter((signal) => recencyFactor(signal, now) > 0).length;
  breakdown.push({
    label:
      counted > 0
        ? `${counted} signal(aux) retenu(s) sur ${list.length}`
        : `Aucun signal retenu sur ${list.length}`,
    points: base,
    kind: "base",
  });

  // Ce qui a été ignoré, et pourquoi : c'est la moitié de l'explication.
  const ignored = list.filter(
    (signal) => signal.type !== "structure" && recencyFactor(signal, now) === 0,
  );
  const undated = ignored.filter((signal) => typeof signal.date !== "string").length;
  const stale = ignored.length - undated;
  if (undated > 0) {
    breakdown.push({ label: `${undated} signal(aux) non daté(s) : ignoré(s)`, points: 0, kind: "info" });
  }
  if (stale > 0) {
    breakdown.push({
      label: `${stale} signal(aux) de plus de ${FRESH_DAYS} jours : ignoré(s)`,
      points: 0,
      kind: "info",
    });
  }

  let value = base;

  const hire = hasFreshAutomationHire(list, nowDate);
  if (hire) {
    // Meme regle que pour les points de signal : sans date, on compte moitie.
    const points =
      hire.proof === "datee"
        ? FRESH_AUTOMATION_HIRE_BONUS
        : Math.round(FRESH_AUTOMATION_HIRE_BONUS * LIVE_POSTING_FACTOR);
    const category = String(hire.signal.category);
    value += points;
    breakdown.push({
      label:
        hire.proof === "datee"
          ? `Recrutement ${category} de moins de ${FRESH_DAYS} jours`
          : `Recrutement ${category} en ligne, non daté (bonus de moitié)`,
      points,
      kind: "bonus",
    });
  }

  if (context.isLargeGroupSubsidiary) {
    value += LARGE_GROUP_MALUS;
    breakdown.push({
      label: "Filiale d'un grand groupe : décision probablement au niveau groupe",
      points: LARGE_GROUP_MALUS,
      kind: "malus",
    });
  } else if (context.hasIdentifiedLeader) {
    value += INDEPENDENT_PME_BONUS;
    breakdown.push({
      label: "PME indépendante, dirigeant identifié",
      points: INDEPENDENT_PME_BONUS,
      kind: "bonus",
    });
  }

  // Uniquement des deductions INSEE : on le dit, et on plafonne bas.
  const structuralOnly = list.length > 0 && list.every((signal) => signal.type === "structure");
  const ceiling = structuralOnly
    ? STRUCTURAL_ONLY_CEILING
    : list.some(isProven)
      ? 100
      : UNPROVEN_CEILING;
  const capped = Math.max(0, Math.min(ceiling, value));
  if (capped < value) {
    breakdown.push({
      label: structuralOnly
        ? `Plafonné à ${STRUCTURAL_ONLY_CEILING} : aucune actualité, seulement des déductions INSEE`
        : `Plafonné à ${UNPROVEN_CEILING} : aucune preuve solide`,
      points: capped - value,
      kind: "info",
    });
  }

  return {
    value: capped,
    level: levelOf(capped),
    real: true,
    drivers: [...new Set(contributions.filter((c) => c.points > 0).slice(0, 3).map((c) => c.type))],
    breakdown,
  };
}

/**
 * Ordre de tri (décroissant) entre deux scores.
 *
 * Un score RÉEL passe toujours devant un score de démonstration, même plus
 * élevé : « un signal faible mais avéré » vaut mieux que « on ne sait pas ».
 * Sans cette règle, un prospect sans aucun signal remonterait en tête.
 */
export function compareHeat(a: HeatScore, b: HeatScore): number {
  if (a.real !== b.real) return a.real ? -1 : 1;
  return b.value - a.value;
}

// ---------------------------------------------------------------------------
// « Pourquoi maintenant »
// ---------------------------------------------------------------------------

/**
 * L'argument d'urgence, DERIVE DE LA SOURCE REELLE.
 *
 * Une version precedente piochait dans un dictionnaire de phrases toutes
 * faites indexe par type de signal : deux entreprises differentes recevaient
 * mot pour mot le meme « pourquoi maintenant ». C'etait faux et cela se voyait.
 * On ne restitue desormais que ce que la source dit, avec son URL.
 */
export interface WhyNow {
  /** Citation de la source, NETTOYEE (ni markdown, ni emoji, ni puce). */
  headline: string;
  /** Provenance verifiable : hote, et date quand la source la fournit. */
  evidence: string;
  /** Toujours presente : sans lien verifiable, il n'y a pas de « pourquoi maintenant ». */
  url: string;
  signalType: string;
  /** Confiance de la preuve, de 0 a 1. */
  confidence: number;
  /**
   * Lecture structuree, pour un affichage qui ne depend plus du verbatim.
   *
   * `role` : l'intitule du poste quand le signal est un recrutement.
   * `when` : la date en clair, ou « en ligne, non datee » pour une offre
   *          verifiee mais sans date — jamais une date inventee.
   */
  role: string | null;
  when: string | null;
}

/** Confiance minimale pour qu'un signal puisse porter l'argument d'urgence. */
const MIN_WHY_NOW_CONFIDENCE = 0.6;

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function frenchDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const index = Number(month) - 1;
  if (!year || Number.isNaN(index) || !MONTHS[index]) return iso;
  return `${Number(day)} ${MONTHS[index]} ${year}`;
}

/**
 * Bonus de pertinence d'un poste ouvert.
 *
 * Trois offres publiees le meme jour se valent pour le scoring, mais pas pour
 * ecrire : « Automaticien/ne » dit qu'ils automatisent deja, « Manager energie
 * de proximite » ne dit rien de nous. A poids egal, c'est le poste
 * automatisable qui doit porter l'accroche.
 */
const CATEGORY_WEIGHT: Record<string, number> = {
  automation: 1.6,
  data: 1.4,
  it: 1.3,
  ops: 1.2,
  sales: 0.9,
  other: 1,
};

function categoryFactor(signal: ProspectSignal): number {
  return typeof signal.category === "string" ? (CATEGORY_WEIGHT[signal.category] ?? 1) : 1;
}

/** Signal citable : il porte une preuve textuelle et un lien verifiable. */
type CitableSignal = ProspectSignal & { url: string; quote: string };

function isCitable(signal: ProspectSignal): signal is CitableSignal {
  return (
    typeof signal.url === "string" &&
    signal.url.length > 0 &&
    typeof signal.quote === "string" &&
    signal.quote.trim().length > 0 &&
    (signal.confidence ?? 0) >= MIN_WHY_NOW_CONFIDENCE
  );
}

/**
 * Signal portant le plus d'intention (type x recence x confiance).
 * L'ordre du tableau vient des sources : il ne reflete aucune priorite metier.
 */
export function strongestSignal(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { now?: Date } = {},
): ProspectSignal | null {
  const list = signals ?? [];
  if (!list.length) return null;

  const now = (options.now ?? new Date()).getTime();
  const weight = (signal: ProspectSignal) =>
    (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) *
    recencyFactor(signal, now) *
    confidenceFactor(signal) *
    categoryFactor(signal);

  return [...list].sort((a, b) => weight(b) - weight(a))[0];
}

/**
 * Retient le signal prouve le plus fort et en restitue la citation.
 *
 * Renvoie `null` des qu'aucun signal n'est attestable : l'ecran doit alors
 * dire franchement qu'aucun signal recent n'a ete detecte, plutot que de
 * servir une phrase d'urgence inventee.
 */
export function whyNow(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { now?: Date } = {},
): WhyNow | null {
  // Une citation qui ne survit pas au nettoyage (uniquement du markdown, un
  // lien, une ligne de navigation) n'est pas une preuve : elle affichait des
  // guillemets vides dans la carte.
  const citable = (signals ?? []).filter(
    (signal): signal is CitableSignal =>
      isCitable(signal) && cleanText(signal.quote ?? "", 400).trim().length > 10,
  );
  if (!citable.length) return null;

  const now = (options.now ?? new Date()).getTime();
  const weight = (signal: CitableSignal) =>
    (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) *
    recencyFactor(signal, now) *
    confidenceFactor(signal) *
    categoryFactor(signal) *
    // Un agregateur ne porte l'accroche que si rien d'autre n'existe.
    sourceFactor(signal);

  const best = [...citable].sort((a, b) => weight(b) - weight(a))[0];
  const date = typeof best.date === "string" ? frenchDate(best.date) : null;
  // Une offre verifiee en ligne n'a pas de date : on le dit, on n'en fabrique pas.
  const when = date ?? (best.liveOnOfficialSite === true ? "en ligne, non datée" : null);

  // Un agregateur ne prouve qu'une chose : l'entreprise a des offres quelque
  // part. Son extrait brut — « terdici vegetal 2 offres d'emploi terdici
  // vegetal en France. » — n'apprend rien et se lit mal. On le remplace par ce
  // qu'il dit vraiment.
  const weakSource = best.sourceWeight !== undefined && Number(best.sourceWeight) < 1;
  const offerCount = /(\d+)\s+(?:offres?|postes?|annonces?)/i.exec(String(best.quote ?? ""))?.[1];
  const headline = weakSource
    ? `${offerCount ?? "Plusieurs"} offre${offerCount === "1" ? "" : "s"} listée${offerCount === "1" ? "" : "s"} sur un agrégateur (non datées)`
    : excerpt(cleanText(best.quote, 400), 260);

  return {
    // Les citations arrivent brutes du web : liens markdown, puces, emojis.
    // Les afficher telles quelles donnait « - [Voir l'offre](https://…) 🔥 ».
    headline,
    evidence: [best.source, when].filter(Boolean).join(" · ") || "source web",
    url: best.url,
    signalType: best.type ?? "presse",
    confidence: best.confidence ?? MIN_WHY_NOW_CONFIDENCE,
    role: jobTitleOf(best),
    when,
  };
}

/**
 * Intitule du poste porte par un signal de recrutement.
 *
 * Le label structure vaut « Poste ouvert : Automaticien/ne — domaine, date » :
 * on en extrait la partie utile plutot que de la reconstruire.
 */
function jobTitleOf(signal: ProspectSignal): string | null {
  if (signal.type !== "recrutement") return null;
  const match = /^Poste ouvert\s*:\s*(.+?)\s+—/.exec(signal.label ?? "");
  return match ? match[1].trim() : null;
}

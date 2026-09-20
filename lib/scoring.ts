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
 * Poids de récence. Une source qui ne se date pas ne permet pas d'affirmer
 * qu'un évènement est récent : on applique alors un facteur prudent plutôt
 * que de supposer une actualité fraîche.
 */
function recencyFactor(signal: ProspectSignal, now: number): number {
  const raw = typeof signal.date === "string" ? Date.parse(signal.date) : NaN;
  if (Number.isNaN(raw)) return 0.8;

  const days = (now - raw) / 86_400_000;
  if (days < 0) return 0.8; // date future : donnée douteuse
  if (days <= 30) return 1;
  if (days <= 90) return 0.85;
  if (days <= 180) return 0.7;
  return 0.55;
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
 * Score démo, stable pour une même entrée (hash du nom) : sert uniquement à
 * illustrer la jauge tant qu'aucun signal n'est disponible. Toujours `real: false`.
 */
export function demoHeatScore(seed: string): HeatScore {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  const value = 22 + (hash % 39); // 22-60 : jamais « brûlant » par hasard
  return { value, level: levelOf(value), real: false, drivers: [] };
}

/**
 * Score réel à partir des signaux. Les contributions sont triées puis
 * atténuées (1, 1/1.4, 1/1.8…) : le 4ᵉ signal ajoute peu, ce qui évite
 * qu'un prospect bruyant écrase un prospect réellement mûr.
 */
export function heatScore(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { seed?: string; now?: Date } = {},
): HeatScore {
  const list = signals ?? [];
  if (!list.length) return demoHeatScore(options.seed ?? "orion");

  const now = (options.now ?? new Date()).getTime();
  const contributions = list
    .map((signal) => ({
      type: signal.type ?? "presse",
      points:
        (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) *
        recencyFactor(signal, now) *
        confidenceFactor(signal),
    }))
    .sort((a, b) => b.points - a.points);

  const raw = contributions.reduce(
    (total, contribution, index) => total + contribution.points / (1 + 0.4 * index),
    0,
  );

  // Sans preuve solide, le score est plafonne : aucun prospect ne peut etre
  // annonce « brulant » sur la foi de signaux non attestes.
  const ceiling = list.some(isProven) ? 100 : UNPROVEN_CEILING;
  const value = Math.max(0, Math.min(ceiling, Math.round((raw / RAW_MAX) * 100)));
  return {
    value,
    level: levelOf(value),
    real: true,
    drivers: [...new Set(contributions.slice(0, 3).map((c) => c.type))],
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
  /** Citation de la source. Deux sources differentes ne peuvent pas coincider. */
  headline: string;
  /** Provenance verifiable : hote, et date quand la source la fournit. */
  evidence: string;
  /** Toujours presente : sans lien verifiable, il n'y a pas de « pourquoi maintenant ». */
  url: string;
  signalType: string;
  /** Confiance de la preuve, de 0 a 1. */
  confidence: number;
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
    confidenceFactor(signal);

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
  const citable = (signals ?? []).filter(isCitable);
  if (!citable.length) return null;

  const now = (options.now ?? new Date()).getTime();
  const weight = (signal: CitableSignal) =>
    (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) *
    recencyFactor(signal, now) *
    confidenceFactor(signal);

  const best = [...citable].sort((a, b) => weight(b) - weight(a))[0];
  const date = typeof best.date === "string" ? frenchDate(best.date) : null;

  return {
    headline: best.quote.trim().slice(0, 260),
    evidence: [best.source, date].filter(Boolean).join(" · ") || "source web",
    url: best.url,
    signalType: best.type ?? "presse",
    confidence: best.confidence ?? MIN_WHY_NOW_CONFIDENCE,
  };
}

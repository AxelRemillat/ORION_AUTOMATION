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
 * Poids de récence. Les sources actuelles (Linkup) ne datent pas leurs
 * résultats : sans date, on applique un facteur prudent plutôt que de
 * supposer une actualité fraîche.
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
      points: (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) * recencyFactor(signal, now),
    }))
    .sort((a, b) => b.points - a.points);

  const raw = contributions.reduce(
    (total, contribution, index) => total + contribution.points / (1 + 0.4 * index),
    0,
  );

  const value = Math.max(0, Math.min(100, Math.round((raw / RAW_MAX) * 100)));
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

export interface WhyNow {
  /** Une phrase : l'urgence, du point de vue du prospect. */
  headline: string;
  /** Le signal d'origine, pour que l'utilisateur puisse vérifier. */
  evidence: string;
  url?: string;
  signalType: string;
  /** `false` quand la phrase est illustrative faute de signal réel. */
  real: boolean;
}

/** Règle simple et lisible ; une génération IA pourra la remplacer plus tard. */
const WHY_NOW_TEMPLATES: Record<string, string> = {
  levee: "Ils viennent de lever : le budget outillage est arbitré maintenant, pas dans six mois.",
  recrutement:
    "Ils recrutent sur des postes ops : le volume dépasse déjà l'équipe en place.",
  support:
    "Leur service client est très exposé : c'est le premier poste où l'automatisation se voit.",
  digital:
    "Un chantier digital est en cours : se greffer dessus coûte bien moins cher qu'après.",
  croissance:
    "La croissance est annoncée : leurs process actuels vont saturer dans les mois qui viennent.",
  ecommerce:
    "Leur boutique tourne : commandes, relances et SAV se traitent encore largement à la main.",
  presse: "Ils sont dans l'actualité : l'accroche est disponible tout de suite.",
  structure:
    "Leur taille et leur secteur impliquent un back-office manuel important.",
};

/**
 * Signal portant le plus d'intention (type × récence).
 * L'ordre du tableau vient des sources : il ne reflète aucune priorité métier.
 */
export function strongestSignal(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { now?: Date } = {},
): ProspectSignal | null {
  const list = signals ?? [];
  if (!list.length) return null;

  const now = (options.now ?? new Date()).getTime();
  const weight = (signal: ProspectSignal) =>
    (SIGNAL_WEIGHTS[signal.type ?? ""] ?? 6) * recencyFactor(signal, now);

  return [...list].sort((a, b) => weight(b) - weight(a))[0];
}

/** Retient le signal le plus fort et en dérive l'argument d'urgence. */
export function whyNow(
  signals: readonly ProspectSignal[] | null | undefined,
  options: { now?: Date } = {},
): WhyNow | null {
  const best = strongestSignal(signals, options);
  if (!best) return null;

  const type = best.type ?? "presse";
  return {
    headline: WHY_NOW_TEMPLATES[type] ?? WHY_NOW_TEMPLATES.presse,
    evidence: best.label,
    url: typeof best.url === "string" ? best.url : undefined,
    signalType: type,
    real: type !== "structure",
  };
}

/**
 * Lecture d'un effectif, et contrôle de la tranche demandée.
 *
 * Deux bugs de production sont traités ici.
 *
 * 1. ANDRA LEARNING s'affichait « 500000 salariés ». Pappers renvoie pour
 *    cette fiche `effectif: "Au moins 1 salarié"`, `effectif_min: 1`,
 *    `effectif_max: 500000`. Le 500000 n'est pas un effectif : c'est la borne
 *    SENTINELLE d'une fourchette ouverte. Le code prenait `effectif_max` en
 *    premier, donc la sentinelle.
 *
 * 2. SEMAPHORES (50-99), EG RETAIL (50-99) et VIVAUTO PLVL (100-199) sont
 *    sortis d'une recherche « 10 à 49 salariés ». L'annuaire, lui, filtre
 *    correctement — vérifié : une requête `tranche_effectif_salarie=11,12`
 *    ne rend que des 11 et des 12. Mais RIEN ne revérifiait la tranche après
 *    l'enrichissement, alors que Pappers donne 99, 99 et 199 pour ces trois
 *    entreprises. Une fiche hors cible était donc présentée comme une cible.
 */
import { EFFECTIF_LABELS, SIZE_BUCKETS } from "./naf";

/** Au-delà, ce n'est plus un effectif d'entreprise mais une borne technique. */
export const SENTINEL_HEADCOUNT = 100_000;

export interface HeadcountReading {
  /** Effectif retenu, ou `null` si rien d'exploitable. */
  value: number | null;
  /** D'où il vient, pour l'afficher et le déboguer. */
  basis: "bilan" | "fourchette" | "tranche INSEE" | "inconnu";
  /** Fourchette d'origine, quand elle est connue. */
  min: number | null;
  max: number | null;
}

const isUsable = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < SENTINEL_HEADCOUNT;

/**
 * Effectif lu dans une réponse Pappers.
 *
 * Ordre : l'effectif du dernier bilan (le plus fiable), puis le MILIEU de la
 * fourchette, puis sa borne basse. Jamais la borne haute seule : c'est elle
 * qui porte la sentinelle des fourchettes ouvertes.
 */
export function readPappersHeadcount(input: {
  financeHeadcount?: number | null;
  min?: number | null;
  max?: number | null;
}): HeadcountReading {
  const min = isUsable(input.min) ? input.min : null;
  const max = isUsable(input.max) ? input.max : null;

  if (isUsable(input.financeHeadcount)) {
    return { value: input.financeHeadcount, basis: "bilan", min, max };
  }
  if (min !== null && max !== null) {
    return { value: Math.round((min + max) / 2), basis: "fourchette", min, max };
  }
  // Une borne basse seule reste une information : « au moins 1 salarié » vaut
  // mieux que rien, et elle ne ment pas sur l'ordre de grandeur.
  if (min !== null) return { value: min, basis: "fourchette", min, max: null };

  return { value: null, basis: "inconnu", min, max };
}

export interface Bracket {
  min: number;
  max: number | null;
  label: string;
}

/** Bornes d'effectif d'une liste de tranches INSEE. */
export function bracketOfTranches(tranches: readonly string[] | undefined): Bracket | null {
  if (!tranches?.length) return null;

  const bucket = SIZE_BUCKETS.find(
    (item) =>
      item.tranches.length === tranches.length &&
      item.tranches.every((code) => tranches.includes(code)),
  );

  const BOUNDS: Record<string, [number, number | null]> = {
    "00": [0, 0], "01": [1, 2], "02": [3, 5], "03": [6, 9], "11": [10, 19],
    "12": [20, 49], "21": [50, 99], "22": [100, 199], "31": [200, 249],
    "32": [250, 499], "41": [500, 999], "42": [1000, 1999], "51": [2000, 4999],
    "52": [5000, 9999], "53": [10000, null],
  };

  const known = tranches.map((code) => BOUNDS[code]).filter(Boolean);
  if (!known.length) return null;

  const min = Math.min(...known.map(([low]) => low));
  const max = known.some(([, high]) => high === null)
    ? null
    : Math.max(...known.map(([, high]) => high as number));

  return { min, max, label: bucket?.label ?? tranches.map((c) => EFFECTIF_LABELS[c] ?? c).join(", ") };
}

export type BracketVerdict = "dans la tranche" | "hors tranche" | "inconnu";

/**
 * L'effectif tient-il dans la tranche demandée ?
 *
 * `inconnu` quand on n'a pas d'effectif : on ne rejette pas une entreprise
 * faute d'information, on l'accepte en le disant. Rejeter sur un doute
 * reviendrait à jeter toutes les fiches jeunes, dont l'INSEE ne publie pas
 * encore la tranche.
 */
export function checkBracket(headcount: number | null, bracket: Bracket | null): BracketVerdict {
  if (!bracket) return "inconnu";
  if (headcount === null) return "inconnu";
  if (headcount < bracket.min) return "hors tranche";
  if (bracket.max !== null && headcount > bracket.max) return "hors tranche";
  return "dans la tranche";
}

/** Phrase affichée dans le détail du scan pour une entreprise écartée. */
export function outOfBracketReason(
  name: string,
  headcount: number | null,
  bracket: Bracket,
): string {
  const actual = headcount === null ? "effectif inconnu" : `${headcount} salariés`;
  return `${name} — ${actual}, hors de la tranche demandée (${bracket.label})`;
}

/**
 * Indice de filiale par le RATIO chiffre d'affaires / effectif.
 *
 * EG RETAIL (FRANCE) SAS déclare 1,296 Md€ de chiffre d'affaires pour 50 à 99
 * salariés. Aucune entreprise autonome ne fait ça : ces montants transitent
 * par une structure qui facture pour un réseau. C'est donc une filiale, même
 * quand aucun représentant personne morale n'apparaît au registre — et la
 * décision d'achat ne se prend pas chez elle.
 */
export const SUBSIDIARY_REVENUE_HINT_EUR = 500_000_000;
export const SUBSIDIARY_HEADCOUNT_HINT = 250;

/** `true` si les chiffres seuls trahissent une filiale. */
export function looksLikeSubsidiaryByFigures(
  revenueEur: number | null | undefined,
  headcount: number | null | undefined,
): boolean {
  if (typeof revenueEur !== "number" || !Number.isFinite(revenueEur)) return false;
  if (typeof headcount !== "number" || !Number.isFinite(headcount) || headcount <= 0) return false;
  return revenueEur > SUBSIDIARY_REVENUE_HINT_EUR && headcount < SUBSIDIARY_HEADCOUNT_HINT;
}

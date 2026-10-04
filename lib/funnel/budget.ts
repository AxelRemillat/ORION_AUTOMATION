/**
 * BUDGET D'EXAMEN — quels signaux bruts passent au filtre, dans le plafond du run.
 *
 * Le filtre coûte une identité annuaire par signal, et l'annuaire est limité en
 * débit. Mesures du 30/09/2026 (69, 38, 42, 01, 73, 74 · 14 j) :
 *   - France Travail (codes ROME back-office) : 125 examinés → 11 retenus ;
 *   - BODACC : 125 examinés → 0 retenu (nominations, capital, reprises de
 *     micro-commerces).
 *
 * Règle : France Travail d'abord, TOUTES les offres qui ont passé le pré-filtre
 * gratuit (intitulé révélant un pain), dans la limite du plafond ; BODACC ne
 * prend jamais plus de 20 % du plafond, même quand France Travail en laisse —
 * un signal qui ne rapporte pas ne remplit pas le budget d'un autre. Parmi les
 * annonces BODACC, les types les plus prometteurs passent d'abord.
 */

/**
 * 1 800 (était 600) : viser ~40 retenus par run (Cowork, 05/10/2026). Au
 * rendement mesuré le 05/10 — 14 % des examinés passent le filtre, 16 % des
 * filtrés sont retenus au tri —, 600 n'en donnaient que 12. Le tri coûte peu ;
 * les plafonds Pappers, Hunter, Linkup et OpenAI restent les garde-fous.
 */
export const MAX_EXAMINED = 1800;
export const BODACC_MAX_SHARE = 0.2;

export interface Examinable {
  id: string;
  source: string;
  date: string;
  /** fort = 3, moyen = 2, faible = 1. */
  strength: number;
  /** Libellé BODACC (« Modification du capital »…), pour classer les types. */
  label?: string;
}

export interface ExaminationPlan<T> {
  examine: T[];
  skip: T[];
  /** Nombre retenu par source, pour le journal du run. */
  bySource: Record<string, number>;
}

/**
 * Rang d'une annonce BODACC : plus il est bas, plus elle passe tôt. Un nouvel
 * établissement ou une augmentation de capital dit un mouvement ; une
 * nomination dit seulement qui signe.
 */
export function bodaccRank(label: string | undefined): number {
  const text = (label ?? "").toLowerCase();
  if (/[ée]tablissement|cr[ée]ation|implantation|transfert/.test(text)) return 0;
  if (/capital/.test(text)) return 1;
  if (/fonds de commerce|reprise|acquisition|cession/.test(text)) return 2;
  if (/directeur|g[ée]rant|pr[ée]sident|devient|nomm/.test(text)) return 3;
  return 4;
}

const freshestFirst = (a: Examinable, b: Examinable) => b.date.localeCompare(a.date);
const bestBodaccFirst = (a: Examinable, b: Examinable) =>
  bodaccRank(a.label) - bodaccRank(b.label) || b.strength - a.strength || b.date.localeCompare(a.date);

export function examinationPlan<T extends Examinable>(rows: readonly T[], budget = MAX_EXAMINED): ExaminationPlan<T> {
  const cap = Math.max(0, Math.floor(budget));
  const offers = rows.filter((row) => row.source === "france-travail").sort(freshestFirst);
  const others = rows.filter((row) => row.source !== "france-travail").sort(bestBodaccFirst);

  const otherTake = Math.min(others.length, Math.floor(cap * BODACC_MAX_SHARE));
  const offerTake = Math.min(offers.length, cap - otherTake);

  const examine = [...offers.slice(0, offerTake), ...others.slice(0, otherTake)];
  const chosen = new Set(examine.map((row) => row.id));
  const bySource: Record<string, number> = {};
  for (const row of examine) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  return { examine, skip: rows.filter((row) => !chosen.has(row.id)), bySource };
}

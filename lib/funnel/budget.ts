/**
 * BUDGET D'EXAMEN — quels signaux bruts passent au filtre, dans le plafond du run.
 *
 * Le filtre coûte une identité annuaire par signal, et l'annuaire est limité en
 * débit : au plus MAX_LOOKUPS par run. Constaté le 30/09/2026 : 2 653 bruts
 * (2 515 BODACC, 138 France Travail), triés « le plus fort d'abord ». Le
 * budget partait sur les annonces BODACC, et 91 offres France Travail sur 138
 * n'ont jamais été lues, alors qu'une offre dont l'intitulé révèle un pain est
 * le signal le plus direct qui soit.
 *
 * Règle : France Travail prend AU MOINS la moitié du budget s'il a assez
 * d'offres, et passe en premier. Le reste va à BODACC (et aux autres sources),
 * le plus fort puis le plus frais d'abord. Les signaux hors budget ne restent
 * pas « bruts » : ils sont marqués « non examiné », avec la raison.
 */

export const FRANCE_TRAVAIL_MIN_SHARE = 0.5;

export interface Examinable {
  id: string;
  source: string;
  date: string;
  /** fort = 3, moyen = 2, faible = 1. */
  strength: number;
}

export interface ExaminationPlan<T> {
  examine: T[];
  skip: T[];
  /** Nombre retenu par source, pour le journal du run. */
  bySource: Record<string, number>;
}

const strongestFirst = (a: Examinable, b: Examinable) => b.strength - a.strength || b.date.localeCompare(a.date);
const freshestFirst = (a: Examinable, b: Examinable) => b.date.localeCompare(a.date);

export function examinationPlan<T extends Examinable>(rows: readonly T[], budget: number): ExaminationPlan<T> {
  const cap = Math.max(0, Math.floor(budget));
  const offers = rows.filter((row) => row.source === "france-travail").sort(freshestFirst);
  const others = rows.filter((row) => row.source !== "france-travail").sort(strongestFirst);

  // France Travail : au moins la moitié du budget, ou tout le reste si BODACC en laisse.
  const offerTake = Math.min(offers.length, Math.max(Math.ceil(cap * FRANCE_TRAVAIL_MIN_SHARE), cap - others.length));
  const otherTake = Math.min(others.length, cap - offerTake);

  const examine = [...offers.slice(0, offerTake), ...others.slice(0, otherTake)];
  const chosen = new Set(examine.map((row) => row.id));
  const bySource: Record<string, number> = {};
  for (const row of examine) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  return { examine, skip: rows.filter((row) => !chosen.has(row.id)), bySource };
}

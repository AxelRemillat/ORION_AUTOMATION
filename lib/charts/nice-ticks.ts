/**
 * Graduations « rondes » pour un axe de graphique — fonction PURE.
 *
 * Corrige un défaut visible : un axe dont le maximum valait 2 affichait
 * « 2, 2, 1, 1, 0 », parce qu'on divisait le domaine en cinq parts égales puis
 * on arrondissait chaque libellé. Deux graduations différentes tombaient sur le
 * même entier. On choisit donc d'abord un PAS rond (1, 2 ou 5 × 10ⁿ), et les
 * graduations en découlent : elles ne peuvent plus se répéter.
 */

export interface TickScale {
  /** Toujours 0 : les volumes comme les euros se lisent depuis zéro. */
  min: number;
  /** Haut du domaine, arrondi au pas supérieur. */
  max: number;
  /** Du bas vers le haut, sans doublon. */
  ticks: number[];
}

/** Pas « rond » le plus proche de `range / count`. */
function niceStep(range: number, count: number): number {
  const rough = range / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function niceTicks(
  rawMax: number,
  options: { integer?: boolean; count?: number } = {},
): TickScale {
  const { integer = false, count = 4 } = options;
  const top = Number.isFinite(rawMax) ? Math.max(0, rawMax) : 0;

  // Petits comptes : un pas de 1 est le seul lisible, et on garde une marge
  // d'une unité pour que la courbe ne touche jamais le plafond.
  if (integer && top <= 4) {
    const max = Math.ceil(top) + 1;
    return { min: 0, max, ticks: Array.from({ length: max + 1 }, (_, index) => index) };
  }

  if (top === 0) return { min: 0, max: 1, ticks: [0, 1] };

  let step = niceStep(top, count);
  if (integer) step = Math.max(1, Math.round(step));

  let max = Math.ceil(top / step) * step;
  // Valeur pile sur une graduation : on monte d'un cran, sinon la courbe
  // s'écrase contre le bord haut du graphique.
  if (max <= top) max += step;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { min: 0, max, ticks: [...new Set(ticks)] };
}

/** Euros en écriture compacte française : 1,2 k€, 15 k€, 340 €. */
export function formatEurCompact(value: number): string {
  if (Math.abs(value) < 1000) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} €`;
  }
  const thousands = value / 1000;
  const digits = Math.abs(thousands) < 10 ? 1 : 0;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(thousands)} k€`;
}

/**
 * Plafond d'analyse — constantes partagees serveur ET client.
 *
 * Volontairement dans son propre module, sans aucune dependance : le
 * formulaire de recherche est un composant client, et importer le barrel
 * `@/lib/enrichment` depuis le navigateur tirerait les clients Pappers /
 * Linkup / Hunter, donc `next/headers`. Le build echoue alors, a juste titre.
 */

/**
 * Plafond de l'ENRICHISSEMENT PROFOND (phase 2 : Pappers, puis Hunter au moment
 * de rediger). Volontairement bas : c'est le poste de cout principal.
 * Ce n'est PAS le nombre d'entreprises examinees — voir la largeur de scan.
 */
export const DEFAULT_ANALYSIS_LIMIT = 3;
export const MAX_ANALYSIS_LIMIT = 10;

/**
 * Largeur du SCAN (phase 1 : une recherche Linkup par candidat).
 *
 * Les signaux sont rares : n'examiner que 3 entreprises revient a tirer au sort
 * dans l'annuaire et a ne rien trouver. On ratisse donc large avec la source la
 * moins chere, et on ne depense le reste que sur les entreprises qui ressortent.
 */
export const DEFAULT_SCAN_WIDTH = 18;
export const MIN_SCAN_WIDTH = 5;
/**
 * 60 entreprises examinees au maximum, soit 180 recherches Linkup avec le
 * facteur de budget de 3.
 *
 * Le plafond etait a 25, ce qui bornait le scan a 75 recherches : sur une zone
 * pauvre en signaux, la boucle s'arretait « plafond atteint » sans avoir de quoi
 * remplir l'objectif. Monter le plafond ne change rien au cout d'une recherche
 * ordinaire — c'est un maximum que l'utilisateur choisit, pas une valeur par
 * defaut — mais il fallait borner le TEMPS : une etape de job coupee a 300 s
 * serait rejouee depuis le debut, et les recherches deja payees le seraient deux
 * fois. Voir SCAN_TIME_BUDGET_MS.
 */
export const MAX_SCAN_WIDTH = 60;

/** Ramene une saisie utilisateur dans les bornes autorisees. */
export function clampAnalysisLimit(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_LIMIT;
  return Math.max(1, Math.min(MAX_ANALYSIS_LIMIT, parsed));
}

/** Idem pour la largeur de scan. */
export function clampScanWidth(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_WIDTH;
  return Math.max(MIN_SCAN_WIDTH, Math.min(MAX_SCAN_WIDTH, parsed));
}

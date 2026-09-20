/**
 * Plafond d'analyse — constantes partagees serveur ET client.
 *
 * Volontairement dans son propre module, sans aucune dependance : le
 * formulaire de recherche est un composant client, et importer le barrel
 * `@/lib/enrichment` depuis le navigateur tirerait les clients Pappers /
 * Linkup / Hunter, donc `next/headers`. Le build echoue alors, a juste titre.
 */

/** Defaut volontairement bas : chaque entreprise analysee coute des credits. */
export const DEFAULT_ANALYSIS_LIMIT = 3;
export const MAX_ANALYSIS_LIMIT = 10;

/** Ramene une saisie utilisateur dans les bornes autorisees. */
export function clampAnalysisLimit(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_LIMIT;
  return Math.max(1, Math.min(MAX_ANALYSIS_LIMIT, parsed));
}

import type { Opportunity } from "./types";

/**
 * Ce que l'écran peut afficher AVANT la réponse du serveur (Cowork #23) : les champs
 * envoyés tels quels, « seen: true » devenant seen_at. Le serveur complète ensuite
 * (jalons datés) ou refuse, et l'écran revient alors aux valeurs d'avant.
 */
export function optimisticPatch(body: Record<string, unknown>, now = new Date()): Partial<Opportunity> {
  const { seen, ...rest } = body;
  return { ...(rest as Partial<Opportunity>), ...(seen === true ? { seen_at: now.toISOString() } : {}) };
}

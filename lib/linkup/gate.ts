import { parisMidnight } from "@/lib/hunter/gate";

/**
 * GARDE-FOU LINKUP — plafond journalier et cache, pour TOUS les appels Linkup.
 *
 * Décision Cowork (complétion automatique, 05/10/2026) : la recherche de site
 * par Linkup est permise, mais bornée.
 *   - budget du jour : `LINKUP_DAILY_BUDGET` recherches (30 par défaut ;
 *     0 = Linkup coupé), compté sur `api_usage` depuis minuit à Paris — chaque
 *     recherche y est journalisée, donc visible dans Pilotage ;
 *   - cache 90 jours par requête : la même question ne se paie qu'une fois.
 * Avant, la recherche de contact faisait jusqu'à 3 recherches par fiche, sans
 * plafond du jour.
 */

export const LINKUP_CACHE_TTL_MS = 90 * 86_400_000;
export const DEFAULT_LINKUP_DAILY_BUDGET = 30;
export const LINKUP_EPUISE = "Linkup : budget du jour atteint";

export function linkupDailyBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LINKUP_DAILY_BUDGET;
  if (raw === undefined || raw.trim() === "") return DEFAULT_LINKUP_DAILY_BUDGET;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LINKUP_DAILY_BUDGET;
}

export const linkupCacheKey = (query: string) => `linkup:search:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;

export interface LinkupGateStore {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  /** Recherches facturées depuis cet instant (journal `api_usage`). */
  usedSince(since: Date): Promise<number>;
}

export type Gated<T> = { status: "cache"; value: T } | { status: "blocked"; reason: string } | { status: "call" };

/** Que faire de cette recherche : servir le cache, la refuser, ou l'appeler. */
export async function linkupGate<T>(store: LinkupGateStore, query: string, now: Date = new Date()): Promise<Gated<T>> {
  const hit = await store.read(linkupCacheKey(query)).catch(() => null);
  if (hit !== null && hit !== undefined) return { status: "cache", value: hit as T };
  const budget = linkupDailyBudget();
  if (budget === 0) return { status: "blocked", reason: `${LINKUP_EPUISE} (LINKUP_DAILY_BUDGET = 0)` };
  const used = await store.usedSince(parisMidnight(now)).catch(() => budget);
  if (used >= budget) return { status: "blocked", reason: `${LINKUP_EPUISE} (${used}/${budget})` };
  return { status: "call" };
}

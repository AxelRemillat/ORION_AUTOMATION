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
/** Lectures de page (/v1/fetch, dix fois moins chères) : plafond à part. */
export const DEFAULT_LINKUP_FETCH_DAILY_BUDGET = 60;

/**
 * Libellés journalisés dans `api_usage.operation` (Pilotage) :
 *   - linkup_site   : recherche du SITE d'une fiche (lib/contact-finder) ;
 *   - linkup_enrich : recherche web de l'enrichissement (signaux, actualités) ;
 *   - linkup_enrich_fetch : lecture d'une page par l'enrichissement.
 */
export const LINKUP_OPERATIONS = { site: "linkup_site", enrich: "linkup_enrich", fetch: "linkup_enrich_fetch" } as const;
export type LinkupKind = "search" | "fetch";
/** Opérations comptées dans chaque plafond (anciens libellés compris). */
export const COUNTED_OPERATIONS: Record<LinkupKind, string[]> = {
  search: ["linkup_site", "linkup_enrich", "search", "contact:search"],
  fetch: ["linkup_enrich_fetch", "fetch"],
};
export const LINKUP_EPUISE = "Linkup : budget du jour atteint";

export function linkupDailyBudget(env: Record<string, string | undefined> = process.env, kind: LinkupKind = "search"): number {
  const name = kind === "fetch" ? "LINKUP_FETCH_DAILY_BUDGET" : "LINKUP_DAILY_BUDGET";
  const fallback = kind === "fetch" ? DEFAULT_LINKUP_FETCH_DAILY_BUDGET : DEFAULT_LINKUP_DAILY_BUDGET;
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const linkupCacheKey = (query: string) => `linkup:search:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;

export interface LinkupGateStore {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  /** Appels facturés depuis cet instant (journal `api_usage`), pour ce plafond. */
  usedSince(since: Date, kind?: LinkupKind): Promise<number>;
}

export type Gated<T> = { status: "cache"; value: T } | { status: "blocked"; reason: string } | { status: "call" };

/** Que faire de cette recherche : servir le cache, la refuser, ou l'appeler. */
export async function linkupGate<T>(store: LinkupGateStore, query: string, now: Date = new Date(), kind: LinkupKind = "search"): Promise<Gated<T>> {
  const hit = await store.read(linkupCacheKey(kind === "fetch" ? `fetch:${query}` : query)).catch(() => null);
  if (hit !== null && hit !== undefined) return { status: "cache", value: hit as T };
  const budget = linkupDailyBudget(process.env, kind);
  if (budget === 0) return { status: "blocked", reason: `${LINKUP_EPUISE} (plafond ${kind} = 0)` };
  const used = await store.usedSince(parisMidnight(now), kind).catch(() => budget);
  if (used >= budget) return { status: "blocked", reason: `${LINKUP_EPUISE} (${used}/${budget})` };
  return { status: "call" };
}

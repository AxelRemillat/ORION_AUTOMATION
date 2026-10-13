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

/**
 * PLAFOND PAR JOB ET PART RÉSERVÉE PAR SEGMENT (Cowork #37) — sans relever le
 * budget du jour :
 *   - `cap` : un job ne dépasse pas N recherches depuis son début ;
 *   - `LINKUP_RESERVE` (ex. « agences:10 ») : N recherches du budget du jour
 *     sont réservées à un segment ; les jobs d'un AUTRE segment (ou sans
 *     segment) s'arrêtent à budget − réserve. Défaut : aucune réserve.
 * Le contexte du job vit dans lib/linkup/run-cap.ts (serveur) et s'enregistre ici.
 */
export type LinkupRunContext = { cap?: number | null; segment?: string | null; since: Date };
let readRunContext: () => LinkupRunContext | undefined = () => undefined;
export function registerLinkupRunReader(reader: () => LinkupRunContext | undefined): void {
  readRunContext = reader;
}

/**
 * PRIORITÉ À LA RECHERCHE DE SITE (Cowork #27) : sans site, une fiche retenue est perdue
 * (« Sans site » : 159 retenues de score 4-5 en 14 jours, autant que les fiches creusées),
 * alors que l'enrichissement n'ajoute que des faits. `LINKUP_SITE_RESERVE` recherches du
 * budget du jour (15 par défaut) restent aux sites : l'enrichissement s'arrête à
 * budget − réserve, la recherche de site garde tout le budget. Rien n'est relevé.
 */
export const DEFAULT_LINKUP_SITE_RESERVE = 15;
export function linkupSiteReserve(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LINKUP_SITE_RESERVE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_LINKUP_SITE_RESERVE;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LINKUP_SITE_RESERVE;
}
export type LinkupPurpose = "site" | "enrich";

/** « agences:10, autre:5 » → { agences: 10, autre: 5 }. */
export function linkupReserves(env: Record<string, string | undefined> = process.env): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (env.LINKUP_RESERVE ?? "").split(",")) {
    const [segment, value] = part.split(":").map((item) => item?.trim());
    const count = Math.floor(Number(value));
    if (segment && Number.isFinite(count) && count > 0) out[segment.toLowerCase()] = count;
  }
  return out;
}

/** Budget du jour accessible à un job d'un segment donné (réserves des autres segments retirées). */
export function budgetFor(budget: number, segment: string | null | undefined, reserves: Record<string, number>): number {
  const others = Object.entries(reserves)
    .filter(([name]) => name !== (segment ?? "").toLowerCase())
    .reduce((total, [, count]) => total + count, 0);
  return Math.max(0, budget - others);
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
export async function linkupGate<T>(store: LinkupGateStore, query: string, now: Date = new Date(), kind: LinkupKind = "search", purpose: LinkupPurpose = "site"): Promise<Gated<T>> {
  const hit = await store.read(linkupCacheKey(kind === "fetch" ? `fetch:${query}` : query)).catch(() => null);
  if (hit !== null && hit !== undefined) return { status: "cache", value: hit as T };
  const budget = linkupDailyBudget(process.env, kind);
  if (budget === 0) return { status: "blocked", reason: `${LINKUP_EPUISE} (plafond ${kind} = 0)` };
  const used = await store.usedSince(parisMidnight(now), kind).catch(() => budget);
  if (used >= budget) return { status: "blocked", reason: `${LINKUP_EPUISE} (${used}/${budget})` };
  if (kind === "search") {
    const run = readRunContext();
    const reserves = linkupReserves();
    const allowed = budgetFor(budget, run?.segment, reserves);
    if (used >= allowed) return { status: "blocked", reason: `${LINKUP_EPUISE} : part réservée à un autre segment (${used}/${allowed} sur ${budget})` };
    // L'enrichissement laisse la réserve aux recherches de site (Cowork #27).
    const forEnrich = Math.max(0, allowed - linkupSiteReserve());
    if (purpose === "enrich" && used >= forEnrich) return { status: "blocked", reason: `${LINKUP_EPUISE} : part réservée à la recherche de site (${used}/${forEnrich} sur ${budget})` };
    if (run && typeof run.cap === "number" && run.cap >= 0) {
      const inRun = await store.usedSince(run.since, kind).catch(() => run.cap!);
      if (inRun >= run.cap) return { status: "blocked", reason: `${LINKUP_EPUISE} : plafond du job atteint (${inRun}/${run.cap})` };
    }
  }
  return { status: "call" };
}

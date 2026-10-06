/**
 * Garde-fou unique devant TOUT appel Hunter (domain-search, email-finder,
 * email-verifier) — économie de crédits, décidée le 01/10/2026 après un run
 * qui a épuisé le compte d'un coup.
 *
 * Compte au 02/10/2026 : Hunter **Starter**, 2 000 crédits par mois, remis à
 * zéro le 2 du mois.
 *
 * Trois règles, dans cet ordre :
 *
 *  1. CACHE PAR DOMAINE, 90 JOURS. Une même requête (même domaine, même nom,
 *     même adresse) n'est jamais repayée : la réponse est relue dans
 *     `enrichment_cache` (clé `hunter:…`). Une panne n'est pas mise en cache.
 *  2. BUDGET QUOTIDIEN (`HUNTER_DAILY_BUDGET`, 80 par défaut ; 0 = Hunter
 *     coupé). Compté sur `api_usage` depuis minuit à Paris : ce qui est
 *     facturé, pas ce qui est tenté.
 *  3. CRÉDITS ÉPUISÉS : après un refus de quota (HTTP 429), plus aucun appel
 *     jusqu'au lendemain — inutile de se faire refuser trente fois.
 *
 * Bloqué n'est jamais une erreur : l'appelant continue en mode gratuit et
 * marque la fiche « à compléter (Hunter épuisé) ».
 *
 * Les accès (cache, compteur du jour) sont injectables : les tests tournent
 * sans réseau ni base.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const HUNTER_CACHE_TTL_MS = 90 * 86_400_000;

/**
 * PLAFOND D'UN LOT (Cowork #34) : un job peut borner SES crédits Hunter (ex. 40
 * pour une préparation de mesure), en plus du budget du jour. Porté par le
 * contexte asynchrone de l'étape : seuls les appels faits sous ce contexte sont
 * concernés. Compté sur `api_usage` depuis le début du lot.
 */
export const hunterRunCap = new AsyncLocalStorage<{ cap: number; since: Date }>();

export function withHunterRunCap<T>(cap: number | null | undefined, since: Date, run: () => Promise<T>): Promise<T> {
  return typeof cap === "number" && cap >= 0 ? hunterRunCap.run({ cap, since }, run) : run();
}
/**
 * 80 par jour (06/10/2026, contacts nominatifs) : le Starter donne 2 000 crédits
 * par mois et seuls 9 étaient utilisés — la recherche du BON destinataire (Domain
 * Search + Finder + Verifier, ~3 crédits par fiche) vaut la dépense.
 */
export const DEFAULT_HUNTER_DAILY_BUDGET = 80;

/** Motif affiché quand Hunter n'est pas appelé faute de crédit. */
export const HUNTER_EPUISE = "Hunter épuisé";

export interface HunterGateStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Recherches Hunter FACTURÉES depuis `since` (api_usage). */
  usedSince(since: Date): Promise<number>;
}

/** Budget du jour, paramétrable par `HUNTER_DAILY_BUDGET` (entier ≥ 0). */
export function hunterDailyBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = env.HUNTER_DAILY_BUDGET;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HUNTER_DAILY_BUDGET;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_HUNTER_DAILY_BUDGET;
}

const PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Minuit du jour EN COURS à Paris, en instant UTC. */
export function parisMidnight(now: Date = new Date()): Date {
  const parts = Object.fromEntries(PARIS.formatToParts(now).map((p) => [p.type, p.value]));
  const sinceMidnightMs =
    (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - sinceMidnightMs);
}

/** Clé de cache : l'appel et ses paramètres (hors clé d'API), en minuscules et triés. */
export function hunterCacheKey(path: string, params: Record<string, string>): string {
  const parts = Object.entries(params)
    .filter(([name]) => name !== "api_key")
    .map(([name, value]) => `${name}=${value.trim().toLowerCase()}`)
    .sort();
  return `hunter:${path}:${parts.join("&")}`;
}

/** Crédits refusés par Hunter (429) : fin du blocage, en ms. Mémoire du processus. */
let exhaustedUntil = 0;

/** À appeler sur un refus de quota : plus d'appel avant minuit à Paris. */
export function markHunterExhausted(now: Date = new Date()): void {
  exhaustedUntil = parisMidnight(now).getTime() + 86_400_000;
}

/** Remise à zéro — tests uniquement. */
export function resetHunterGate(): void {
  exhaustedUntil = 0;
}

export interface HunterStatus {
  usedToday: number;
  budget: number;
  remaining: number;
  /** `null` si un appel est possible, sinon le motif. */
  blocked: string | null;
}

export async function hunterStatus(store: HunterGateStore, now: Date = new Date()): Promise<HunterStatus> {
  const budget = hunterDailyBudget();
  const usedToday = await store.usedSince(parisMidnight(now)).catch(() => 0);
  let remaining = Math.max(0, budget - usedToday);
  const lot = hunterRunCap.getStore();
  const usedInLot = lot ? await store.usedSince(lot.since).catch(() => 0) : 0;
  if (lot) remaining = Math.min(remaining, Math.max(0, lot.cap - usedInLot));
  const blocked =
    now.getTime() < exhaustedUntil
      ? `${HUNTER_EPUISE} : crédits du compte épuisés`
      : Math.max(0, budget - usedToday) <= 0
        ? `${HUNTER_EPUISE} : budget du jour atteint (${usedToday}/${budget})`
        : lot && usedInLot >= lot.cap
          ? `${HUNTER_EPUISE} : plafond du lot atteint (${usedInLot}/${lot.cap})`
          : null;
  return { usedToday, budget, remaining, blocked };
}

export type GatedCall<T> =
  | { status: "cache"; data: T }
  | { status: "appel"; data: T | null; quotaExceeded: boolean }
  | { status: "bloque"; reason: string };

/**
 * Un appel Hunter passé par le garde-fou. `call` n'est exécuté qu'en défaut de
 * cache ET avec du budget ; sa réponse non nulle est mise en cache 90 jours.
 * L'appelant journalise lui-même l'usage facturé (statut « appel » seulement).
 */
export async function gatedHunterCall<T>(
  store: HunterGateStore,
  key: string,
  call: () => Promise<{ data: T | null; quotaExceeded: boolean }>,
  now: Date = new Date(),
): Promise<GatedCall<T>> {
  const hit = await store.read<T>(key).catch(() => null);
  if (hit !== null) return { status: "cache", data: hit };

  const status = await hunterStatus(store, now);
  if (status.blocked) return { status: "bloque", reason: status.blocked };

  const result = await call();
  if (result.quotaExceeded) markHunterExhausted(now);
  if (result.data !== null) await store.write(key, result.data, HUNTER_CACHE_TTL_MS).catch(() => undefined);
  return { status: "appel", ...result };
}

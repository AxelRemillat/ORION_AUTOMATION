import { readCache, writeCache } from "@/lib/enrichment/cache";
import { fetchJson } from "@/lib/enrichment/http";
import { utcToParis } from "@/lib/outbox/paris-time";
import { openAiMonthlyBudget } from "./pricing";

/**
 * Tuiles « Crédits restants » du Cockpit — fournisseurs PAYANTS.
 *
 *   - Hunter : forfait Starter, 2 000 crédits par mois, remis à zéro le 2 ;
 *   - Pappers : abonnement ~500 crédits par mois ;
 *   - OpenAI : euros consommés dans le mois (et reste du budget s'il est fixé).
 *
 * Solde EXACT quand le fournisseur l'expose (Hunter /v2/account, Pappers
 * /v2/suivi-jetons) : lu côté serveur, mis en cache 1 h (`enrichment_cache`),
 * jamais à chaque chargement, jamais de clé côté client. Sinon ESTIMATION =
 * quota − consommation journalisée (`api_usage`), affichée « estimé ».
 */

export const HUNTER_MONTHLY_CREDITS = 2000;
export const HUNTER_RESET_DAY = 2;
export const PAPPERS_MONTHLY_CREDITS = Number(process.env.PAPPERS_PLAN_CREDITS ?? "500");
export const CREDITS_CACHE_MS = 60 * 60_000;

export interface CreditTile {
  key: "hunter" | "pappers" | "openai";
  label: string;
  /** Ce qu'il reste ; `null` si inconnu (OpenAI sans budget). */
  remaining: number | null;
  /** Forfait de référence ; `null` si aucun. */
  total: number | null;
  /** Consommé sur la période (mois ou cycle Hunter). */
  used: number;
  unit: string;
  quality: "exact" | "estime";
  basis: string;
}

export interface Exact {
  remaining: number;
  total: number | null;
}

function shiftMonth(day: string, delta: number): string {
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Début du cycle Hunter en cours : le 2 du mois (Paris), ou celui du mois précédent. */
export function hunterCycleStart(now: Date): string {
  const today = utcToParis(now).date;
  const day = Number(today.slice(8, 10));
  const month = day >= HUNTER_RESET_DAY ? today.slice(0, 7) : shiftMonth(today, -1);
  return `${month}-0${HUNTER_RESET_DAY}`;
}

/** Prochaine remise à zéro Hunter (AAAA-MM-JJ). */
export function hunterNextReset(now: Date): string {
  return `${shiftMonth(hunterCycleStart(now), 1)}-0${HUNTER_RESET_DAY}`;
}

/** Tuiles, à partir des soldes exacts (s'ils existent) et de la consommation journalisée. */
export function buildCreditTiles(input: {
  hunterUsed: number;
  pappersUsed: number;
  openaiEur: number;
  hunterExact: Exact | null;
  pappersExact: Exact | null;
  openaiBudget: number | null;
  now: Date;
  /** Crédits Hunter facturés aujourd'hui (Paris) et plafond du jour (`HUNTER_DAILY_BUDGET`). */
  hunterToday?: { used: number; budget: number };
}): CreditTile[] {
  const today = input.hunterToday ? ` · aujourd'hui ${input.hunterToday.used} / ${input.hunterToday.budget}` : "";
  const reset = new Date(`${hunterNextReset(input.now)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
  const hunter: CreditTile = input.hunterExact
    ? {
        key: "hunter", label: "Hunter", remaining: input.hunterExact.remaining, total: input.hunterExact.total ?? HUNTER_MONTHLY_CREDITS,
        used: input.hunterUsed, unit: "crédits", quality: "exact", basis: `Compte Hunter · remise à zéro le ${reset}${today}`,
      }
    : {
        key: "hunter", label: "Hunter", remaining: Math.max(0, HUNTER_MONTHLY_CREDITS - input.hunterUsed), total: HUNTER_MONTHLY_CREDITS,
        used: input.hunterUsed, unit: "crédits", quality: "estime",
        basis: `${HUNTER_MONTHLY_CREDITS} − ${input.hunterUsed} journalisés depuis le 2 · remise à zéro le ${reset}${today}`,
      };
  const pappers: CreditTile = input.pappersExact
    ? {
        key: "pappers", label: "Pappers", remaining: input.pappersExact.remaining, total: input.pappersExact.total ?? PAPPERS_MONTHLY_CREDITS,
        used: input.pappersUsed, unit: "crédits", quality: "exact", basis: "Compte Pappers (/suivi-jetons)",
      }
    : {
        key: "pappers", label: "Pappers", remaining: Math.max(0, PAPPERS_MONTHLY_CREDITS - input.pappersUsed), total: PAPPERS_MONTHLY_CREDITS,
        used: input.pappersUsed, unit: "crédits", quality: "estime",
        basis: `${PAPPERS_MONTHLY_CREDITS} − ${input.pappersUsed} journalisés ce mois`,
      };
  const openai: CreditTile = {
    key: "openai", label: "OpenAI",
    remaining: input.openaiBudget !== null ? Math.max(0, Math.round((input.openaiBudget - input.openaiEur) * 100) / 100) : null,
    total: input.openaiBudget,
    used: Math.round(input.openaiEur * 100) / 100,
    unit: "€",
    // La dépense vient des tokens réellement facturés ; le reste dépend d'un budget fixé à la main.
    quality: input.openaiBudget !== null ? "estime" : "exact",
    basis: input.openaiBudget !== null ? `budget ${input.openaiBudget} € − dépense journalisée du mois` : "dépense du mois (tokens facturés) · aucun budget fixé",
  };
  return [hunter, pappers, openai];
}

// --- Soldes exacts, en cache 1 h --------------------------------------------------

/** Lecture mise en cache : un échec est aussi gardé 1 h (on ne martèle pas l'API). */
export async function cachedExact(
  key: string,
  fetcher: () => Promise<Exact | null>,
  cache: { read: typeof readCache; write: typeof writeCache } = { read: readCache, write: writeCache },
): Promise<Exact | null> {
  const hit = await cache.read<{ value: Exact | null }>(`credits:${key}`);
  if (hit) return hit.value;
  const value = await fetcher().catch(() => null);
  await cache.write(`credits:${key}`, { value }, CREDITS_CACHE_MS);
  return value;
}

/** Hunter /v2/account : crédits (forfait Starter) ou recherches, selon la réponse. */
export async function fetchHunterExact(): Promise<Exact | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const response = await fetchJson<{ data?: { requests?: Record<string, { used?: number; available?: number }> } }>(
    `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`,
    {},
    8_000,
  );
  if (!response.ok) return null;
  const requests = response.data.data?.requests ?? {};
  const bucket = requests.credits ?? requests.searches;
  if (typeof bucket?.available !== "number") return null;
  const used = typeof bucket.used === "number" ? bucket.used : 0;
  return { remaining: Math.max(0, bucket.available - used), total: bucket.available };
}

/** Pappers /v2/suivi-jetons : forfait du mois − utilisé + pay-as-you-go. */
export async function fetchPappersExact(): Promise<Exact | null> {
  const key = process.env.PAPPERS_API_KEY;
  if (!key) return null;
  const response = await fetchJson<Record<string, unknown>>(
    `https://api.pappers.fr/v2/suivi-jetons?api_token=${encodeURIComponent(key)}`,
    {},
    8_000,
  );
  if (!response.ok) return null;
  const plan = Number(response.data.jetons_abonnement);
  if (!Number.isFinite(plan)) return null;
  const used = Number(response.data.jetons_abonnement_utilises) || 0;
  const payg = Number(response.data.jetons_pay_as_you_go_restants) || 0;
  return { remaining: Math.max(0, plan - used) + Math.max(0, payg), total: plan };
}

/** Borne de temps : le Cockpit ne doit jamais attendre un fournisseur. */
export async function withinMs<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((done) => {
    timer = setTimeout(() => done(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export { openAiMonthlyBudget };

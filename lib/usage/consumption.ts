import { utcToParis } from "@/lib/outbox/paris-time";

/**
 * Graphe « Consommation » du Cockpit — agrégats calculés CÔTÉ SERVEUR à partir
 * des journaux déjà tenus : `api_usage` (fournisseurs payants, coût exact à
 * l'insertion) et `free_api_calls` (INPI et autres gratuits, coût nul).
 *
 * Code pur : jours et mois au fuseau de Paris, aucune requête ici.
 */

export const PROVIDERS = ["openai", "hunter", "pappers", "linkup", "gratuit"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  hunter: "Hunter",
  pappers: "Pappers",
  linkup: "Linkup",
  gratuit: "INPI / gratuits",
};

export interface UsageRow {
  service: string;
  units: number | string | null;
  cost: number | string | null;
  created_at: string;
}

export interface FreeRow {
  service: string;
  units: number | string | null;
  created_at: string;
}

/**
 * Une journée déjà agrégée par la base (vues `api_usage_daily` /
 * `free_api_calls_daily`) : `day` est une date de Paris, `calls` le nombre
 * d'appels, `eur` leur coût, `units` les unités (tokens pour OpenAI).
 *
 * C'est la MÊME information que les lignes brutes, comptée par Postgres au
 * lieu de l'être en JavaScript après 14 aller-retours (mesure du 12/10/2026 :
 * 12 076 lignes sur 30 jours).
 */
export interface DailyRow {
  day: string;
  service: string;
  calls: number | string | null;
  eur?: number | string | null;
  units?: number | string | null;
}

type PerProvider = Record<Provider, number>;

export interface DayBar {
  /** AAAA-MM-JJ, heure de Paris. */
  day: string;
  /** Requêtes par fournisseur (une ligne journalisée = une requête). */
  calls: PerProvider;
  /** Euros par fournisseur. */
  eur: PerProvider;
  /** Tokens OpenAI du jour. */
  tokens: number;
}

export interface Consumption {
  days: DayBar[];
  /** Totaux sur la fenêtre affichée (30 jours). */
  window: { calls: PerProvider; eur: PerProvider; tokens: number };
  /** Mois calendaire en cours (Paris). */
  month: {
    label: string;
    eur: number;
    byProvider: PerProvider;
    daysElapsed: number;
    daysInMonth: number;
    /** Projection linéaire fin de mois : dépense ÷ jours écoulés × jours du mois. */
    projection: number;
  };
  empty: boolean;
}

const zero = (): PerProvider => ({ openai: 0, hunter: 0, pappers: 0, linkup: 0, gratuit: 0 });
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const providerOf = (service: string): Provider =>
  (PROVIDERS as readonly string[]).includes(service) && service !== "gratuit" ? (service as Provider) : "gratuit";

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Premier instant (UTC, large) à lire en base pour couvrir la fenêtre ET le mois. */
export function consumptionSince(now: Date, days = 30): string {
  const today = utcToParis(now).date;
  const windowStart = shiftDay(today, -(days - 1));
  const monthStart = `${today.slice(0, 8)}01`;
  const first = windowStart < monthStart ? windowStart : monthStart;
  // Un jour de marge : le fuseau de Paris précède UTC.
  return `${shiftDay(first, -1)}T00:00:00Z`;
}

/**
 * Regroupe des lignes brutes par jour de Paris et par service — le format que
 * la base rend déjà par les vues. Utilisé par le chemin de repli.
 */
export function toDailyRows(usage: readonly UsageRow[], free: readonly FreeRow[]): DailyRow[] {
  const byKey = new Map<string, DailyRow & { calls: number; eur: number; units: number }>();
  const push = (createdAt: string, service: string, eur: number, units: number) => {
    const day = utcToParis(new Date(createdAt)).date;
    const key = `${day}|${service}`;
    const current = byKey.get(key) ?? { day, service, calls: 0, eur: 0, units: 0 };
    current.calls += 1;
    current.eur += eur;
    current.units += units;
    byKey.set(key, current);
  };
  for (const row of usage) push(row.created_at, row.service, num(row.cost), num(row.units));
  // Un appel gratuit n'a pas de coût, et ses unités ne sont pas des tokens.
  for (const row of free) push(row.created_at, "gratuit", 0, 0);
  return [...byKey.values()];
}

/** Même agrégat, à partir des lignes brutes (chemin de repli). */
export function buildConsumption(usage: readonly UsageRow[], free: readonly FreeRow[], now = new Date(), days = 30): Consumption {
  return buildConsumptionFromDaily(toDailyRows(usage, free), now, days);
}

/** Somme des unités d'un service depuis un jour donné (inclus), sur des journées agrégées. */
export function sumDailyUnits(rows: readonly DailyRow[], service: string, fromDay: string): number {
  return rows
    .filter((row) => row.service === service && row.day >= fromDay)
    .reduce((total, row) => total + num(row.units), 0);
}

/**
 * Le CŒUR : des journées (une par jour et par service) deviennent les barres du
 * graphe, les totaux de la fenêtre et ceux du mois en cours.
 */
export function buildConsumptionFromDaily(rows: readonly DailyRow[], now = new Date(), days = 30): Consumption {
  const today = utcToParis(now).date;
  const dayKeys = Array.from({ length: days }, (_, index) => shiftDay(today, index - (days - 1)));
  const byDay = new Map<string, DayBar>(dayKeys.map((day) => [day, { day, calls: zero(), eur: zero(), tokens: 0 }]));
  const window = { calls: zero(), eur: zero(), tokens: 0 };
  const monthKey = today.slice(0, 7);
  const monthByProvider = zero();

  const add = (day: string, provider: Provider, calls: number, eur: number, tokens: number) => {
    const bar = byDay.get(day);
    if (bar) {
      bar.calls[provider] += calls;
      bar.eur[provider] += eur;
      bar.tokens += tokens;
      window.calls[provider] += calls;
      window.eur[provider] += eur;
      window.tokens += tokens;
    }
    // Le mois en cours compte même les jours sortis de la fenêtre affichée.
    if (day.slice(0, 7) === monthKey) monthByProvider[provider] += eur;
  };

  for (const row of rows) {
    const provider = providerOf(row.service);
    // Les tokens ne sont comptés que pour OpenAI : ailleurs, `units` est un nombre d'appels.
    add(row.day, provider, num(row.calls), num(row.eur), provider === "openai" ? num(row.units) : 0);
  }

  const daysElapsed = Number(today.slice(8, 10));
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEur = PROVIDERS.reduce((total, provider) => total + monthByProvider[provider], 0);
  const label = new Date(`${today.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

  return {
    days: dayKeys.map((day) => byDay.get(day)!),
    window,
    month: {
      label,
      eur: round(monthEur),
      byProvider: Object.fromEntries(PROVIDERS.map((provider) => [provider, round(monthByProvider[provider])])) as PerProvider,
      daysElapsed,
      daysInMonth,
      projection: daysElapsed > 0 ? round((monthEur / daysElapsed) * daysInMonth) : 0,
    },
    empty: PROVIDERS.every((provider) => window.calls[provider] === 0),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

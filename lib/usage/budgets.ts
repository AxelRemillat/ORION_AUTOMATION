import { parisToUtc, utcToParis } from "@/lib/outbox/paris-time";

/**
 * PLAFONDS DE DÉPENSE RÉELS (03/10/2026).
 *
 *   - Pappers : PAPPERS_DAILY_BUDGET crédits par jour (défaut 40), remis à zéro
 *     à minuit, heure de Paris. Au-delà, l'appel Pappers n'est PAS fait : les
 *     appelants passent au repli gratuit (Recherche d'entreprises + INPI) ou
 *     reportent au lendemain.
 *   - OpenAI : OPENAI_MONTHLY_BUDGET_EUR € par mois (défaut 15). À 80 % : alerte
 *     dans Cockpit › Pilotage. À 100 % : la préparation quotidienne s'arrête
 *     proprement (brouillons déjà faits conservés) et « Lancer maintenant » dit
 *     pourquoi.
 *
 * Les compteurs sont lus dans `api_usage` (ce qui a été réellement facturé).
 * Code pur ici ; la lecture en base est dans budgets-server.ts.
 */

export const DEFAULT_PAPPERS_DAILY_BUDGET = 40;
export const DEFAULT_OPENAI_MONTHLY_BUDGET_EUR = 15;
export const OPENAI_ALERT_RATIO = 0.8;

const positive = (raw: string | undefined, fallback: number, allowZero = false) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : fallback;
};

/** Crédits Pappers par jour ; 0 = Pappers coupé. */
export function pappersDailyBudget(env: Record<string, string | undefined> = process.env): number {
  return Math.floor(positive(env.PAPPERS_DAILY_BUDGET, DEFAULT_PAPPERS_DAILY_BUDGET, true));
}

/** Plafond mensuel OpenAI en euros. */
export function openAiMonthlyCap(env: Record<string, string | undefined> = process.env): number {
  return positive(env.OPENAI_MONTHLY_BUDGET_EUR, DEFAULT_OPENAI_MONTHLY_BUDGET_EUR);
}

/** Minuit (Paris) du jour courant, en UTC. */
export function parisDayStart(now = new Date()): Date {
  return parisToUtc(utcToParis(now).date, "00:00") as Date;
}

/** 1er du mois (Paris), minuit, en UTC. */
export function parisMonthStart(now = new Date()): Date {
  return parisToUtc(`${utcToParis(now).date.slice(0, 8)}01`, "00:00") as Date;
}

export type PappersGate = { allowed: true; used: number; budget: number } | { allowed: false; used: number; budget: number; reason: string };

export function pappersGate(usedToday: number, budget: number): PappersGate {
  if (budget <= 0) return { allowed: false, used: usedToday, budget, reason: "Pappers coupé (PAPPERS_DAILY_BUDGET = 0)" };
  if (usedToday >= budget) {
    return { allowed: false, used: usedToday, budget, reason: `budget Pappers du jour atteint (${usedToday}/${budget}) : repli gratuit, reprise demain` };
  }
  return { allowed: true, used: usedToday, budget };
}

export type OpenAiLevel = "ok" | "alerte" | "plafond";

export interface OpenAiBudgetState {
  level: OpenAiLevel;
  spent: number;
  cap: number;
  ratio: number;
  /** Phrase affichée (Cockpit, « Lancer maintenant », Réglages), `null` si tout va bien. */
  message: string | null;
}

const eur = (value: number) => `${value.toFixed(2).replace(".", ",")} €`;

export function openAiBudgetState(spentThisMonth: number, cap: number): OpenAiBudgetState {
  const spent = Math.round(spentThisMonth * 100) / 100;
  const ratio = cap > 0 ? spent / cap : 1;
  if (ratio >= 1) {
    return { level: "plafond", spent, cap, ratio, message: `Plafond OpenAI du mois atteint (${eur(spent)} / ${eur(cap)}) : la préparation est arrêtée jusqu'au 1er du mois prochain.` };
  }
  if (ratio >= OPENAI_ALERT_RATIO) {
    return { level: "alerte", spent, cap, ratio, message: `OpenAI : ${Math.round(ratio * 100)} % du plafond mensuel consommé (${eur(spent)} / ${eur(cap)}).` };
  }
  return { level: "ok", spent, cap, ratio, message: null };
}

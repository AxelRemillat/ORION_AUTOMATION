import { utcToParis } from "@/lib/outbox/paris-time";
import type { DayBar, Provider } from "./consumption";

/**
 * « Mails prêts » et coût par mail prêt (Cockpit › Pilotage), sur la fenêtre de
 * 30 jours du graphe de consommation.
 *
 * Mail prêt = brouillon d'intro de l'application (hors éval / script) noté
 * ≥ 9/10 par le juge (messages.quality_score). Coût par mail prêt = dépense
 * totale (tous fournisseurs) ÷ mails prêts — par jour, et sur 30 jours.
 */

export const READY_SCORE = 9;

export interface ReadinessDay {
  day: string;
  ready: number;
  eur: number;
  /** `null` quand aucun mail prêt ce jour-là (coût non défini). */
  costPerReady: number | null;
}

export interface Readiness {
  days: ReadinessDay[];
  totalReady: number;
  /** Moyenne par jour OUVRÉ de la fenêtre (les week-ends ne produisent rien). */
  readyPerDay: number;
  /** Dépense totale de la fenêtre ÷ mails prêts, `null` sans mail prêt. */
  costPerReady: number | null;
  today: ReadinessDay | null;
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

export function buildReadiness(
  days: readonly Pick<DayBar, "day" | "eur">[],
  drafts: readonly { created_at: string; quality_score: number | string | null; origin?: string | null; type?: string | null }[],
): Readiness {
  const readyByDay = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.origin || (draft.type && draft.type !== "intro")) continue;
    if (Number(draft.quality_score) < READY_SCORE) continue;
    const day = utcToParis(new Date(draft.created_at)).date;
    readyByDay.set(day, (readyByDay.get(day) ?? 0) + 1);
  }
  const rows: ReadinessDay[] = days.map((bar) => {
    const eur = round(Object.values(bar.eur as Record<Provider, number>).reduce((total, value) => total + value, 0));
    const ready = readyByDay.get(bar.day) ?? 0;
    return { day: bar.day, ready, eur, costPerReady: ready ? round(eur / ready) : null };
  });
  const totalReady = rows.reduce((total, row) => total + row.ready, 0);
  const totalEur = rows.reduce((total, row) => total + row.eur, 0);
  const workingDays = rows.filter((row) => {
    const weekday = new Date(`${row.day}T12:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }).length;
  return {
    days: rows,
    totalReady,
    readyPerDay: workingDays ? round(totalReady / workingDays, 1) : 0,
    costPerReady: totalReady ? round(totalEur / totalReady) : null,
    today: rows.at(-1) ?? null,
  };
}

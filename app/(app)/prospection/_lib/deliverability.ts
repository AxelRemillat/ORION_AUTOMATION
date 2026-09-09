import type { Message } from "@/types";

/**
 * Garde-fous de délivrabilité.
 *
 * Les VOLUMES sont réels : ils sont comptés sur `messages.sent_at`. Les
 * PLAFONDS sont une règle interne (pas une donnée), reproduisant un warmup
 * classique d'adresse Google Workspace. Ils sont regroupés ici pour être
 * ajustés en un seul endroit.
 */

/** Montée en charge : plafond d'envois par jour selon l'ancienneté de l'adresse. */
const WARMUP_STEPS: { untilDay: number; cap: number }[] = [
  { untilDay: 3, cap: 10 },
  { untilDay: 7, cap: 15 },
  { untilDay: 14, cap: 25 },
  { untilDay: Number.POSITIVE_INFINITY, cap: 40 },
];

/** Au-delà, on considère l'adresse chauffée. */
const WARMUP_DURATION_DAYS = 14;
const DAY_MS = 86_400_000;

export type DeliverabilityLevel = "ok" | "warn" | "blocked";

export interface Deliverability {
  /** Envois effectués aujourd'hui (données réelles). */
  sentToday: number;
  /** Envois sur les 7 derniers jours (données réelles). */
  sentLast7: number;
  /** Plafond du jour, issu de la règle de warmup. */
  dailyCap: number;
  /** Envois encore possibles aujourd'hui selon cette règle. */
  remaining: number;
  /** Jour de warmup (1 = premier envoi), `null` si rien n'est jamais parti. */
  warmupDay: number | null;
  /** `true` tant que l'adresse est considérée en montée en charge. */
  warmingUp: boolean;
  level: DeliverabilityLevel;
}

export function buildDeliverability(messages: Message[], now = new Date()): Deliverability {
  const sentDates = messages
    .filter((message) => message.status === "sent" && message.sent_at)
    .map((message) => Date.parse(message.sent_at as string))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;

  const sentToday = sentDates.filter((time) => time >= startOfToday.getTime()).length;
  const sentLast7 = sentDates.filter((time) => time >= sevenDaysAgo).length;

  const first = sentDates[0];
  const warmupDay =
    first === undefined ? null : Math.floor((now.getTime() - first) / DAY_MS) + 1;

  const cap = (WARMUP_STEPS.find((step) => (warmupDay ?? 1) <= step.untilDay) ?? WARMUP_STEPS[0])
    .cap;
  const remaining = Math.max(cap - sentToday, 0);

  return {
    sentToday,
    sentLast7,
    dailyCap: cap,
    remaining,
    warmupDay,
    warmingUp: warmupDay === null || warmupDay <= WARMUP_DURATION_DAYS,
    level: remaining === 0 ? "blocked" : sentToday / cap >= 0.75 ? "warn" : "ok",
  };
}

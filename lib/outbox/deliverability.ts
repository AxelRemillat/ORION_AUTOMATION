import type { Message } from "@/types";
import { utcToParis } from "./paris-time";

/**
 * Garde-fous de délivrabilité — affichés par /prospection, APPLIQUÉS par
 * lib/outbox/send.ts à chaque envoi.
 *
 * Les VOLUMES sont réels : ils sont comptés sur `messages.sent_at`. Les
 * PLAFONDS sont une règle interne (pas une donnée), reproduisant un warmup
 * classique d'adresse Google Workspace. Ils sont regroupés ici pour être
 * ajustés en un seul endroit.
 */

/**
 * Montée en charge AUTOMATIQUE : plafond d'envois par jour selon l'ancienneté de l'adresse.
 * Plan validé avec Axel le 13/10/2026 (Cowork #26) : 25 jusqu'au jour 14, puis 30 (le 16/10)
 * — et plus rien d'automatique au-delà : 40 puis 50 se débloquent à la main (`MANUAL_STEPS`).
 */
export const WARMUP_STEPS: readonly { untilDay: number; cap: number }[] = [
  { untilDay: 3, cap: 10 },
  { untilDay: 7, cap: 15 },
  { untilDay: 14, cap: 25 },
  { untilDay: Number.POSITIVE_INFINITY, cap: 30 },
];

/**
 * Paliers CONDITIONNELS, jamais automatiques : 40 (après deux semaines propres à 30),
 * puis 50, le maximum sur cette boîte. Débloqués par `SEND_DAILY_CAP_UNLOCKED=40|50`
 * (variable du déploiement), seulement une fois la montée automatique terminée.
 */
export const MANUAL_STEPS = [40, 50] as const;
export const MAX_DAILY_CAP = 50;

/** Palier débloqué à la main (40 ou 50), sinon `null` ; toute autre valeur est ignorée. */
export function unlockedDailyCap(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): number | null {
  const value = Number(env.SEND_DAILY_CAP_UNLOCKED);
  return (MANUAL_STEPS as readonly number[]).includes(value) ? value : null;
}

/** Au-delà, on considère l'adresse chauffée. */
const WARMUP_DURATION_DAYS = 14;
const DAY_MS = 86_400_000;

/** Ligne lue pour les volumes ; `type` et `gmail_message_id` datent la montée en charge. */
export type SentRow = Pick<Message, "status" | "sent_at"> & Partial<Pick<Message, "type" | "gmail_message_id">>;

/** Colonnes à lire pour `buildDeliverability`. */
export const DELIVERABILITY_COLUMNS = "status, sent_at, type, gmail_message_id";

const PROSPECTING: ReadonlySet<string> = new Set(["intro", "relance_1", "relance_2"]);

/**
 * Premier envoi RÉEL de prospection : parti par Gmail (`gmail_message_id`),
 * intro ou relance. 02/10/2026 : un message marqué « envoyé » à la main le
 * 19/09 (JACQUET PARIS, sans envoi Gmail) faisait commencer la montée en
 * charge 9 jours trop tôt — « jour 14, 25 envois » au lieu de « jour 5, 15 ».
 */
export function firstRealSend(rows: readonly SentRow[]): string | null {
  const dates = rows
    .filter((row) => row.status === "sent" && row.sent_at && row.gmail_message_id && PROSPECTING.has(String(row.type)))
    .map((row) => row.sent_at as string)
    .sort();
  return dates[0] ?? null;
}

/** Jours ouvrés (lun.–ven., Paris) du premier envoi à aujourd'hui inclus — au moins 1. */
export function businessDaysSince(firstIso: string, now: Date): number {
  const start = utcToParis(new Date(firstIso)).date;
  const end = utcToParis(now).date;
  let cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  let days = 0;
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return Math.max(1, days);
}

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

export function buildDeliverability(messages: readonly SentRow[], now = new Date(), env?: Record<string, string | undefined>): Deliverability {
  const sent = messages.filter((message) => message.status === "sent" && message.sent_at);
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
  // « Aujourd'hui » à Paris, pas dans le fuseau du serveur (UTC sur Vercel).
  const today = utcToParis(now).date;

  const sentToday = sent.filter((message) => utcToParis(new Date(message.sent_at as string)).date === today).length;
  const sentLast7 = sent.filter((message) => Date.parse(message.sent_at as string) >= sevenDaysAgo).length;

  const first = firstRealSend(messages);
  const warmupDay = first === null ? null : businessDaysSince(first, now);

  const automatic = (WARMUP_STEPS.find((step) => (warmupDay ?? 1) <= step.untilDay) ?? WARMUP_STEPS[0]).cap;
  // Palier débloqué à la main : seulement une fois la montée automatique terminée, jamais au-delà de 50.
  const unlocked = warmupDay !== null && warmupDay > WARMUP_DURATION_DAYS ? unlockedDailyCap(env) : null;
  const cap = Math.min(MAX_DAILY_CAP, Math.max(automatic, unlocked ?? 0));
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

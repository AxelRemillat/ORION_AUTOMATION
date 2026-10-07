import type { Opportunity, Platform } from "./types";

/**
 * RELANCES DUES (plateformes #6) — code pur, sans dépendance serveur (page,
 * Cockpit) : une proposition « Envoyée » sans réponse depuis 3 jours (Codeur,
 * Malt, ComeUp) ou 5 jours (Upwork, Autre), jamais relancée.
 */
export const FOLLOW_UP_DAYS: Record<Platform, number> = { codeur: 3, malt: 3, comeup: 3, upwork: 5, autre: 5 };

type Row = Pick<Opportunity, "platform" | "status" | "sent_at" | "replied_at"> & Partial<Pick<Opportunity, "followed_up_at">>;

/** Jours écoulés depuis l'envoi de la proposition (`null` si jamais envoyée). */
export function daysSinceSent(row: Pick<Opportunity, "sent_at">, now = new Date()): number | null {
  if (!row.sent_at || Number.isNaN(Date.parse(row.sent_at))) return null;
  return Math.floor((now.getTime() - Date.parse(row.sent_at)) / 86_400_000);
}

/** Relance due : « Envoyée », sans réponse, jamais relancée, délai de la plateforme écoulé. */
export function followUpDue(row: Row, now = new Date()): boolean {
  if (row.status !== "envoyee" || row.replied_at || row.followed_up_at) return false;
  const days = daysSinceSent(row, now);
  return days !== null && days >= FOLLOW_UP_DAYS[row.platform];
}

export const dueFollowUps = <T extends Row>(rows: readonly T[], now = new Date()): T[] => rows.filter((row) => followUpDue(row, now));

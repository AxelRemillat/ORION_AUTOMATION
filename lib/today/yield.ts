import { MIN_GAP_MIN } from "@/lib/mail-preflight/schedule";
import { parisToUtc, utcToParis } from "@/lib/outbox/paris-time";
import type { Db } from "@/lib/trash/scope";
import type { Capacity } from "./capacity";
import { PLAN_OPEN } from "./plan";
import type { TodayItem } from "./types";

/**
 * « CÉDER LA PLACE AUX RELANCES » (Cowork #42).
 *
 * Le 09/10/2026, le plafond du jour était engagé (16 envoyés + 9 intros
 * programmées = 25/25) et 14 relances validées n'avaient plus aucun créneau.
 * Une relance dans un fil ouvert vaut mieux qu'une intro neuve : Axel peut
 * décaler des intros programmées du jour au jour ouvré suivant.
 *
 *   - JAMAIS automatique : le plan est montré, seul un clic d'Axel le déclenche ;
 *   - les intros les plus TARDIVES du jour sont décalées d'abord, autant qu'il
 *     y a de relances en attente ;
 *   - elles gardent leur contenu : seul `scheduled_at` change ;
 *   - elles passent en TÊTE du jour ouvré suivant (dès 9 h), dans leur ordre
 *     d'origine, sans se superposer aux envois déjà programmés ce jour-là.
 *
 * Code pur (plan), plus le chargement et l'écriture.
 */

export interface ScheduledIntro {
  messageId: string;
  companyName: string;
  /** Instant ISO du créneau actuel. */
  scheduledAt: string;
}

export interface YieldMove {
  messageId: string;
  companyName: string;
  from: string;
  to: string;
}

export interface YieldPlan {
  /** Le bouton s'affiche : plus aucun créneau, des relances validées en attente, des intros à décaler. */
  show: boolean;
  /** Relances validées non programmées. */
  relancesWaiting: number;
  day: string;
  nextDay: string;
  moves: YieldMove[];
}

const MINUTE = 60_000;

/** Jour ouvré suivant (AAAA-MM-JJ, Paris). */
export function nextBusinessDay(day: string): string {
  let cursor = new Date(`${day}T12:00:00Z`);
  do {
    cursor = new Date(cursor.getTime() + 86_400_000);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor.toISOString().slice(0, 10);
}

export function planYield(input: {
  remaining: number;
  day: string;
  relancesWaiting: number;
  /** Intros programmées sur `day`. */
  intros: readonly ScheduledIntro[];
  /** Instants déjà programmés (tous jours) : le jour suivant ne se superpose pas. */
  taken?: readonly string[];
}): YieldPlan {
  const nextDay = nextBusinessDay(input.day);
  const base = { relancesWaiting: input.relancesWaiting, day: input.day, nextDay };
  if (input.remaining > 0 || input.relancesWaiting === 0 || input.intros.length === 0) return { ...base, show: false, moves: [] };

  // Les plus tardives d'abord, autant que de relances en attente.
  const chosen = [...input.intros].sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt)).slice(0, input.relancesWaiting);
  // En tête du jour suivant, dans leur ordre d'origine (la plus matinale d'abord).
  const ordered = [...chosen].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const busy = (input.taken ?? []).map((at) => Date.parse(at)).filter((at) => utcToParis(new Date(at)).date === nextDay);

  const step = Math.max(MIN_GAP_MIN, 3) * MINUTE;
  let slot = parisToUtc(nextDay, PLAN_OPEN)!.getTime();
  const moves: YieldMove[] = [];
  for (const intro of ordered) {
    while (busy.some((at) => Math.abs(at - slot) < step)) slot += step;
    moves.push({ messageId: intro.messageId, companyName: intro.companyName, from: intro.scheduledAt, to: new Date(slot).toISOString() });
    busy.push(slot);
    slot += step;
  }

  return { ...base, show: moves.length > 0, moves };
}

/** Relances validées non programmées, dans la file du jour. */
export const relancesWaitingOf = (items: readonly TodayItem[]) => items.filter((item) => item.kind === "relance" && item.status === "valide").length;

/** Intros programmées sur le jour d'envoi, avec le nom de la fiche. */
export async function loadScheduledIntros(db: Db, userId: string, day: string): Promise<ScheduledIntro[]> {
  const { data } = await db
    .from("messages")
    .select("id, scheduled_at, prospect_id")
    .eq("user_id", userId)
    .eq("type", "intro")
    .eq("send_status", "scheduled")
    .is("deleted_at", null);
  const rows = ((data ?? []) as { id: string; scheduled_at: string | null; prospect_id: string }[]).filter(
    (row) => row.scheduled_at && utcToParis(new Date(row.scheduled_at)).date === day,
  );
  if (!rows.length) return [];
  const { data: prospects } = await db.from("prospects").select("id, company_name").in("id", [...new Set(rows.map((row) => row.prospect_id))]);
  const names = new Map(((prospects ?? []) as { id: string; company_name: string }[]).map((row) => [row.id, row.company_name]));
  return rows.map((row) => ({ messageId: row.id, companyName: names.get(row.prospect_id) ?? "—", scheduledAt: row.scheduled_at as string }));
}

export async function loadYieldPlan(db: Db, userId: string, capacity: Capacity, items: readonly TodayItem[]): Promise<YieldPlan> {
  const relancesWaiting = relancesWaitingOf(items);
  if (capacity.remaining > 0 || relancesWaiting === 0) return planYield({ remaining: capacity.remaining, day: capacity.day, relancesWaiting, intros: [] });
  const intros = await loadScheduledIntros(db, userId, capacity.day);
  return planYield({ remaining: capacity.remaining, day: capacity.day, relancesWaiting, intros, taken: capacity.taken });
}

/**
 * Le décalage, après le clic d'Axel. Le plan est RECALCULÉ ici : seules les
 * intros qu'il contient encore bougent (un envoi parti entre-temps, une
 * programmation annulée ne sont pas touchés). Seul `scheduled_at` change, et
 * seulement tant que l'intro est encore « programmée » (jamais en cours d'envoi).
 */
export async function applyYield(
  db: Db,
  userId: string,
  plan: YieldPlan,
  confirmedIds: readonly string[],
): Promise<{ moved: number; skipped: number }> {
  const confirmed = new Set(confirmedIds);
  let moved = 0;
  let skipped = 0;
  for (const move of plan.moves) {
    if (!confirmed.has(move.messageId)) continue;
    const { data } = await db
      .from("messages")
      .update({ scheduled_at: move.to })
      .eq("id", move.messageId)
      .eq("user_id", userId)
      .eq("type", "intro")
      .eq("send_status", "scheduled")
      .select("id");
    if ((data as unknown[] | null)?.length) moved += 1;
    else skipped += 1;
  }
  return { moved, skipped };
}

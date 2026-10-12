import { MAX_GAP_MIN, MIN_GAP_MIN } from "@/lib/mail-preflight/schedule";
import { parisToUtc, utcToParis } from "@/lib/outbox/paris-time";
import { nominativeFirst } from "./group";
import type { TodayItem } from "./types";

/**
 * Plan de la programmation groupée — ce que la feuille « Programmer N envois »
 * affiche AVANT confirmation, et ce qui est programmé ensuite.
 *
 * Règles :
 *   - seuls les éléments VALIDÉS partent — jamais un brouillon non relu ;
 *   - ordre : réponses, puis relances, puis intros — à qualité égale, les
 *     adresses NOMINATIVES d'abord (elles remplissent le quota en premier) ;
 *   - fenêtre 9 h – 17 h (Paris), jours ouvrés ; 2 à 7 min entre deux envois ;
 *   - plafond de montée en charge du jour : au-delà, l'élément reste validé et
 *     revient demain en tête de file. Rien n'est perdu, rien ne part en trop.
 *
 * Code pur : `now` et `random` sont injectés.
 */

export const PLAN_OPEN = "09:00";
export const PLAN_CLOSE = "17:00";
const MINUTE = 60_000;
/** Délai minimal avant le premier envoi : le temps de relire la feuille. */
const LEAD_MIN = 3;

export type PostponeReason = "plafond" | "fenetre";

export interface PlannedSend {
  key: string;
  at: Date;
}

export interface SchedulePlan {
  /** Jour d'envoi, AAAA-MM-JJ (Paris). */
  day: string;
  planned: PlannedSend[];
  postponed: { key: string; reason: PostponeReason }[];
}

const RANK: Record<TodayItem["kind"], number> = { reponse: 0, relance: 1, nouveau: 2, a_completer: 3 };

/** Premier jour ouvré à partir d'aujourd'hui, ou demain si la fenêtre est passée. */
export function sendDay(now: Date): string {
  const { date, time, weekday } = utcToParis(now);
  const open = weekday >= 1 && weekday <= 5 && time < PLAN_CLOSE;
  if (open) return date;
  let cursor = new Date(`${date}T12:00:00Z`);
  do {
    cursor = new Date(cursor.getTime() + 86_400_000);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor.toISOString().slice(0, 10);
}

const gap = (random: () => number) =>
  (MIN_GAP_MIN + Math.floor(random() * (MAX_GAP_MIN - MIN_GAP_MIN + 1))) * MINUTE;

/** Ordre de la programmation : réponses, relances, intros (nominatives d'abord) — seuls les éléments VALIDÉS. */
function orderValidated(items: readonly TodayItem[]): TodayItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "valide" && Boolean(item.messageId))
    .sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || (a.item.kind === "nouveau" ? nominativeFirst(a.item, b.item) : 0) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * PROGRAMMATION SUR PLUSIEURS JOURS (Cowork #50, 12/10/2026 : plafond du jour atteint à 13 h 53, 12 mails validés,
 * « Confirmer 0 envoi(s) »). Les mails validés remplissent les PROCHAINS JOURS OUVRÉS, chacun jusqu'à SON plafond
 * de montée en charge, ses envois déjà partis et déjà programmés (intros, relances J+4 / J+7) déduits.
 */
export interface DayRoom {
  /** AAAA-MM-JJ (Paris), jour ouvré. */
  day: string;
  /** Plafond de montée en charge de CE jour. */
  cap: number;
  /** Déjà engagé ce jour : envoyés + programmés. */
  used: number;
}

export interface DayPlan extends DayRoom {
  planned: number;
}

export interface MultiDayPlan {
  planned: (PlannedSend & { day: string })[];
  days: DayPlan[];
  /** Au-delà de l'horizon choisi : restent validés, rien n'est perdu. */
  postponed: string[];
}

/** Jours ouvrés (Paris) à partir d'aujourd'hui inclus s'il est ouvré : `count` jours. */
export function businessDays(now: Date, count: number): string[] {
  const days: string[] = [];
  let cursor = new Date(`${utcToParis(now).date}T12:00:00Z`);
  for (let guard = 0; days.length < count && guard < 30; guard += 1) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

export function planDays(input: {
  items: readonly TodayItem[];
  /** Jours de l'horizon, dans l'ordre, avec leur place. */
  days: readonly DayRoom[];
  /** Envois déjà programmés (tous jours) : on ne s'y superpose pas. */
  taken?: readonly Date[];
  now?: Date;
  random?: () => number;
}): MultiDayPlan {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const taken = (input.taken ?? []).map((date) => date.getTime());
  const queue = orderValidated(input.items);
  const planned: MultiDayPlan["planned"] = [];
  const days: DayPlan[] = [];
  for (const room of input.days) {
    const open = parisToUtc(room.day, PLAN_OPEN)!.getTime();
    const close = parisToUtc(room.day, PLAN_CLOSE)!.getTime();
    // Aujourd'hui : pas avant maintenant + le temps de relire ; un jour suivant : dès 9 h.
    let cursor = Math.max(open, now.getTime() + LEAD_MIN * MINUTE);
    let count = 0;
    const free = Math.max(0, room.cap - room.used);
    while (queue.length && count < free) {
      for (let guard = 0; guard < 200 && taken.some((time) => Math.abs(time - cursor) < MIN_GAP_MIN * MINUTE); guard += 1) {
        cursor += gap(random);
      }
      if (cursor > close) break;
      const item = queue.shift()!;
      planned.push({ key: item.key, at: new Date(cursor), day: room.day });
      count += 1;
      cursor += gap(random);
    }
    days.push({ ...room, planned: count });
  }
  return { planned, days, postponed: queue.map((item) => item.key) };
}

export function planSchedule(input: {
  items: readonly TodayItem[];
  /** Envois encore permis aujourd'hui (plafond − envoyés − déjà programmés). */
  remaining: number;
  /** Envois déjà programmés : on ne s'y superpose pas. */
  taken?: readonly Date[];
  now?: Date;
  random?: () => number;
}): SchedulePlan {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const day = sendDay(now);
  const open = parisToUtc(day, PLAN_OPEN)!.getTime();
  const close = parisToUtc(day, PLAN_CLOSE)!.getTime();
  const taken = (input.taken ?? []).map((date) => date.getTime());

  const validated = orderValidated(input.items);

  const planned: PlannedSend[] = [];
  const postponed: SchedulePlan["postponed"] = [];
  let cursor = Math.max(open, now.getTime() + LEAD_MIN * MINUTE);
  const room = Math.max(0, input.remaining);

  for (const item of validated) {
    if (planned.length >= room) {
      postponed.push({ key: item.key, reason: "plafond" });
      continue;
    }
    // On saute les créneaux trop proches d'un envoi déjà programmé.
    for (let guard = 0; guard < 200 && taken.some((time) => Math.abs(time - cursor) < MIN_GAP_MIN * MINUTE); guard += 1) {
      cursor += gap(random);
    }
    if (cursor > close) {
      postponed.push({ key: item.key, reason: "fenetre" });
      continue;
    }
    planned.push({ key: item.key, at: new Date(cursor) });
    cursor += gap(random);
  }
  return { day, planned, postponed };
}

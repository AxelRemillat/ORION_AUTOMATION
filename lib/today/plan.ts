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

  const validated = input.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "valide" && Boolean(item.messageId))
    .sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || (a.item.kind === "nouveau" ? nominativeFirst(a.item, b.item) : 0) || a.index - b.index)
    .map(({ item }) => item);

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

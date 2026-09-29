import { parisToUtc, utcToParis } from "@/lib/outbox/paris-time";

/**
 * CRÉNEAUX D'ENVOI — le 28/09, 4 mails sont partis entre 09:00 et 09:01.
 *
 * - Plusieurs mails sur le même créneau : chacun part 2 à 7 minutes (tirage
 *   aléatoire) après le précédent. L'ordre de programmation est conservé.
 * - Jamais avant 8 h, jamais à partir de 18 h (heure de Paris), jamais le
 *   week-end : un créneau hors fenêtre glisse au prochain jour ouvré, 8 h.
 * Module pur : `random` est injecté pour les tests.
 */

export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 18;
export const MIN_GAP_MIN = 2;
export const MAX_GAP_MIN = 7;

const MINUTE = 60_000;

/** `true` si un envoi est permis à cet instant (jour ouvré, 8 h – 18 h à Paris). */
export function inSendWindow(at: Date): boolean {
  const { time, weekday } = utcToParis(at);
  const hour = Number(time.slice(0, 2));
  return weekday >= 1 && weekday <= 5 && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/** Premier instant de la fenêtre d'envoi à partir de `at` (lui-même s'il y est). */
export function nextSendWindow(at: Date): Date {
  if (inSendWindow(at)) return at;
  let { date, time, weekday } = utcToParis(at);
  // Avant 8 h un jour ouvré : le jour même, 8 h. Sinon : jour ouvré suivant.
  if (!(weekday >= 1 && weekday <= 5 && Number(time.slice(0, 2)) < OPEN_HOUR)) {
    do {
      const next = new Date(`${date}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
      weekday = next.getUTCDay();
    } while (weekday === 0 || weekday === 6);
  }
  return parisToUtc(date, `${String(OPEN_HOUR).padStart(2, "0")}:00`) as Date;
}

const gap = (random: () => number) => (MIN_GAP_MIN + Math.floor(random() * (MAX_GAP_MIN - MIN_GAP_MIN + 1))) * MINUTE;

/**
 * Instant réel d'un mail demandé à `requested`, sachant les envois déjà
 * programmés (`taken`). Un créneau à moins de 2 min d'un envoi existant
 * repart 2 à 7 min après le dernier envoi de la grappe. Les envois existants
 * ne bougent JAMAIS : seul le nouveau glisse.
 */
export function spacedSlot(requested: Date, taken: readonly Date[], random: () => number = Math.random): Date {
  const sorted = [...taken].map((date) => date.getTime()).sort((a, b) => a - b);
  let at = nextSendWindow(requested).getTime();
  for (let guard = 0; guard < 500; guard += 1) {
    const clash = sorted.filter((time) => Math.abs(time - at) < MIN_GAP_MIN * MINUTE);
    if (!clash.length) {
      const inside = nextSendWindow(new Date(at)).getTime();
      if (inside === at) return new Date(at);
      at = inside;
      continue;
    }
    at = Math.max(...clash) + gap(random);
  }
  return new Date(at);
}

/** Plusieurs mails demandés au même moment : heures réelles, dans l'ordre. */
export function spreadSlots(requested: readonly Date[], taken: readonly Date[] = [], random: () => number = Math.random): Date[] {
  const busy = [...taken];
  return requested.map((at) => {
    const slot = spacedSlot(at, busy, random);
    busy.push(slot);
    return slot;
  });
}

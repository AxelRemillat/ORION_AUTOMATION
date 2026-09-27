/**
 * Heures « Europe/Paris » sans bibliothèque : l'écran saisit une date et une
 * heure LOCALES, la base stocke de l'UTC. Module pur, importable partout.
 */

export const PARIS = "Europe/Paris";

/** Décalage (ms) de Paris par rapport à UTC à l'instant donné (heure d'été comprise). */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * « 2026-09-28 » + « 09:00 » à Paris → instant UTC. `null` si la saisie est
 * illisible. Deux passes : le décalage dépend de l'instant (changement d'heure).
 */
export function parisToUtc(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let guess = naive - parisOffsetMs(new Date(naive));
  guess = naive - parisOffsetMs(new Date(guess));
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Instant UTC → { date: « AAAA-MM-JJ », time: « HH:mm », weekday: 0-6 } à Paris. */
export function utcToParis(at: Date): { date: string; time: string; weekday: number } {
  const local = new Date(at.getTime() + parisOffsetMs(at));
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: local.getUTCDay() };
}

/** Jour calendaire à Paris, décalé de `days`. */
function parisDay(now: Date, days: number): string {
  const { date } = utcToParis(now);
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export interface Shortcut {
  label: string;
  at: Date;
}

/** Raccourcis du sélecteur : « Demain 9h » et « Lundi 9h » (lundi PROCHAIN). */
export function scheduleShortcuts(now = new Date()): Shortcut[] {
  const { weekday } = utcToParis(now);
  const untilMonday = ((8 - weekday) % 7) || 7;
  return [
    { label: "Demain 9h", at: parisToUtc(parisDay(now, 1), "09:00") as Date },
    { label: "Lundi 9h", at: parisToUtc(parisDay(now, untilMonday), "09:00") as Date },
  ];
}

const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** « lun. 9h00 », ou « lun. 28/09 9h00 » au-delà de six jours. */
export function formatScheduled(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const { date, time, weekday } = utcToParis(at);
  const [hours, minutes] = time.split(":");
  const clock = `${Number(hours)}h${minutes}`;
  const far = at.getTime() - now.getTime() > 6 * 86_400_000;
  return far ? `${DAYS[weekday]} ${date.slice(8, 10)}/${date.slice(5, 7)} ${clock}` : `${DAYS[weekday]} ${clock}`;
}

/** Programmation au plus loin : au-delà, c'est une erreur de saisie. */
export const MAX_SCHEDULE_DAYS = 90;

/** `null` si l'instant est programmable, sinon la raison du refus. */
export function scheduleError(at: Date | null, now = new Date()): string | null {
  if (!at || Number.isNaN(at.getTime())) return "Date ou heure invalide.";
  if (at.getTime() <= now.getTime()) return "Cette date est passée : choisissez un moment à venir.";
  if (at.getTime() - now.getTime() > MAX_SCHEDULE_DAYS * 86_400_000) {
    return `Programmation limitée à ${MAX_SCHEDULE_DAYS} jours.`;
  }
  return null;
}

/** « 27 sept. 2026, 14:30 », toujours à l'heure de Paris (serveur en UTC compris). */
export function formatParisDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: PARIS }).format(
    new Date(iso),
  );
}

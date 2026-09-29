/**
 * Créneau d'envoi CONSEILLÉ, par secteur. Indication affichée, jamais appliquée :
 * la programmation reste un choix manuel (et son code n'est pas touché ici).
 *
 * - boulangerie, pâtisserie, restauration : le matin est pris par le service ;
 *   le mardi 14h, après le coup de feu, le dirigeant lit ses mails ;
 * - par défaut : lundi ou mardi, 9h, avant que la semaine ne s'emballe.
 */

const AFTERNOON_TRADES = /boulang|p[aâ]tiss|viennois|traiteur|restaura|brasserie|pizz|caf[eé]|\b10\.71|\b56\.1/i;

export interface SendTimeHint {
  /** « mardi 14h » */
  label: string;
  reason: string;
  /** Prochaine occurrence, à partir de `now` (heure locale). */
  next: Date;
}

/** Prochain jour de semaine `weekday` (0 = dimanche) à `hour`h, strictement après `now`. */
export function nextSlot(now: Date, weekdays: number[], hour: number): Date {
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    day.setHours(hour, 0, 0, 0);
    if (weekdays.includes(day.getDay()) && day > now) return day;
  }
  return now;
}

export function suggestSendTime(sector: string | null | undefined, nafCode?: string | null, now = new Date()): SendTimeHint {
  if (AFTERNOON_TRADES.test(`${sector ?? ""} ${nafCode ?? ""}`)) {
    return {
      label: "mardi 14h",
      reason: "commerce de bouche ou restauration : après le service du midi",
      next: nextSlot(now, [2], 14),
    };
  }
  return {
    label: "lundi ou mardi, 9h",
    reason: "en début de semaine, avant que l'agenda ne se remplisse",
    next: nextSlot(now, [1, 2], 9),
  };
}

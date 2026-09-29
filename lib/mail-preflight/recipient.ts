/**
 * DESTINATAIRE — jamais une adresse devinée.
 *
 * `contact@<domaine du site>` était préremplie quand aucune adresse n'avait été
 * trouvée : une devinette présentée comme une donnée. Elle est refusée tant
 * qu'aucune source ne l'a confirmée (fiche, enrichissement, recherche contact).
 */

export const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Domaine nu d'un site (sans protocole ni www). */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** L'adresse qu'aurait devinée l'ancien préremplissage. */
export const guessedAddress = (website: string | null | undefined) => {
  const domain = domainOf(website);
  return domain ? `contact@${domain}` : null;
};

/** `null` si le destinataire est envoyable, sinon la raison du refus. */
export function recipientError(
  to: string | null | undefined,
  known: readonly (string | null | undefined)[] = [],
  website?: string | null,
): string | null {
  if (!to?.trim()) return "Destinataire absent.";
  if (!isEmail(to)) return `Destinataire invalide : « ${to} ».`;
  const address = to.trim().toLowerCase();
  const confirmed = known.some((item) => item?.trim().toLowerCase() === address);
  if (!confirmed && address === guessedAddress(website)) {
    return `« ${to} » est une adresse devinée (contact@ + domaine du site), jamais vérifiée : trouvez l'adresse ou saisissez-la.`;
  }
  return null;
}

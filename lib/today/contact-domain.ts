/**
 * CONTACT À VÉRIFIER — l'adresse e-mail n'est pas sur le domaine du site
 * (Cowork, 05/10/2026 : AIRPLANE DELIVERY, contact@airplane.aero pour le site
 * airplane-delivery.fr — peut-être une autre entreprise). Tant qu'Axel n'a
 * pas confirmé ce contact, la fiche reste « À compléter ».
 *
 * Les messageries grand public (gmail, orange…) ne comptent pas : une petite
 * entreprise y a souvent son adresse, ce n'est pas un indice d'erreur.
 */

const WEBMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.fr", "live.com", "yahoo.fr", "yahoo.com",
  "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "icloud.com", "me.com", "aol.com", "bbox.fr", "numericable.fr", "gmx.fr", "gmx.com", "protonmail.com", "proton.me",
]);

/** Suffixes à deux niveaux : « exemple.co.uk » → « exemple.co.uk ». */
const TWO_LEVEL = new Set(["co.uk", "org.uk", "com.au", "co.nz", "com.br", "co.jp"]);

/** Domaine enregistrable d'un hôte : « shop.exemple.fr » → « exemple.fr ». */
export function registrableDomain(host: string | null | undefined): string | null {
  const clean = (host ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
  if (!clean || !clean.includes(".")) return null;
  const labels = clean.split(".").filter(Boolean);
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** Domaines d'e-mail et de site différents (hors messageries grand public), sinon `null`. */
export function contactDomainMismatch(email: string | null | undefined, website: string | null | undefined): { emailDomain: string; siteDomain: string } | null {
  const emailDomain = registrableDomain((email ?? "").split("@")[1]);
  const siteDomain = registrableDomain(website);
  if (!emailDomain || !siteDomain || WEBMAIL.has(emailDomain) || emailDomain === siteDomain) return null;
  return { emailDomain, siteDomain };
}

/** Confirmation d'Axel, liée à l'ADRESSE : une nouvelle adresse redemande une confirmation. */
export function contactConfirmed(figures: Record<string, unknown> | null | undefined, email: string | null | undefined): boolean {
  const confirmed = (figures?.contact_confirmed as { email?: unknown } | undefined)?.email;
  return typeof confirmed === "string" && Boolean(email) && confirmed.toLowerCase() === String(email).toLowerCase();
}

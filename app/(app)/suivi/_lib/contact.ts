import type { Prospect } from "@/types";

/**
 * Destinataire proposé à l'envoi, par ordre de fiabilité décroissante :
 *   1. `prospects.email` — adresse trouvée par l'enrichissement (Pappers/Hunter)
 *      ou corrigée à la main, donc la plus sûre ;
 *   2. une adresse déposée dans `key_figures` par un enrichissement antérieur
 *      à la colonne `email` (compatibilité des fiches existantes) ;
 *   3. `contact@<domaine du site>` — devinette, à vérifier avant d'envoyer.
 * L'adresse reste modifiable dans la modale : rien n'est envoyé sans relecture.
 */

const EMAIL_KEYS = ["email", "contact_email", "hunter_email", "contact"] as const;
const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Domaine nu extrait du site web (sans protocole ni www). */
function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Meilleure proposition d'adresse pour ce prospect, ou "" si rien de crédible. */
export function guessEmail(
  prospect: Pick<Prospect, "email" | "key_figures" | "website">,
): string {
  if (isEmail(prospect.email)) return prospect.email;

  for (const key of EMAIL_KEYS) {
    const candidate = prospect.key_figures?.[key];
    if (isEmail(candidate)) return candidate;
  }
  const domain = domainOf(prospect.website);
  return domain ? `contact@${domain}` : "";
}

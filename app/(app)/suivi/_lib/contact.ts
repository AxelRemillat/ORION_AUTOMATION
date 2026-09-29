import type { Prospect } from "@/types";

/**
 * Destinataires PROPOSÉS à l'envoi : uniquement des adresses trouvées, avec
 * leur source, par ordre de fiabilité décroissante :
 *   1. `prospects.email` — adresse trouvée par l'enrichissement ou saisie ;
 *   2. une adresse déposée dans `key_figures` par un enrichissement antérieur.
 * L'ancienne devinette `contact@<domaine du site>` a disparu : elle partait
 * comme une donnée alors que personne ne l'avait vérifiée (28/09). Le contrôle
 * avant envoi la refuse désormais (lib/mail-preflight/recipient.ts).
 */

const EMAIL_KEYS: [string, string][] = [
  ["email", "enrichissement"],
  ["contact_email", "enrichissement"],
  ["hunter_email", "Hunter"],
  ["contact", "enrichissement"],
];
const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export interface FoundAddress {
  email: string;
  source: string;
}

export function foundAddresses(prospect: Pick<Prospect, "email" | "key_figures">): FoundAddress[] {
  const found: FoundAddress[] = [];
  if (isEmail(prospect.email)) found.push({ email: prospect.email, source: "fiche" });
  for (const [key, source] of EMAIL_KEYS) {
    const candidate = prospect.key_figures?.[key];
    if (isEmail(candidate) && !found.some((item) => item.email === candidate)) found.push({ email: candidate, source });
  }
  return found;
}

/** Première adresse trouvée, ou "" : rien n'est deviné. */
export const defaultRecipient = (prospect: Pick<Prospect, "email" | "key_figures">): string =>
  foundAddresses(prospect)[0]?.email ?? "";

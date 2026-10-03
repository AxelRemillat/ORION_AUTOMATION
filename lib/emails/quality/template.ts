import { demoUrl, type DemoLink } from "./demo-links";

/**
 * GABARIT « ENVOYABLE SANS RETOUCHE » (03/10/2026).
 *
 *   Bonjour Monsieur Anquetil,
 *
 *   <accroche : 1 fait concret + 1 conséquence opérationnelle, 2 phrases ≤ 20 mots>
 *
 *   <proposition : 1 phrase, le bénéfice métier>
 *
 *   Exemple testable en une minute : axelremillat.com/automatisations
 *
 *   Auriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?
 *
 * Le modèle n'écrit QUE l'objet, l'accroche et la proposition. Salutation,
 * preuve (avec son URL) et demande sont posées par le code : ce sont les trois
 * endroits où les brouillons du 03/10 dérapaient.
 */

export interface MailParts {
  subject: string;
  hook: string;
  proposal: string;
}

export const PROOF_PREFIX = "Exemple testable en une minute :";

/** Une seule question, toujours la même idée ; trois formulations pour ne pas se répéter. */
export const CTA_VARIANTS = [
  "Auriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
  "Seriez-vous disponible 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
  "Auriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
] as const;

/** Variante stable pour un prospect donné. */
export function ctaFor(prospectId: string): string {
  let hash = 0;
  for (const char of prospectId) hash = (hash * 31 + char.charCodeAt(0)) % 100_003;
  return CTA_VARIANTS[hash % CTA_VARIANTS.length];
}

export const proofLine = (demo: DemoLink) => `${PROOF_PREFIX} ${demoUrl(demo)}`;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps SANS mention « stop » ni signature (posées ensuite, comme avant). */
export function assemble(parts: MailParts, frame: { greeting: string; demo: DemoLink; cta: string }): string {
  return [frame.greeting, clean(parts.hook), clean(parts.proposal), proofLine(frame.demo), frame.cta].join("\n\n");
}

/** Mots d'un texte : l'URL compte pour un mot. */
export const countWords = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** Phrases d'un paragraphe (un point dans une URL ou un nombre ne coupe pas). */
export function sentencesOf(text: string): string[] {
  return clean(text)
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÝÉÈ«"])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

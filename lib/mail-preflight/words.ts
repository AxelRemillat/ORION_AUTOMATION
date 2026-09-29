/**
 * LE comptage de mots — le seul de l'application. Module pur, importable côté
 * client : l'éditeur (/prospection, Cockpit), le validateur de génération et le
 * contrôle avant envoi l'appellent tous.
 *
 * Deux choses ne comptent pas : la signature (posée par le code, identique
 * partout) et la phrase d'opposition (mention légale, pas de l'argumentaire —
 * l'inclure poussait à la retirer pour tenir les 110 mots).
 *
 * Historique : des mails à 127, 123, 123 et 126 mots étaient « validables »,
 * parce que l'écran et le validateur ne comptaient pas pareil. Puis deux
 * modules coexistaient (lib/emails/word-count.ts et celui-ci), l'un comptant la
 * phrase d'opposition, l'autre non. Il n'en reste qu'un.
 */

import { withoutOptOut } from "./opt-out";

/** Plafond STRICT : au-delà, le mail ne peut ni être validé ni partir. */
export const MAX_BODY_WORDS = 110;

/** Retire la signature posée par le code (tout ce qui suit sa dernière occurrence). */
export function withoutSignature(body: string, signature?: string | null): string {
  if (!signature?.trim()) return body;
  const index = body.lastIndexOf(signature.trim());
  return index >= 0 ? body.slice(0, index) : body;
}

/** Mots bruts d'un texte déjà nettoyé. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Corps compté : sans la signature ni la phrase d'opposition. */
export const countedText = (body: string, signature?: string | null) =>
  withoutOptOut(withoutSignature(body, signature));

/** Mots du corps, hors signature et hors phrase d'opposition — le nombre affiché ET vérifié. */
export const bodyWordCount = (body: string, signature?: string | null) => wordCount(countedText(body, signature));

/** `true` quand le mail dépasse le plafond et ne peut pas être validé. */
export function exceedsWordLimit(body: string, signature?: string | null, max = MAX_BODY_WORDS): boolean {
  return bodyWordCount(body, signature) > max;
}

/**
 * LE comptage de mots — un seul, partagé par le validateur (serveur) et
 * l'éditeur (/prospection). Module pur, importable côté client.
 *
 * Constaté : des mails à 127, 123, 123 et 126 mots étaient « validables ».
 * L'écran comptait la signature, le validateur non, et le plafond n'était
 * qu'un avertissement. Désormais : même fonction des deux côtés, signature
 * retirée, et au-delà de MAX_BODY_WORDS le bouton « Valider » est désactivé.
 */

/** Plafond STRICT, signature non comprise. */
export const MAX_BODY_WORDS = 110;

/** Retire la signature posée par le code (tout ce qui suit sa dernière occurrence). */
export function withoutSignature(body: string, signature?: string | null): string {
  if (!signature?.trim()) return body;
  const index = body.lastIndexOf(signature.trim());
  return index >= 0 ? body.slice(0, index) : body;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Mots du corps, signature exclue — le nombre affiché ET vérifié. */
export function bodyWordCount(body: string, signature?: string | null): number {
  return wordCount(withoutSignature(body, signature));
}

/** `true` quand le mail dépasse le plafond et ne peut pas être validé. */
export function exceedsWordLimit(body: string, signature?: string | null, max = MAX_BODY_WORDS): boolean {
  return bodyWordCount(body, signature) > max;
}

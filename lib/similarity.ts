/**
 * Similarité entre deux textes, par n-grammes de mots.
 *
 * Sert de garde-fou anti-copier-coller : un modèle à qui l'on montre un
 * exemple a tendance à le recycler, et deux prospects finissent avec le même
 * mail à la virgule près. On mesure, et au-delà d'un seuil on régénère.
 *
 * Indice de Jaccard sur des trigrammes de mots : insensible à la ponctuation
 * et aux accents, sensible aux tournures réutilisées — exactement ce qu'on
 * cherche à détecter.
 */

const N = 3;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(text: string): Set<string> {
  const words = tokens(text);
  const grams = new Set<string>();
  // Texte trop court pour des trigrammes : on retombe sur les mots eux-mêmes,
  // sinon toute comparaison renverrait 0 et le garde-fou serait aveugle.
  if (words.length < N) {
    words.forEach((word) => grams.add(word));
    return grams;
  }
  for (let index = 0; index + N <= words.length; index += 1) {
    grams.add(words.slice(index, index + N).join(" "));
  }
  return grams;
}

/** 0 = rien en commun, 1 = identique. */
export function similarity(a: string, b: string): number {
  const left = ngrams(a);
  const right = ngrams(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;

  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Similarité la plus forte entre un texte et un ensemble de précédents. */
export function maxSimilarity(text: string, previous: readonly string[]): number {
  return previous.reduce((worst, other) => Math.max(worst, similarity(text, other)), 0);
}

/** Première et dernière phrase d'un texte — ce que le modèle recycle le plus. */
export function edges(text: string): { opening: string; closing: string } {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 12);

  return {
    opening: parts[0] ?? text.slice(0, 120),
    closing: parts[parts.length - 1] ?? "",
  };
}

/**
 * Géométrie commune au shader, aux images de premier plan et à la ligne SVG.
 *
 * Les images (public/scene) sont au format 3:1. Elles occupent toute la
 * hauteur de la scène et sont calées à droite : leur rectangle se déduit de la
 * taille de la scène, et tout ce qui doit s'y aligner (soleil, halo de lune,
 * bout de canne) est exprimé en fraction de ce rectangle.
 */

export const FOREGROUND_RATIO = 3;

/** Points remarquables, en fraction de l'image (x depuis la gauche, y depuis le haut). */
export const MARKS = {
  /** Soleil : à gauche du palmier, au-dessus de la mer libre. */
  sun: { x: 0.14, y: 0.36 },
  /** Centre lumineux du croissant de lune. */
  moon: { x: 0.72, y: 0.45 },
  /** Bout de la canne à pêche (night-moon.png n'a pas de ligne). */
  rodTip: { x: 0.43, y: 0.43 },
  /** Zone cliquable du pêcheur. */
  fisher: { x: 0.58, y: 0.40, w: 0.12, h: 0.50 },
} as const;

/** Rectangle des images, en fraction de la largeur de la scène. */
export function foregroundRect(width: number, height: number): { left: number; width: number } {
  const w = (height * FOREGROUND_RATIO) / Math.max(width, 1);
  return { left: 1 - w, width: w };
}

/**
 * Position shader (0-1, y vers le haut) d'un point de l'image.
 * `sink` fait descendre le point : le soleil se couche, la lune se lève.
 */
export function markToUv(
  mark: { x: number; y: number },
  rect: { left: number; width: number },
  sink = 0,
): [number, number] {
  return [rect.left + mark.x * rect.width, 1 - mark.y - sink];
}

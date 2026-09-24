/**
 * Conversion d'une couleur de thème vers une valeur acceptée par `<canvas>`.
 *
 * L'erreur corrigée ici, répétée des centaines de fois dans la console :
 *
 *   Failed to execute 'addColorStop' on 'CanvasGradient':
 *   rgba(52 198 222, 0.20) is not a valid value
 *
 * Les tokens `--rgb-*` sont écrits au format Tailwind — trois nombres séparés
 * par des espaces — parce que c'est ce qu'attend `rgb(var(--rgb-x) / <alpha>)`
 * en CSS. Mais `rgba(...)` à l'ancienne veut des VIRGULES, et le canvas refuse
 * la syntaxe mixte. Un composant lisait donc le token et l'injectait tel quel
 * dans `rgba(${token}, 0.2)`, ce qui ne pouvait pas fonctionner.
 *
 * Plutôt que de corriger chaque appel, un seul point de passage : il accepte
 * tout ce que le thème peut contenir — « r g b », « r, g, b », « #rrggbb »,
 * « #rgb », « rgb(...) », « rgba(...) » — et rend toujours une valeur valide.
 */

export type ColorInput = string | readonly [number, number, number] | null | undefined;

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** Triplet RVB extrait de n'importe quelle écriture, ou `null` si illisible. */
export function toRgbTriplet(input: ColorInput): [number, number, number] | null {
  if (!input) return null;

  if (Array.isArray(input)) {
    const [r, g, b] = input;
    return [r, g, b].every((part) => Number.isFinite(part))
      ? [clamp255(r), clamp255(g), clamp255(b)]
      : null;
  }

  const value = String(input).trim();
  if (!value) return null;

  // #rgb / #rrggbb
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((char) => char + char).join("") : hex[1];
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }

  // rgb(...) / rgba(...) — on ne garde que les trois premiers nombres, ce qui
  // couvre aussi la syntaxe moderne « rgb(52 198 222 / 0.2) ».
  const inner = /^rgba?\(([^)]*)\)$/i.exec(value);
  const body = inner ? inner[1] : value;

  const numbers = body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
    .filter((part) => Number.isFinite(part));

  if (numbers.length < 3) return null;
  return [clamp255(numbers[0]), clamp255(numbers[1]), clamp255(numbers[2])];
}

/**
 * Couleur prête pour `fillStyle`, `strokeStyle` ou `addColorStop`.
 *
 * `fallback` sert quand le token n'est pas encore défini (rendu serveur, thème
 * en cours de bascule) : on préfère une couleur approchée à une exception qui
 * casse toute la boucle de dessin.
 */
export function toCanvasColor(
  input: ColorInput,
  alpha = 1,
  fallback: readonly [number, number, number] = [128, 128, 128],
): string {
  const triplet = toRgbTriplet(input) ?? [...fallback];
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${triplet[0]}, ${triplet[1]}, ${triplet[2]}, ${safeAlpha})`;
}

/**
 * Lit un token CSS du thème courant et le rend utilisable en canvas.
 *
 * Renvoie la chaîne brute du token (jamais une couleur finale) : les
 * composants la gardent en mémoire entre deux images et n'appellent
 * `toCanvasColor` qu'au moment de peindre, avec l'alpha voulu.
 */
export function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

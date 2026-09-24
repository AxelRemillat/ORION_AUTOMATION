/**
 * Types et helpers purs du scrub, isolés du hook qui porte l'état.
 */

export interface ScrubState {
  /** Jour pointé, ou `null` au repos. */
  index: number | null;
  /** Plage comparée [début, fin], ou `null`. */
  range: [number, number] | null;
}

type Pointer = (event: React.PointerEvent) => void;

export interface Scrub extends ScrubState {
  /** À poser sur l'élément qui reçoit le pointeur (le SVG). */
  bind: {
    onPointerDown: Pointer;
    onPointerMove: Pointer;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onBlur: () => void;
    tabIndex: 0;
  };
  clear: () => void;
}

/** Sur tactile, en-deçà le geste reste au défilement de la page. */
export const TOUCH_HOLD_MS = 120;
/** En-deçà, un glissement est un clic : on ne crée pas de plage. */
export const MIN_RANGE = 2;

export const NAV_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"];

export const sameRange = (a: [number, number] | null, b: [number, number] | null) =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/** Jour visé par une touche de navigation. */
export function keyboardIndex(key: string, from: number, count: number): number {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return Math.max(0, Math.min(count - 1, from + (key === "ArrowRight" ? 1 : -1)));
}

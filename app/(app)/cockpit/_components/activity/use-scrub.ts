"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIN_RANGE,
  NAV_KEYS,
  TOUCH_HOLD_MS,
  keyboardIndex,
  sameRange,
  type Scrub,
  type ScrubState,
} from "./scrub-types";

/**
 * Suivi du curseur sur le graphique — pointeur, tactile et clavier.
 *
 * Deux garde-fous de performance :
 *   - le déplacement est accumulé dans une ref et vidé dans un unique
 *     `requestAnimationFrame` : au plus un calcul par image ;
 *   - l'état n'est poussé que si le jour CHANGE. Traverser un jour large ne
 *     déclenche donc qu'un seul rendu, pas un par pixel.
 *
 * Sur tactile, le scrub ne démarre qu'après 120 ms d'appui : en-dessous, le
 * geste reste au défilement vertical de la page (`touch-action: pan-y`).
 */

export function useScrub(
  count: number,
  /** Géométrie de la zone traçable, en pixels CSS. */
  plot: { left: number; width: number },
): Scrub {
  const [state, setState] = useState<ScrubState>({ index: null, range: null });

  const frame = useRef(0);
  const pendingX = useRef<number | null>(null);
  const rectLeft = useRef(0);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geometry = useRef(plot);
  geometry.current = plot;

  const indexAt = useCallback(
    (clientX: number) => {
      const { left, width } = geometry.current;
      if (width <= 0 || count <= 1) return 0;
      const ratio = (clientX - rectLeft.current - left) / width;
      return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
    },
    [count],
  );

  /** Vide la position en attente, au plus une fois par image. */
  const flush = useCallback(() => {
    frame.current = 0;
    const clientX = pendingX.current;
    if (clientX === null) return;
    const next = indexAt(clientX);

    setState((current) => {
      const range: [number, number] | null =
        dragging.current && anchor.current !== null && Math.abs(next - anchor.current) >= MIN_RANGE
          ? [Math.min(anchor.current, next), Math.max(anchor.current, next)]
          : current.range && !dragging.current
            ? current.range
            : null;

      // Rien n'a bougé : on évite un rendu inutile.
      if (current.index === next && sameRange(current.range, range)) return current;
      return { index: next, range };
    });
  }, [indexAt]);

  const schedule = useCallback(
    (event: React.PointerEvent) => {
      rectLeft.current = event.currentTarget.getBoundingClientRect().left;
      pendingX.current = event.clientX;
      if (!frame.current) frame.current = window.requestAnimationFrame(flush);
    },
    [flush],
  );

  const clear = useCallback(() => {
    dragging.current = false;
    anchor.current = null;
    pendingX.current = null;
    setState({ index: null, range: null });
  }, []);

  useEffect(
    () => () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  return {
    ...state,
    clear,
    bind: {
      tabIndex: 0,
      onPointerDown(event) {
        rectLeft.current = event.currentTarget.getBoundingClientRect().left;
        const start = indexAt(event.clientX);
        const begin = () => {
          dragging.current = true;
          anchor.current = start;
          setState({ index: start, range: null });
        };
        if (event.pointerType === "touch") {
          // Appui bref = défilement de la page ; appui tenu = scrub.
          holdTimer.current = setTimeout(begin, TOUCH_HOLD_MS);
        } else {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          begin();
        }
      },
      onPointerMove(event) {
        if (event.pointerType === "touch" && !dragging.current) return;
        schedule(event);
      },
      onPointerUp() {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        dragging.current = false;
        anchor.current = null;
      },
      onPointerCancel: clear,
      onPointerLeave() {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        if (!dragging.current) clear();
      },
      onBlur: clear,
      onKeyDown(event) {
        if (!NAV_KEYS.includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") return clear();
        setState((current) => ({
          index: keyboardIndex(event.key, current.index ?? count - 1, count),
          range: null,
        }));
      },
    },
  };
}

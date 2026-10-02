"use client";

import { useEffect, useRef } from "react";

/**
 * Raccourcis de « Aujourd'hui » : V valider, X écarter, E modifier, ↓/↑ et
 * J/K pour naviguer, Échap pour sortir d'un champ ou fermer un panneau.
 * Ignorés pendant la saisie (sauf Échap), et avec Ctrl / Cmd / Alt.
 */
export interface TodayKeys {
  validate: () => void;
  discard: () => void;
  edit: () => void;
  next: () => void;
  previous: () => void;
  escape: () => void;
  help: () => void;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function useTodayKeys(keys: TodayKeys, enabled = true) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const handlers = latest.current;
      if (event.key === "Escape") {
        if (typing(event.target)) (event.target as HTMLElement).blur();
        handlers.escape();
        return;
      }
      if (typing(event.target)) return;
      const action: Record<string, (() => void) | undefined> = {
        v: handlers.validate,
        x: handlers.discard,
        e: handlers.edit,
        j: handlers.next,
        ArrowDown: handlers.next,
        k: handlers.previous,
        ArrowUp: handlers.previous,
        "?": handlers.help,
      };
      const run = action[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? action[event.key];
      if (!run) return;
      event.preventDefault();
      run();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

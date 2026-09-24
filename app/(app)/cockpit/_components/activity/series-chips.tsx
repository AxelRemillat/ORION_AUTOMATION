"use client";

import { useRef } from "react";
import { SERIES, seriesColor, type SeriesKey } from "../../_lib/series";

/**
 * Puces de sélection des séries.
 *
 * Une puce ajoute ou retire UNIQUEMENT sa série — c'est ici que se joue le
 * multi-sélection. Décocher la dernière est refusé : un graphique sans courbe
 * n'apprend rien. Le refus est signifié par un petit tremblement plutôt que par
 * une puce désactivée, qui laisserait croire que la série est indisponible.
 */
export function SeriesChips({
  active,
  onToggle,
}: {
  active: Set<SeriesKey>;
  onToggle: (key: SeriesKey) => void;
}) {
  const refs = useRef(new Map<SeriesKey, HTMLButtonElement>());

  function handle(key: SeriesKey) {
    const isLast = active.has(key) && active.size === 1;
    if (!isLast) return onToggle(key);

    const node = refs.current.get(key);
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Web Animations : pas de keyframe CSS à déclarer pour un effet ponctuel.
    node.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 260, easing: "ease-out" },
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Séries affichées">
      {SERIES.map((meta) => {
        const on = active.has(meta.key);
        return (
          <button
            key={meta.key}
            ref={(node) => {
              if (node) refs.current.set(meta.key, node);
            }}
            type="button"
            aria-pressed={on}
            onClick={() => handle(meta.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium motion-safe:transition-colors ${
              on ? "border-line bg-surface-2 text-text" : "border-line-soft text-faint hover:text-muted"
            }`}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: on ? seriesColor(meta) : "var(--line)" }}
            />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

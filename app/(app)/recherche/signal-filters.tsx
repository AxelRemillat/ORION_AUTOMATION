"use client";

import { Check } from "lucide-react";
import { signalMeta } from "@/lib/scoring";

/**
 * Filtres par type de signal, multi-sélection.
 *
 * Les types proposés sont ceux RÉELLEMENT portés par les résultats affichés,
 * pas la taxonomie complète : offrir « Levée de fonds » quand aucun résultat
 * n'en porte laisse croire qu'un filtrage est possible, et donne une case qui
 * ne fait rien. Les libellés viennent de `SIGNAL_META`, source unique.
 */
export function SignalFilters({
  counts,
  selected,
  onToggle,
  onClear,
}: {
  /** Nombre de résultats par type, dans l'ordre d'affichage. */
  counts: { type: string; count: number }[];
  selected: string[];
  onToggle: (type: string) => void;
  onClear: () => void;
}) {
  if (!counts.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrer par signal">
      <span className="font-data text-[11px] uppercase tracking-wide text-faint">Signaux</span>

      {counts.map(({ type, count }) => {
        const active = selected.includes(type);
        const meta = signalMeta(type);
        return (
          <button
            key={type}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(type)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium",
              "motion-safe:transition-colors",
              active
                ? "border-primary bg-primary/15 text-primary-ink"
                : "border-line text-muted hover:bg-surface-2 hover:text-text",
            ].join(" ")}
          >
            {active && <Check className="h-3 w-3" aria-hidden />}
            {meta.label}
            <span className="font-data text-[11px] text-faint">{count}</span>
          </button>
        );
      })}

      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-1 text-[12px] text-muted underline-offset-2 hover:underline"
        >
          Tout afficher
        </button>
      )}
    </div>
  );
}

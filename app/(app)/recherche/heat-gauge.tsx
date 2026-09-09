import { HEAT_LEVEL_LABELS, type HeatScore } from "@/lib/scoring";

/**
 * Jauge de chaleur 0–100.
 *
 * Le remplissage porte --accent-grad : c'est la signature visuelle d'ORION.
 * Toutes les couleurs viennent des tokens de thème, aucune n'est codée en dur.
 * L'animation est conditionnée à `motion-safe` (prefers-reduced-motion).
 */
export function HeatGauge({
  score,
  compact = false,
}: {
  score: HeatScore;
  /** Version réduite : barre seule, sans en-tête. */
  compact?: boolean;
}) {
  const label = HEAT_LEVEL_LABELS[score.level];

  return (
    <div className="w-full">
      {!compact && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            Chaleur
          </span>
          <span className="flex items-baseline gap-1.5">
            <span
              className="font-data text-sm font-semibold"
              style={{ color: "var(--text)" }}
            >
              {score.value}
            </span>
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              /100 · {label}
            </span>
          </span>
        </div>
      )}

      <div
        role="meter"
        aria-valuenow={score.value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Score de chaleur : ${score.value} sur 100, ${label}`}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)" }}
      >
        <div
          className="bg-brand-grad h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
          style={{ width: `${score.value}%` }}
        />
      </div>
    </div>
  );
}

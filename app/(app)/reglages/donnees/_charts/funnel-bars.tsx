import type { FunnelStage } from "../_lib/metrics";

/**
 * Entonnoir en barres décroissantes. Chaque étape porte son effectif et la
 * conversion depuis l'étape précédente. Le dégradé de marque s'estompe au fil
 * des étapes pour donner la profondeur sans ajouter de couleur.
 */
export function FunnelBars({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.count ?? 0;

  return (
    <ol className="space-y-2.5">
      {stages.map((stage, index) => {
        const width = top > 0 ? Math.max((stage.count / top) * 100, stage.count > 0 ? 6 : 2) : 2;
        return (
          <li key={stage.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-[var(--text)]">{stage.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] tabular-nums text-[var(--text)]">
                  {stage.count}
                </span>
                {stage.conversion !== null && (
                  <span className="font-mono text-[11px] tabular-nums text-[var(--faint)]">
                    {Math.round(stage.conversion * 100)} %
                  </span>
                )}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--line-soft)" }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${width}%`,
                  background: "var(--accent-grad)",
                  opacity: 1 - index * 0.14,
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

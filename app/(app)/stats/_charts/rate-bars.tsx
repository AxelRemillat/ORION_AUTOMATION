import type { Breakdown } from "../_lib/metrics";

/**
 * Taux de réponse par segment (secteur, séquence, signal).
 * L'effectif est toujours affiché : un taux sur 2 prospects ne doit jamais
 * ressembler à un taux sur 200.
 */
export function RateBars({ rows, emptyLabel }: { rows: Breakdown[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="py-4 text-[13px] text-[var(--faint)]">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] text-[var(--text)]">{row.label}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="font-mono text-[13px] tabular-nums text-[var(--text)]">
                {Math.round(row.rate * 100)} %
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--faint)]">
                {row.replied}/{row.contacted}
              </span>
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--line-soft)" }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
              style={{
                width: `${Math.max(row.rate * 100, row.rate > 0 ? 3 : 0)}%`,
                background: "var(--primary)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

import { formatEur } from "@/lib/utils";
import type { MonthPoint } from "../_lib/metrics";

/**
 * Colonnes du CA signé par mois. Le mois courant est mis en avant par le
 * dégradé de marque, les précédents restent en bleu plein plus discret.
 */
export function MonthBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(...points.map((point) => point.amount), 1);

  return (
    <div className="flex items-end gap-2" style={{ height: 132 }}>
      {points.map((point, index) => {
        const isLast = index === points.length - 1;
        const height = point.amount > 0 ? Math.max((point.amount / max) * 100, 4) : 2;
        return (
          <div key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-[var(--faint)]">
              {point.amount > 0 ? formatEur(point.amount) : ""}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md transition-[height] duration-500 motion-reduce:transition-none"
                style={{
                  height: `${height}%`,
                  background: isLast ? "var(--accent-grad)" : "var(--primary)",
                  opacity: point.amount > 0 ? (isLast ? 1 : 0.55) : 0.25,
                }}
                title={`${point.label} — ${formatEur(point.amount)} · ${point.deals} contrat(s)`}
              />
            </div>
            <span className="truncate text-[11px] text-[var(--muted)]">{point.label}</span>
          </div>
        );
      })}
    </div>
  );
}

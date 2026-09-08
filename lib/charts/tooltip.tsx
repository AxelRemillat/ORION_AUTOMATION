"use client";

import { cn } from "@/lib/utils";

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Mise en forme de la valeur (€, %, unités…), par série. */
  format?: (value: number, dataKey?: string) => string;
  className?: string;
}

/** Info-bulle commune aux graphes — reprend surface/bordure du design system. */
export function ChartTooltip({ active, label, payload, format, className }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className={cn(
        "rounded border border-border bg-surface px-3 py-2 text-[12px] shadow-overlay",
        className,
      )}
    >
      {label != null && <p className="mb-1 font-medium text-fg">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={`${entry.dataKey ?? index}`} className="flex items-center gap-2 text-muted">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span>{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-fg">
              {format
                ? format(Number(entry.value ?? 0), String(entry.dataKey ?? ""))
                : String(entry.value ?? "—")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

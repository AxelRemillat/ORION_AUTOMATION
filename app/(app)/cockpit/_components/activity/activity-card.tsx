"use client";

import { useCallback, useState } from "react";
import { LineChart } from "lucide-react";
import {
  PERIODS,
  type ChartData,
  type Period,
  type SeriesKey,
} from "../../_lib/series";
import { ActivityChart } from "./activity-chart";
import { ActivityHeader } from "./activity-header";
import { SeriesChips } from "./series-chips";

/**
 * Carte « Activité » — état de sélection et de période, puis mise en page.
 *
 * La sélection est un `Set` : une puce ajoute ou retire SA série, sans toucher
 * aux autres. Elle est recopiée dans l'URL (`?kpi=…`) pour survivre à un
 * rafraîchissement, via `history.replaceState` : pas de localStorage, pas de
 * navigation, pas d'historique pollué.
 */
export function ActivityCard({
  periods,
  initialSeries,
}: {
  periods: Record<Period, ChartData>;
  initialSeries: SeriesKey[];
}) {
  const [period, setPeriod] = useState<Period>(30);
  const [active, setActive] = useState<Set<SeriesKey>>(() => new Set(initialSeries));
  const [cursor, setCursor] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);

  const onCursor = useCallback((index: number | null, span: [number, number] | null) => {
    setCursor(index);
    setRange(span);
  }, []);

  function toggle(key: SeriesKey) {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Le dernier retrait est refusé en amont (SeriesChips) : ceinture.
      if (next.size === 0) return current;

      const url = new URL(window.location.href);
      url.searchParams.set("kpi", [...next].join(","));
      window.history.replaceState(null, "", url);
      return next;
    });
  }

  const data = periods[period];

  return (
    <section className="shadow-mist rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-4 pt-5">
        <LineChart className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Activité</h2>
        <span className="text-[12px] text-muted">
          Taux de réponse{" "}
          <span className="font-data font-semibold tabular-nums text-text">
            {Math.round(data.responseRate * 100)} %
          </span>
        </span>

        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Période">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
              className={`font-data rounded px-2 py-1 text-[12px] font-medium motion-safe:transition-colors ${
                period === value ? "bg-primary/10 text-primary-ink" : "text-muted hover:text-text"
              }`}
            >
              {value} j
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pb-4">
        <ActivityHeader data={data} active={active} cursor={cursor} range={range} />
      </div>

      <div className="px-5 pb-3">
        <SeriesChips active={active} onToggle={toggle} />
      </div>

      <ActivityChart data={data} active={active} onCursor={onCursor} />
    </section>
  );
}

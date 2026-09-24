"use client";

import { useEffect, useRef, useState } from "react";
import { formatEur } from "@/lib/utils";
import { SERIES, seriesColor, type ChartData, type SeriesKey } from "../../_lib/series";

/**
 * Le bandeau de chiffres — la vedette, pas l'infobulle.
 *
 * Au repos : total de la période et variation contre la période précédente.
 * Pendant le survol : la valeur du jour pointé, et la date. Les nombres sont
 * interpolés sur ~150 ms et rendus en chiffres tabulaires : sans ça, la largeur
 * change à chaque image et la ligne sautille.
 */

const TWEEN_MS = 150;

/** Interpole vers `target`. Instantané si l'utilisateur limite les animations. */
function useTween(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = origin + (target - origin) * eased;
      setValue(next);
      from.current = next;
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);

  return value;
}

function Figure({
  seriesKey,
  value,
  unit,
}: {
  seriesKey: SeriesKey;
  value: number;
  unit: "count" | "eur";
}) {
  const tweened = useTween(value);
  return (
    <span key={seriesKey} className="font-data text-lg font-semibold tabular-nums text-text">
      {unit === "eur" ? formatEur(Math.round(tweened)) : Math.round(tweened)}
    </span>
  );
}

/** Variation en %, ou « — » quand la période précédente était vide. */
function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return <span className="font-data text-[11px] text-faint">—</span>;
  }
  const ratio = (current - previous) / Math.abs(previous);
  const up = ratio >= 0;
  return (
    <span
      className="font-data text-[11px] font-medium tabular-nums"
      style={{ color: up ? "var(--good-ink, var(--good))" : "var(--lost-ink, var(--lost))" }}
    >
      {up ? "▲" : "▼"} {Math.abs(Math.round(ratio * 100))} %
    </span>
  );
}

export function ActivityHeader({
  data,
  active,
  cursor,
  range,
}: {
  data: ChartData;
  active: Set<SeriesKey>;
  cursor: number | null;
  range: [number, number] | null;
}) {
  const shown = SERIES.filter((meta) => active.has(meta.key));
  const scrubbing = cursor !== null;

  const caption = range
    ? `Du ${data.labels[range[0]]} au ${data.labels[range[1]]}`
    : scrubbing
      ? data.labels[cursor]
      : "Sur la période";

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="flex flex-wrap items-end gap-x-6 gap-y-3"
    >
      {shown.map((meta) => {
        const series = data.values[meta.key];
        // En plage : l'écart entre les deux bornes. Sinon la valeur du jour,
        // ou le total de la période au repos.
        const value = range
          ? meta.unit === "eur"
            ? series[range[1]] - series[range[0]]
            : series.slice(range[0], range[1] + 1).reduce((total, v) => total + v, 0)
          : scrubbing
            ? series[cursor]
            : data.totals[meta.key];

        return (
          <div key={meta.key} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: seriesColor(meta) }}
              />
              {meta.label}
            </span>
            <span className="flex items-baseline gap-2">
              <Figure seriesKey={meta.key} value={value} unit={meta.unit} />
              {!scrubbing && !range && (
                <Delta current={data.totals[meta.key]} previous={data.previous[meta.key]} />
              )}
            </span>
          </div>
        );
      })}

      <span className="font-data ml-auto self-start text-[11px] text-faint">{caption}</span>
    </div>
  );
}

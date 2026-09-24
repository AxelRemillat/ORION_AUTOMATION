import { useMemo } from "react";
import { monotoneArea, monotonePath, type Point } from "@/lib/charts/monotone-path";
import { niceTicks } from "@/lib/charts/nice-ticks";
import type { ChartData, SeriesMeta } from "../../_lib/series";
import type { SeriesPath } from "./activity-curves";

/**
 * Echelles et chemins, memoises sur (donnees, series, dimensions).
 *
 * C'est la garantie de performance du scrub : deplacer le pointeur change le
 * curseur, jamais cette valeur — aucun `d` n'est recalcule.
 */
export function useGeometry(
  data: ChartData,
  shown: SeriesMeta[],
  box: { plotW: number; plotH: number; padLeft: number; padTop: number },
) {
  const { plotW, plotH, padLeft, padTop } = box;
  return useMemo(() => {
    const leftScale = niceTicks(
      Math.max(0, ...shown.filter((m) => m.axis === "left").flatMap((m) => data.values[m.key])),
      { integer: true },
    );
    const rightScale = niceTicks(Math.max(0, ...data.values.pipeline));

    const x = (index: number) =>
      padLeft + (data.days.length > 1 ? (index / (data.days.length - 1)) * plotW : plotW / 2);
    const y = (value: number, axis: "left" | "right") =>
      padTop + plotH - (value / (axis === "left" ? leftScale.max : rightScale.max)) * plotH;

    const paths: SeriesPath[] = shown.map((meta) => {
      const points: Point[] = data.values[meta.key].map((value, index) => ({
        x: x(index),
        y: y(value, meta.axis),
      }));
      return {
        meta,
        points,
        line: monotonePath(points),
        area: monotoneArea(points, padTop + plotH),
      };
    });

    return { leftScale, rightScale, x, y, paths };
  }, [data, shown, plotW, plotH, padLeft, padTop]);
}

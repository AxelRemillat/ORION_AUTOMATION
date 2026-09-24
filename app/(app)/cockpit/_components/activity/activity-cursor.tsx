"use client";

import { seriesColor } from "../../_lib/series";
import type { SeriesPath } from "./activity-curves";

/** Ligne de curseur, points d'intersection et halos. */
export function ActivityCursor({
  paths,
  index,
  cursorX,
  plot,
}: {
  paths: SeriesPath[];
  index: number;
  cursorX: number;
  plot: { top: number; height: number };
}) {
  return (
    <g aria-hidden>
      <line
        x1={cursorX}
        x2={cursorX}
        y1={plot.top}
        y2={plot.top + plot.height}
        style={{ stroke: "rgb(var(--rgb-text) / 0.28)" }}
        strokeWidth={1}
      />
      {paths.map(({ meta, points }) => (
        <g key={meta.key}>
          <circle cx={cursorX} cy={points[index].y} r={10} style={{ fill: seriesColor(meta, 0.25) }} />
          <circle
            cx={cursorX}
            cy={points[index].y}
            r={4}
            style={{ fill: seriesColor(meta), stroke: "var(--surface)" }}
            strokeWidth={1.5}
          />
        </g>
      ))}
    </g>
  );
}

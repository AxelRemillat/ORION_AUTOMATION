"use client";

import { useRef } from "react";
import type { Point } from "@/lib/charts/monotone-path";
import { seriesColor, type SeriesKey, type SeriesMeta } from "../../_lib/series";

export interface SeriesPath {
  meta: SeriesMeta;
  points: Point[];
  line: string;
  area: string;
}

/**
 * Aires et courbes.
 *
 * Chaque série a ses PROPRES identifiants de dégradé et de clip, préfixés par
 * sa clé et par le `useId()` de la carte : deux séries ne peuvent donc pas se
 * voler leur remplissage, et deux cartes sur la même page non plus.
 *
 * Pendant le scrub, la courbe est peinte deux fois : une fois estompée sur
 * toute sa longueur, une fois pleine mais découpée à gauche du curseur. C'est
 * ce qui donne l'effet « le passé est net, le futur est en retrait ».
 */
export function ActivityCurves({
  paths,
  uid,
  areaAlpha,
  scrubbing,
  cursorX,
  plot,
  periodKey,
}: {
  paths: SeriesPath[];
  uid: string;
  areaAlpha: number;
  scrubbing: boolean;
  cursorX: number;
  plot: { left: number; height: number };
  periodKey: number;
}) {
  const drawn = useRef(new Set<SeriesKey>());

  /** Tracé progressif à l'apparition d'une série. */
  function drawIn(node: SVGPathElement | null, key: SeriesKey) {
    if (!node || drawn.current.has(key)) return;
    drawn.current.add(key);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const length = node.getTotalLength();
    node.style.strokeDasharray = String(length);
    node.style.strokeDashoffset = String(length);
    const animation = node.animate(
      [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      { duration: 500, easing: "ease-out" },
    );
    animation.onfinish = () => {
      node.style.strokeDasharray = "";
      node.style.strokeDashoffset = "";
    };
  }

  return (
    <>
      <defs>
        {paths.map(({ meta }) => (
          <linearGradient key={meta.key} id={`fill-${meta.key}-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: seriesColor(meta), stopOpacity: areaAlpha }} />
            <stop offset="100%" style={{ stopColor: seriesColor(meta), stopOpacity: 0 }} />
          </linearGradient>
        ))}
        {paths.map(({ meta }) => (
          <clipPath key={meta.key} id={`clip-${meta.key}-${uid}`}>
            <rect
              x={plot.left}
              y={0}
              width={Math.max(0, cursorX - plot.left)}
              height={plot.height}
            />
          </clipPath>
        ))}
      </defs>

      {/* `key` sur la période : un changement remonte des chemins neufs, donc
          un fondu d'entrée plutôt qu'un saut. */}
      <g key={periodKey} className="motion-safe:animate-fade-in">
        {paths.map(({ meta, line, area }) => (
          <g key={meta.key}>
            <path d={area} fill={`url(#fill-${meta.key}-${uid})`} />
            <path
              ref={(node) => drawIn(node, meta.key)}
              d={line}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: seriesColor(meta), opacity: scrubbing ? 0.35 : 1 }}
            />
            {scrubbing && (
              <path
                d={line}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                clipPath={`url(#clip-${meta.key}-${uid})`}
                style={{ stroke: seriesColor(meta) }}
              />
            )}
          </g>
        ))}
      </g>
    </>
  );
}

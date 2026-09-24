"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SERIES, type ChartData, type SeriesKey } from "../../_lib/series";
import { ActivityAxes } from "./activity-axes";
import { ActivityCurves } from "./activity-curves";
import { ActivityCursor } from "./activity-cursor";
import { useGeometry } from "./use-geometry";
import { useScrub } from "./use-scrub";

/**
 * Le graphique : géométrie, axes, courbes, curseur.
 *
 * Les chemins sont mémoïsés sur (données, séries, largeur) : bouger le pointeur
 * déplace le curseur sans jamais recalculer un `d`.
 *
 * L'axe des euros n'apparaît que si la série pipeline est active ET non nulle.
 * À zéro sur toute la période, on l'annonce en clair plutôt que d'aligner des
 * graduations vides.
 */

const HEIGHT = 240;
const PAD = { top: 16, bottom: 24, left: 44 };
const RIGHT_WITH_AXIS = 56;
const RIGHT_BARE = 12;

export function ActivityChart({
  data,
  active,
  onCursor,
}: {
  data: ChartData;
  active: Set<SeriesKey>;
  onCursor: (index: number | null, range: [number, number] | null) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(box);
    setWidth(box.clientWidth);
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(() => SERIES.filter((meta) => active.has(meta.key)), [active]);
  const pipelineOn = shown.some((meta) => meta.axis === "right");
  const pipelineEmpty = data.values.pipeline.every((value) => value === 0);
  const showEuroAxis = pipelineOn && !pipelineEmpty;

  const right = showEuroAxis ? RIGHT_WITH_AXIS : RIGHT_BARE;
  const plotW = Math.max(80, width - PAD.left - right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const scrub = useScrub(data.days.length, { left: PAD.left, width: plotW });
  useEffect(() => onCursor(scrub.index, scrub.range), [scrub.index, scrub.range, onCursor]);

  const geometry = useGeometry(data, shown, { plotW, plotH, padLeft: PAD.left, padTop: PAD.top });

  // Aire discrète quand la courbe est seule, presque effacée dès qu'il y en a
  // plusieurs : au-delà de deux remplissages superposés, plus rien ne se lit.
  const areaAlpha = shown.length > 1 ? 0.08 : 0.18;
  const scrubbing = scrub.index !== null;
  const cursorX = scrubbing ? geometry.x(scrub.index as number) : 0;
  const plot = { left: PAD.left, width: plotW, top: PAD.top, height: plotH, svgHeight: HEIGHT };

  return (
    <div ref={boxRef} className="relative px-5 pb-5" style={{ touchAction: "pan-y" }}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Activité sur ${data.days.length} jours. Flèches gauche et droite pour parcourir les jours.`}
        className="overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        {...scrub.bind}
      >
        <ActivityAxes
          leftScale={geometry.leftScale}
          rightScale={geometry.rightScale}
          showEuroAxis={showEuroAxis}
          labels={data.labels}
          days={data.days}
          plot={plot}
          x={geometry.x}
          y={geometry.y}
        />

        {scrub.range && (
          <rect
            x={geometry.x(scrub.range[0])}
            y={PAD.top}
            width={geometry.x(scrub.range[1]) - geometry.x(scrub.range[0])}
            height={plotH}
            style={{ fill: "rgb(var(--rgb-primary) / 0.10)" }}
          />
        )}

        <ActivityCurves
          paths={geometry.paths}
          uid={uid}
          areaAlpha={areaAlpha}
          scrubbing={scrubbing}
          cursorX={cursorX}
          plot={{ left: PAD.left, height: HEIGHT }}
          periodKey={data.days.length}
        />

        {scrubbing && (
          <ActivityCursor
            paths={geometry.paths}
            index={scrub.index as number}
            cursorX={cursorX}
            plot={{ top: PAD.top, height: plotH }}
          />
        )}
      </svg>

      {pipelineOn && pipelineEmpty && (
        <p className="mt-1 text-[11px] text-faint">Aucune valeur pipeline sur la période.</p>
      )}
      {!data.hasData && (
        <p className="mt-2 text-center text-[13px] text-muted">
          Aucune activité sur cette période. Les courbes se rempliront dès vos premiers envois.
        </p>
      )}
    </div>
  );
}

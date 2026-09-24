import { formatEurCompact, type TickScale } from "@/lib/charts/nice-ticks";

/**
 * Grille et graduations.
 *
 * Grille horizontale seule, à 6 % d'opacité : elle doit se deviner, pas se
 * lire. Les graduations viennent de `niceTicks`, donc d'un pas rond — c'est ce
 * qui supprime les libellés en double (« 2, 2, 1, 1, 0 ») que produisait un
 * découpage en parts égales suivi d'un arrondi.
 */
export function ActivityAxes({
  leftScale,
  rightScale,
  showEuroAxis,
  labels,
  days,
  plot,
  x,
  y,
}: {
  leftScale: TickScale;
  rightScale: TickScale;
  showEuroAxis: boolean;
  labels: string[];
  days: string[];
  plot: { left: number; width: number; top: number; height: number; svgHeight: number };
  x: (index: number) => number;
  y: (value: number, axis: "left" | "right") => number;
}) {
  const step = Math.ceil(days.length / 6);

  return (
    <g aria-hidden>
      {leftScale.ticks.map((tick) => {
        const lineY = y(tick, "left");
        return (
          <g key={`left-${tick}`}>
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={lineY}
              y2={lineY}
              style={{ stroke: "rgb(var(--rgb-text) / 0.06)" }}
              strokeWidth={1}
            />
            <text
              x={plot.left - 8}
              y={lineY + 3}
              textAnchor="end"
              className="font-data"
              style={{ fill: "var(--faint)", fontSize: 10 }}
            >
              {tick}
            </text>
          </g>
        );
      })}

      {showEuroAxis &&
        rightScale.ticks.map((tick) => (
          <text
            key={`eur-${tick}`}
            x={plot.left + plot.width + 8}
            y={y(tick, "right") + 3}
            className="font-data"
            style={{ fill: "var(--faint)", fontSize: 10 }}
          >
            {formatEurCompact(tick)}
          </text>
        ))}

      {labels.map((label, index) => {
        if (index % step !== 0 && index !== days.length - 1) return null;
        return (
          <text
            key={days[index]}
            x={x(index)}
            y={plot.svgHeight - 6}
            textAnchor="middle"
            className="font-data"
            style={{ fill: "var(--faint)", fontSize: 10 }}
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

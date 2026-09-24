"use client";

import { useEffect, useRef, useState } from "react";
import { LineChart } from "lucide-react";
import { formatEur } from "@/lib/utils";
import {
  DEFAULT_SERIES,
  PERIODS,
  SERIES,
  type ChartData,
  type Period,
  type SeriesKey,
} from "../_lib/series";

/**
 * Le seul graphique du Cockpit : toutes les séries sur un même axe de temps.
 *
 * SVG inline, sans librairie. Les couleurs passent par `style` et non par un
 * attribut de présentation — c'est la seule forme où `var(--token)` est
 * garanti, d'où le suivi automatique du thème clair / sombre.
 *
 * La largeur est MESURÉE plutôt que laissée au `viewBox` : un viewBox étiré
 * déformerait les libellés et les points. On rend donc en pixels réels.
 */

const HEIGHT = 260;
const PAD = { top: 16, right: 56, bottom: 26, left: 44 };

const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
};

const shortEur = (value: number) =>
  value >= 1000 ? `${Math.round(value / 1000)} k€` : `${Math.round(value)} €`;

export function KpiChart({ periods }: { periods: Record<Period, ChartData> }) {
  const [period, setPeriod] = useState<Period>(30);
  const [active, setActive] = useState<SeriesKey[]>(DEFAULT_SERIES);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const boxRef = useRef<HTMLDivElement>(null);

  // Largeur réelle du conteneur : le SVG est dessiné à cette taille.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(box);
    setWidth(box.clientWidth);
    return () => observer.disconnect();
  }, []);

  const data = periods[period];

  const shown = SERIES.filter((meta) => active.includes(meta.key));
  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  // Deux échelles : les volumes à gauche, les euros à droite.
  const leftMax = niceMax(
    Math.max(...shown.filter((m) => m.axis === "left").flatMap((m) => data.values[m.key]), 0),
  );
  const rightMax = niceMax(
    Math.max(...shown.filter((m) => m.axis === "right").flatMap((m) => data.values[m.key]), 0),
  );

  const x = (index: number) =>
    PAD.left + (data.days.length > 1 ? (index / (data.days.length - 1)) * plotW : plotW / 2);
  const y = (value: number, axis: "left" | "right") =>
    PAD.top + plotH - (value / (axis === "left" ? leftMax : rightMax)) * plotH;

  const toggle = (key: SeriesKey) =>
    setActive((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  /** Jour le plus proche du curseur. */
  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - PAD.left) / plotW;
    const index = Math.round(ratio * (data.days.length - 1));
    setHover(index >= 0 && index < data.days.length ? index : null);
  }

  return (
    <section className="shadow-mist rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 pt-5">
        <LineChart className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Activité</h2>

        <span className="text-[12px] text-muted">
          Taux de réponse{" "}
          <span className="font-data font-semibold text-text">
            {Math.round(data.responseRate * 100)} %
          </span>{" "}
          <span className="text-faint">
            ({data.replies}/{data.sent} sur la période)
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

      {/* Légende : chaque puce montre ou masque sa courbe. */}
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {SERIES.map((meta) => {
          const on = active.includes(meta.key);
          return (
            <button
              key={meta.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(meta.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium motion-safe:transition-colors ${
                on ? "border-line bg-surface-2 text-text" : "border-line-soft text-faint"
              }`}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: on ? `var(${meta.token})` : "var(--line)" }}
              />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div ref={boxRef} className="relative px-5 pb-5">
        <svg
          width={width}
          height={HEIGHT}
          className="overflow-visible"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Activité sur ${period} jours`}
        >
          {/* Grille et graduations de gauche. */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const lineY = PAD.top + plotH * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={lineY}
                  y2={lineY}
                  style={{ stroke: "var(--line-soft)" }}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={lineY + 3}
                  textAnchor="end"
                  className="font-data"
                  style={{ fill: "var(--faint)", fontSize: 10 }}
                >
                  {Math.round(leftMax * ratio)}
                </text>
                {shown.some((meta) => meta.axis === "right") && (
                  <text
                    x={PAD.left + plotW + 8}
                    y={lineY + 3}
                    className="font-data"
                    style={{ fill: "var(--faint)", fontSize: 10 }}
                  >
                    {shortEur(rightMax * ratio)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Libellés de dates : quelques repères, jamais tous. */}
          {data.labels.map((label, index) => {
            const step = Math.ceil(data.days.length / 6);
            if (index % step !== 0 && index !== data.days.length - 1) return null;
            return (
              <text
                key={data.days[index]}
                x={x(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="font-data"
                style={{ fill: "var(--faint)", fontSize: 10 }}
              >
                {label}
              </text>
            );
          })}

          {/* Les courbes. */}
          {shown.map((meta) => {
            const points = data.values[meta.key].map(
              (value, index) => `${x(index)},${y(value, meta.axis)}`,
            );
            return (
              <polyline
                key={meta.key}
                points={points.join(" ")}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ stroke: `var(${meta.token})` }}
              />
            );
          })}

          {/* Repère de survol. */}
          {hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                style={{ stroke: "var(--muted)" }}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {shown.map((meta) => (
                <circle
                  key={meta.key}
                  cx={x(hover)}
                  cy={y(data.values[meta.key][hover], meta.axis)}
                  r={3.5}
                  style={{ fill: `var(${meta.token})`, stroke: "var(--surface)" }}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="shadow-overlay pointer-events-none absolute top-4 rounded-lg border border-line bg-elev p-3"
            style={{
              left: Math.min(Math.max(x(hover) - 60, 12), Math.max(width - 150, 12)),
              minWidth: 150,
            }}
          >
            <p className="font-data mb-1.5 text-[11px] font-semibold text-text">
              {data.labels[hover]}
            </p>
            {SERIES.map((meta) => (
              <p key={meta.key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(${meta.token})` }}
                  />
                  {meta.label}
                </span>
                <span className="font-data font-medium text-text">
                  {meta.unit === "eur"
                    ? formatEur(data.values[meta.key][hover])
                    : data.values[meta.key][hover]}
                </span>
              </p>
            ))}
          </div>
        )}

        {!data.hasData && (
          <p className="mt-2 text-center text-[13px] text-muted">
            Aucune activité sur cette période. Les courbes se rempliront dès vos premiers envois.
          </p>
        )}
      </div>
    </section>
  );
}

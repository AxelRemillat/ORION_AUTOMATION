"use client";

import { useState } from "react";
import { MARKS } from "./geometry";

/**
 * Ligne de pêche et étoile en pendule, dessinées au-dessus de night-moon.png
 * (l'image n'a volontairement pas de ligne). Repère : viewBox 300 × 100, le
 * même rectangle 3:1 que l'image.
 *
 * Easter egg : un clic sur le pêcheur remonte l'étoile au bout de la canne,
 * puis elle file au ciel et revient se poser au bout de la ligne.
 */

const TIP = { x: MARKS.rodTip.x * 300, y: MARKS.rodTip.y * 100 };
const LENGTH = 30;

type Phase = "idle" | "reel" | "fly";

export function FishingLine() {
  const [phase, setPhase] = useState<Phase>("idle");

  function reel() {
    if (phase !== "idle") return;
    setPhase("reel");
    window.setTimeout(() => setPhase("fly"), 900);
    window.setTimeout(() => setPhase("idle"), 2600);
  }

  const origin = `${TIP.x}px ${TIP.y}px`;
  const star =
    phase === "idle" ? "translate(0,0)" : phase === "reel" ? `translate(0,${-LENGTH}px)` : `translate(80px,${-LENGTH - 60}px) scale(0.3)`;

  return (
    <>
      <svg viewBox="0 0 300 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <radialGradient id="hero-star-glow">
            <stop offset="0%" stopColor="rgb(var(--rgb-warn))" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(var(--rgb-warn))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="fishing-pendulum" style={{ transformOrigin: origin }}>
          <line
            x1={TIP.x}
            y1={TIP.y}
            x2={TIP.x}
            y2={TIP.y + LENGTH}
            className="fishing-line"
            style={{ transformOrigin: origin, transform: phase === "idle" ? "scaleY(1)" : "scaleY(0)" }}
          />
          <g
            className="fishing-star"
            data-phase={phase}
            style={{ transform: star, transformOrigin: `${TIP.x}px ${TIP.y + LENGTH}px` }}
          >
            <circle cx={TIP.x} cy={TIP.y + LENGTH} r={7} fill="url(#hero-star-glow)" className="fishing-star__halo" />
            <path
              d={starPath(TIP.x, TIP.y + LENGTH, 2.6, 1.1)}
              fill="rgb(var(--rgb-warn))"
              className="fishing-star__core"
            />
          </g>
        </g>
      </svg>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={reel}
        className="pointer-events-auto absolute cursor-pointer rounded-full"
        style={{
          left: `${MARKS.fisher.x * 100}%`,
          top: `${MARKS.fisher.y * 100}%`,
          width: `${MARKS.fisher.w * 100}%`,
          height: `${MARKS.fisher.h * 100}%`,
        }}
      />
    </>
  );
}

/** Étoile à quatre branches, centrée en (cx, cy). */
function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner * 0.6;
    return `${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

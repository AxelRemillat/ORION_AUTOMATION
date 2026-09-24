"use client";

import { useState } from "react";
import { DayShore } from "./day-shore";

/**
 * Plage au soleil — scene de jour.
 *
 * Tout est en SVG inline : aucune image, aucune librairie. Le motif de vague
 * est dessine sur 600 unites pour une periode de 100, si bien qu'une
 * translation de -100 boucle sans raccord visible.
 */

/** Une vague : periode de 100, dessinee assez large pour couvrir le defilement. */
const WAVE =
  "M0 8 q25 -7 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 V70 H0 Z";

const CLOUDS = [
  { x: 70, y: 30, scale: 1, duration: 90, delay: -10, opacity: 0.95 },
  { x: 200, y: 52, scale: 0.7, duration: 62, delay: -35, opacity: 0.8 },
  { x: 320, y: 18, scale: 0.5, duration: 44, delay: -20, opacity: 0.7 },
];

export function DayScene() {
  // Change de valeur a chaque clic : remonte l'element, donc rejoue l'animation.
  const [wink, setWink] = useState(0);

  return (
    <>
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sceneDaySky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--scene-day-sky-top)" />
            <stop offset="100%" stopColor="var(--scene-day-sky-low)" />
          </linearGradient>
          <radialGradient id="sceneSunHalo">
            <stop offset="0%" stopColor="var(--scene-sun)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--scene-sun)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="400" height="200" fill="url(#sceneDaySky)" />

        {/* Soleil : halo qui respire, rayons qui tournent en une minute. */}
        <g className="scene-sun-group">
          <g transform="translate(300 52)">
            <circle
              r="46"
              fill="url(#sceneSunHalo)"
              style={{ animation: "scene-pulse 6s ease-in-out infinite" }}
            />
            <g key={wink} style={wink ? { animation: "scene-wink 600ms ease-out" } : undefined}>
              <g style={{ animation: "scene-spin 60s linear infinite" }}>
                {Array.from({ length: 12 }, (_, index) => (
                  <rect
                    key={index}
                    x="-0.8"
                    y="-34"
                    width="1.6"
                    height="9"
                    rx="0.8"
                    fill="var(--scene-sun)"
                    opacity="0.75"
                    transform={`rotate(${index * 30})`}
                  />
                ))}
              </g>
              <circle r="19" fill="var(--scene-sun)" />
              <circle r="13" fill="var(--scene-sun-core)" />
            </g>
          </g>
        </g>

        {CLOUDS.map((cloud) => (
          <g
            key={cloud.duration}
            opacity={cloud.opacity}
            style={{
              animation: `scene-drift ${cloud.duration}s linear infinite`,
              animationDelay: `${cloud.delay}s`,
            }}
          >
            <g transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`}>
              <circle cx="0" cy="0" r="9" fill="var(--scene-cloud)" />
              <circle cx="12" cy="-4" r="12" fill="var(--scene-cloud)" />
              <circle cx="26" cy="1" r="8" fill="var(--scene-cloud)" />
              <rect x="-2" y="-1" width="30" height="10" rx="5" fill="var(--scene-cloud)" />
            </g>
          </g>
        ))}

        <DayShore />

      </svg>

      <button
        type="button"
        onClick={() => setWink((value) => value + 1)}
        aria-label="Faire cligner le soleil"
        className="pointer-events-auto absolute right-[18%] top-[16%] h-11 w-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </>
  );
}

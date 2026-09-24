"use client";

import { useState } from "react";

/**
 * Silhouette assise sur la corne basse du croissant, canne tenue a deux mains.
 *
 * Dessin original, de profil, jambes pendantes. Aucun texte, aucun logo,
 * aucune marque : c'est un clin d'oeil a l'imagerie des contes, pas une
 * reproduction.
 *
 * Easter egg : la ligne remonte, l'etoile file vers le ciel, et une nouvelle
 * apparait au bout. Declenchable au clavier par un bouton transparent.
 */
export function Fisherman() {
  const [flying, setFlying] = useState(false);
  // Change a chaque prise : remonte l'element, l'etoile reapparait neuve.
  const [starId, setStarId] = useState(0);

  function catchStar() {
    if (flying) return;
    setFlying(true);
    window.setTimeout(() => {
      setFlying(false);
      setStarId((value) => value + 1);
    }, 900);
  }

  return (
    <>
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* La silhouette, assise sur la corne basse du croissant. */}
        <g fill="var(--scene-figure)" transform="translate(276 92)">
          <g className="scene-pivot-top" style={{ animation: "scene-legs 4.6s ease-in-out infinite" }}>
            <path d="M3 14 q2 11 -2 18 l4 1 q6 -9 4 -19 Z" />
            <path d="M9 14 q3 10 0 18 l4 1 q5 -10 2 -19 Z" />
          </g>
          <path d="M1 -4 q8 -5 14 0 q3 9 -1 19 q-8 3 -15 0 q-3 -10 2 -19 Z" />
          <circle cx="9" cy="-11" r="6.5" />
          {/* Chapeau : calotte et petit bord. */}
          <path d="M2 -14 q7 -9 15 -1 q-8 -3 -15 1 Z" />
          <rect x="0" y="-15" width="19" height="2" rx="1" />
          {/* Les deux bras tendus vers la canne. */}
          <path d="M12 -1 q-9 5 -17 11 l2 3 q9 -6 17 -10 Z" />
          <path d="M11 3 q-8 5 -15 10 l2 3 q8 -6 15 -10 Z" />
        </g>

        {/* Canne, puis ligne et etoile suspendues en pendule. */}
        <path
          d="M262 106 L238 122"
          stroke="var(--scene-figure)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <g className="scene-pivot-top" style={{ animation: "scene-swing 4s ease-in-out infinite" }}>
          <path d="M238 122 L238 156" stroke="var(--scene-star)" strokeWidth="0.7" opacity="0.55" />
          <g
            key={starId}
            style={flying ? { animation: "scene-catch 900ms ease-in forwards" } : undefined}
          >
            <path
              d="M238 152 l2.4 4.8 5.3 .8 -3.8 3.7 .9 5.3 -4.8 -2.5 -4.8 2.5 .9 -5.3 -3.8 -3.7 5.3 -.8 Z"
              fill="var(--scene-star)"
              style={{ animation: "scene-twinkle 2.6s ease-in-out infinite" }}
            />
          </g>
        </g>
      </svg>

      <button
        type="button"
        onClick={catchStar}
        aria-label="Remonter la ligne et attraper l'étoile"
        className="pointer-events-auto absolute right-[24%] top-[42%] h-11 w-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </>
  );
}

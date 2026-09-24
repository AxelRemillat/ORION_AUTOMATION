"use client";

import { Fisherman } from "./fisherman";
import { NightWater } from "./night-water";

/**
 * Nuit : une silhouette assise sur un croissant de lune, canne a la main.
 *
 * Dessin original : personnage de profil, jambes pendantes, canne tenue a deux
 * mains. Aucun texte, aucun logo, aucune marque.
 *
 * Les etoiles sont tirees par un generateur A GRAINE FIXE, evalue une seule
 * fois au chargement du module : serveur et navigateur produisent exactement
 * la meme liste, donc aucun ecart d'hydratation.
 */

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const random = mulberry32(0x0c1e1e5);
  return Array.from({ length: 34 }, (_, index) => ({
    id: index,
    x: Math.round(random() * 400),
    // Cantonnees au ciel : la mer commence vers 160.
    y: Math.round(random() * 130),
    r: Number((0.5 + random() * 1.3).toFixed(2)),
    delay: Number((random() * 4).toFixed(2)),
    duration: Number((2.4 + random() * 2.6).toFixed(2)),
  }));
})();

export function NightScene() {
  return (
    <>
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sceneNightSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--scene-night-sky-top)" />
            <stop offset="100%" stopColor="var(--scene-night-sky-low)" />
          </linearGradient>
          <radialGradient id="sceneMoonHalo">
            <stop offset="0%" stopColor="var(--scene-moon)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--scene-moon)" stopOpacity="0" />
          </radialGradient>
          {/* Le croissant : un disque auquel on retire un disque decale. */}
          <mask id="sceneCrescent">
            <circle cx="300" cy="72" r="44" fill="#fff" />
            <circle cx="318" cy="60" r="40" fill="#000" />
          </mask>
        </defs>

        <rect width="400" height="200" fill="url(#sceneNightSky)" />

        {STARS.map((star) => (
          <circle
            key={star.id}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="var(--scene-star)"
            style={{
              animation: `scene-twinkle ${star.duration}s ease-in-out infinite`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}

        <g style={{ animation: "scene-shoot 20s linear infinite" }}>
          <path
            d="M360 14 l26 -12"
            stroke="var(--scene-star)"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>

        <g className="scene-moon-group">
          <circle
            cx="300"
            cy="72"
            r="62"
            fill="url(#sceneMoonHalo)"
            style={{ animation: "scene-pulse 7s ease-in-out infinite" }}
          />
          <g mask="url(#sceneCrescent)">
            <circle cx="300" cy="72" r="44" fill="var(--scene-moon)" />
            <circle cx="292" cy="80" r="36" fill="var(--scene-moon-core)" opacity="0.35" />
          </g>
        </g>

        <Fisherman />

        <NightWater />

      </svg>

    </>
  );
}

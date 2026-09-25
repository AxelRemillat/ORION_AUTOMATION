"use client";

import { useRef } from "react";
import { Foreground } from "./foreground";
import { useSceneLoop } from "./use-scene-loop";
import "./scene.css";

/**
 * Scène animée de l'en-tête du Cockpit.
 *
 *   couche 1-2 : un <canvas> WebGL (repli 2D) — ciel, soleil / lune, nuages,
 *                étoiles, mer, brouillard (scene.glsl.ts) ;
 *   couche 3   : les illustrations de premier plan et la ligne de pêche SVG.
 *
 * Moitié droite de la carte (bandeau en haut sur mobile), fondue vers la
 * gauche par un masque long : le texte garde un fond propre.
 */
export function HeroScene() {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { flash } = useSceneLoop(box, canvas);

  return (
    <div
      ref={box}
      aria-hidden
      className="hero-scene pointer-events-none relative h-[110px] w-full overflow-hidden sm:absolute sm:inset-y-0 sm:right-0 sm:h-auto sm:w-1/2"
    >
      <canvas ref={canvas} className="hero-scene__sky absolute inset-0 h-full w-full" />
      <Foreground onSun={flash} />
    </div>
  );
}

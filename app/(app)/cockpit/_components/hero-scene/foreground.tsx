"use client";

import { FishingLine } from "./fishing-line";
import { MARKS } from "./geometry";

/**
 * Premier plan : les illustrations d'Axel (public/scene, 3:1, fond
 * transparent), en WebP avec repli PNG. Calé à droite, toute la hauteur : le
 * même rectangle que celui qu'utilise le shader (geometry.ts).
 *
 * Couche 3 de la parallaxe : elle suit la souris plus fort que le ciel et la
 * mer (variables --mx / --my posées par la boucle).
 */
function SceneImage({ name, className, alt = "" }: { name: string; className?: string; alt?: string }) {
  return (
    <picture>
      <source srcSet={`/scene/${name}.webp`} type="image/webp" />
      {/* eslint-disable-next-line @next/next/no-img-element -- image décorative déjà optimisée */}
      <img
        src={`/scene/${name}.png`}
        alt={alt}
        width={1600}
        height={533}
        draggable={false}
        decoding="async"
        className={`absolute inset-0 h-full w-full select-none ${className ?? ""}`}
      />
    </picture>
  );
}

export function Foreground({ onSun }: { onSun: () => void }) {
  return (
    <div className="hero-fg absolute inset-y-0 right-0 aspect-[3/1] h-full">
      <div className="hero-fg__day absolute inset-0">
        {/* Palmier : la moitié haute se balance autour du pied du tronc, la
            plage reste immobile. Les deux découpes se raccordent au pied. */}
        <SceneImage name="day-foreground" className="hero-fg__sand" />
        <SceneImage name="day-foreground" className="hero-fg__palm" />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={onSun}
          className="pointer-events-auto absolute aspect-square h-[34%] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full"
          style={{ left: `${MARKS.sun.x * 100}%`, top: `${MARKS.sun.y * 100}%` }}
        />
      </div>

      <div className="hero-fg__night absolute inset-0">
        <div className="hero-fg__moon absolute inset-0">
          <SceneImage name="night-moon" />
          <FishingLine />
        </div>
      </div>
    </div>
  );
}

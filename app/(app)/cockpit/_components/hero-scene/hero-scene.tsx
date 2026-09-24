"use client";

import { useEffect, useRef, useState } from "react";
import { DayScene } from "./day-scene";
import { NightScene } from "./night-scene";
import "./scene.css";
import "./scene-animations.css";

/**
 * Scene decorative de l'en-tete du Cockpit.
 *
 * Les DEUX scenes sont montees en permanence et se croisent en opacite, piloté
 * par les memes selecteurs de theme que les tokens (`scene.css`). Aucun
 * JavaScript ne lit le theme : c'est ce qui evite tout ecart d'hydratation, et
 * ce qui rend le fondu de 600 ms possible dans les deux sens.
 *
 * Le degrade de masque efface le bord gauche : le texte de l'en-tete garde un
 * fond propre, sans cadre ni couture visible.
 */
export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // Rien ne doit tourner hors de l'ecran ni dans un onglet en arriere-plan.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let onScreen = true;
    const sync = () => setPaused(!onScreen || document.hidden);

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", sync);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-paused={paused ? "true" : "false"}
      // Decoratif : seuls les deux boutons d'easter egg reprennent le pointeur.
      className="hero-scene pointer-events-none relative h-[110px] w-full overflow-hidden sm:absolute sm:inset-y-0 sm:right-0 sm:h-auto sm:w-1/2"
    >
      <div className="hero-scene__layer hero-scene__day">
        <DayScene />
      </div>
      <div className="hero-scene__layer hero-scene__night">
        <NightScene />
      </div>
    </div>
  );
}

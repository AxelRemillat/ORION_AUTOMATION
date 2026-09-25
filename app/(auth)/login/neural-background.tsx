"use client";

import { useEffect, useRef } from "react";
import { NeuralField, type Palette } from "./neural-field";
import { toRgbTriplet } from "@/lib/canvas-color";

/**
 * Fond anime du formulaire de connexion : un reseau de noeuds relies, image du
 * maillage prospects · entreprises · moi. Present UNIQUEMENT sur /login.
 *
 * Le canvas est `pointer-events: none` — il ne doit jamais intercepter un clic
 * destine au formulaire. Les interactions passent donc par des ecouteurs pose
 * sur `window`, dont les coordonnees client correspondent 1:1 au canvas puisque
 * celui-ci est en `fixed inset-0`.
 */

/** Plafonne le DPR : au-dela de 2, le cout de remplissage n'apporte rien. */
const MAX_DPR = 2;
/** Borne le pas de temps : un onglet reactive ne doit pas « teleporter » le reseau. */
const MAX_STEP = 0.05;

type Triplet = [number, number, number];

/**
 * Lit un token `--rgb-*` du theme courant.
 *
 * L'analyse est deleguee a `toRgbTriplet` : c'est le meme code qui sert au
 * radar et aux etincelles, donc un token ecrit autrement (hex, virgules) ne
 * peut plus casser un seul des trois.
 */
function readTriplet(styles: CSSStyleDeclaration, name: string, fallback: Triplet): Triplet {
  return toRgbTriplet(styles.getPropertyValue(name)) ?? fallback;
}

/**
 * Construit la palette depuis les tokens de theme.
 *
 * Ce sont les SEULES valeurs a retoucher pour rendre le reseau plus ou moins
 * present. La carte de connexion etant opaque, elle n'est jamais traversee :
 * la limite haute est fixee par le confort de lecture du texte qui l'entoure,
 * pas par le formulaire lui-meme.
 */
function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const primary = readTriplet(styles, "--rgb-primary", [43, 159, 214]);
  const cyan = readTriplet(styles, "--rgb-cyan", [52, 198, 222]);
  const [r, g, b] = readTriplet(styles, "--rgb-bg", [233, 243, 250]);
  const isDark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;

  return {
    link: primary,
    node: primary,
    hub: cyan,
    alpha: isDark
      ? { link: 0.55, node: 0.92, hub: 1, pulse: 1 }
      : { link: 0.6, node: 0.88, hub: 0.95, pulse: 0.95 },
  };
}

export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let field: NeuralField | null = null;
    let frame = 0;
    let last = 0;

    /** Redimensionne en tenant compte du DPR, puis redessine. */
    function fit() {
      if (!canvas || !ctx) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (field) field.resize(width, height);
      else field = new NeuralField(width, height, readPalette());
    }

    /** Rendu figé : une seule image, aucune boucle, aucune interaction. */
    function drawStatic() {
      if (!field || !ctx) return;
      field.setPointer(null);
      field.draw(ctx);
    }

    function loop(now: number) {
      if (!field || !ctx) return;
      const dt = last ? Math.min(MAX_STEP, (now - last) / 1000) : 1 / 60;
      last = now;
      field.step(dt);
      field.draw(ctx);
      frame = window.requestAnimationFrame(loop);
    }

    function start() {
      if (frame || reduceMotion.matches) return;
      last = 0;
      frame = window.requestAnimationFrame(loop);
    }

    function stop() {
      if (!frame) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    }

    // --- Interactions (jamais posees en mouvement reduit) -------------------
    const onPointerMove = (event: PointerEvent) => {
      field?.setPointer({ x: event.clientX, y: event.clientY });
    };
    const onPointerLeave = () => field?.setPointer(null);
    const onPointerDown = (event: PointerEvent) => {
      field?.emitWave(event.clientX, event.clientY);
    };

    // L'onglet cache ne doit rien consommer.
    const onVisibility = () => (document.hidden ? stop() : start());

    const onResize = () => {
      fit();
      if (reduceMotion.matches) drawStatic();
    };

    /** Le theme change : on relit les tokens (et on redessine si fige). */
    const onThemeChange = () => {
      field?.setPalette(readPalette());
      if (reduceMotion.matches) drawStatic();
    };

    function applyMotionPreference() {
      stop();
      if (reduceMotion.matches) {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointerleave", onPointerLeave);
        window.removeEventListener("blur", onPointerLeave);
        drawStatic();
        return;
      }
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      // Changement d'application : sans cela les noeuds resteraient aimantes
      // a la derniere position connue du curseur.
      window.addEventListener("blur", onPointerLeave);
      start();
    }

    fit();
    applyMotionPreference();

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", applyMotionPreference);

    // Le selecteur de theme pose `data-theme` et une classe sur <html>.
    const themeObserver = new MutationObserver(onThemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    colorScheme.addEventListener("change", onThemeChange);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", applyMotionPreference);
      colorScheme.removeEventListener("change", onThemeChange);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}

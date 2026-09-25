"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createCanvas2DRenderer } from "./canvas2d-renderer";
import { foregroundRect, MARKS, markToUv } from "./geometry";
import { isNightTheme, watchTheme } from "./theme";
import { createWebGLRenderer, type SceneRenderer } from "./webgl-renderer";

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const THEME_FADE_MS = 800;

/**
 * Boucle de rendu de la scène. Tout démarre dans un effet : rien ne s'exécute
 * au rendu serveur, donc aucun écart d'hydratation possible.
 *
 * 30 images/s au plus, DPR plafonné à 1,5, pause hors écran et onglet caché.
 * En mouvement réduit : une seule image, redessinée au redimensionnement et
 * au changement de thème. Renvoie `flash()`, l'easter egg du soleil.
 */
export function useSceneLoop(
  container: RefObject<HTMLDivElement>,
  canvas: RefObject<HTMLCanvasElement>,
): { flash: () => void } {
  const flashAt = useRef(-Infinity);

  useEffect(() => {
    const box = container.current;
    const surface = canvas.current;
    if (!box || !surface) return;
    const webgl = createWebGLRenderer(surface);
    const renderer: SceneRenderer | null = webgl ?? createCanvas2DRenderer(surface);
    if (!renderer) return;
    box.dataset.renderer = webgl ? "webgl" : "2d";

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    let night = isNightTheme() ? 1 : 0;
    let fade = { from: night, to: night, at: 0 };
    let mouse: [number, number] = [0, 0];
    let target: [number, number] = [0, 0];
    let rect = { left: 0, width: 1 };
    let raf = 0;
    let last = 0;
    let visible = true;
    let frames = 0;
    let fpsAt = start;

    const draw = (now: number) => {
      const k = Math.min(1, (now - fade.at) / THEME_FADE_MS);
      night = fade.from + (fade.to - fade.from) * (k * k * (3 - 2 * k));
      mouse = [mouse[0] + (target[0] - mouse[0]) * 0.06, mouse[1] + (target[1] - mouse[1]) * 0.06];
      box.style.setProperty("--mx", mouse[0].toFixed(3));
      box.style.setProperty("--my", mouse[1].toFixed(3));
      renderer.render({
        time: reduced.matches ? 12 : (now - start) / 1000,
        night,
        flash: Math.max(0, 1 - (now - flashAt.current) / 1200),
        mouse,
        // Le soleil se couche et la lune se lève pendant le fondu de thème.
        sun: markToUv(MARKS.sun, rect, night * 0.55),
        moon: markToUv(MARKS.moon, rect, (1 - night) * 0.3),
      });
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
      frames += 1;
      if (now - fpsAt >= 1000) {
        box.dataset.fps = String(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      // Les animations CSS du premier plan suivent la même pause.
      box.dataset.paused = String(!visible || document.hidden);
      if (reduced.matches) {
        // Image fixe : on attend la fin d'un éventuel fondu de thème.
        fade.at = -Infinity;
        draw(performance.now());
      } else if (visible && !document.hidden) {
        raf = requestAnimationFrame(tick);
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const { width, height } = box.getBoundingClientRect();
      rect = foregroundRect(width, height);
      renderer.resize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
      draw(performance.now());
    };

    const onPointer = (event: PointerEvent) => {
      const bounds = box.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
      target = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
    };

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(box);
    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    viewObserver.observe(box);
    const unwatch = watchTheme((isNight) => {
      fade = { from: night, to: isNight ? 1 : 0, at: performance.now() };
      sync();
    });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    window.addEventListener("pointermove", onPointer, { passive: true });
    resize();
    sync();

    return () => {
      cancelAnimationFrame(raf);
      sizeObserver.disconnect();
      viewObserver.disconnect();
      unwatch();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      window.removeEventListener("pointermove", onPointer);
      renderer.dispose();
    };
  }, [container, canvas]);

  return { flash: () => (flashAt.current = performance.now()) };
}

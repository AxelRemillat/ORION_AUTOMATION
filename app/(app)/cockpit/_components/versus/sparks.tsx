"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { SparkField } from "./spark-field";

/**
 * Braises et etincelles de la scene VERSUS.
 *
 * Ce composant ne porte que le cycle de vie ; les particules vivent dans
 * `SparkField`. Trois garde-fous : rien n'est peint en
 * `prefers-reduced-motion`, la boucle s'arrete quand l'onglet est cache ET
 * quand la carte sort de l'ecran, et le DPR est plafonne a 2.
 */

export interface SparksHandle {
  /** Gerbe d'etincelles, en coordonnees relatives (0 → 1). */
  burst: (x: number, y: number) => void;
}

export const Sparks = forwardRef<SparksHandle, { intensity: number }>(function Sparks(
  { intensity },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const field = useRef<SparkField | null>(null);
  // Lu dans la boucle sans la relancer : une seule boucle sur la vie du bloc.
  const level = useRef(intensity);
  level.current = intensity;

  useImperativeHandle(ref, () => ({
    burst(x, y) {
      const canvas = canvasRef.current;
      if (!canvas || !field.current) return;
      field.current.burst(
        canvas.clientWidth,
        canvas.clientHeight,
        x * canvas.clientWidth,
        y * canvas.clientHeight,
      );
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const read = (name: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    field.current = new SparkField(read("--vs-blue", "#4cd4e6"), read("--vs-red", "#ff2a2a"));

    let frame = 0;
    let last = 0;
    let visible = !document.hidden;
    let onScreen = true;

    function fit() {
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function loop(now: number) {
      if (!canvas || !ctx || !field.current) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      field.current.step(ctx, dt, canvas.clientWidth, canvas.clientHeight, level.current);
      frame = window.requestAnimationFrame(loop);
    }

    function play() {
      if (frame || !visible || !onScreen) return;
      last = 0;
      frame = window.requestAnimationFrame(loop);
    }
    function stop() {
      if (!frame) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    }

    fit();
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) play();
      else stop();
    });
    observer.observe(canvas);

    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) play();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", fit);
    play();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
});

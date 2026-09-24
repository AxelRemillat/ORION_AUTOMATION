"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Flammes du bloc « Actions du jour ».
 *
 * Un seul canvas, un seul `requestAnimationFrame` pour toute la section : les
 * étincelles de validation sont injectées dans le MÊME système de particules
 * plutôt que de lancer une deuxième boucle.
 *
 * Trois garde-fous :
 *   - `prefers-reduced-motion` : rien n'est peint, le bloc garde son dégradé ;
 *   - onglet caché : la boucle est arrêtée, pas juste ralentie ;
 *   - l'intensité pilote le débit, pas le nombre de boucles.
 */

export interface FlamesHandle {
  /** Petite explosion d'étincelles, en coordonnées relatives (0 → 1). */
  burst: (x: number, y: number) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** Teinte : 20-45 pour la flamme, ~320 pour les étincelles magenta. */
  hue: number;
}

const MAX_PARTICLES = 320;

export const Flames = forwardRef<FlamesHandle, { intensity: number; hover: boolean }>(
  function Flames({ intensity, hover }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particles = useRef<Particle[]>([]);
    // Lus dans la boucle sans la relancer : une seule boucle sur la vie du bloc.
    const settings = useRef({ intensity, hover });
    settings.current = { intensity, hover };

    useImperativeHandle(ref, () => ({
      burst(x, y) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        for (let index = 0; index < 28; index += 1) {
          const angle = (Math.PI * 2 * index) / 28 + Math.random();
          const speed = 40 + Math.random() * 90;
          particles.current.push({
            x: x * width,
            y: y * height,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40,
            life: 0,
            maxLife: 0.5 + Math.random() * 0.4,
            size: 1.5 + Math.random() * 2.5,
            hue: Math.random() < 0.3 ? 320 : 25 + Math.random() * 25,
          });
        }
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (reduced.matches) return;

      const context = canvas.getContext("2d");
      if (!context) return;

      let frame = 0;
      let last = performance.now();
      let running = true;

      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = canvas.clientWidth * ratio;
        canvas.height = canvas.clientHeight * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);

      const step = (time: number) => {
        if (!running) return;
        const delta = Math.min((time - last) / 1000, 0.05);
        last = time;

        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const { intensity: heat, hover: boosted } = settings.current;

        // Émission depuis le bas du bloc, proportionnelle à l'urgence.
        const rate = heat * (boosted ? 26 : 16);
        for (let index = 0; index < rate; index += 1) {
          if (particles.current.length >= MAX_PARTICLES) break;
          particles.current.push({
            x: Math.random() * width,
            y: height + 6,
            vx: (Math.random() - 0.5) * 22,
            vy: -(45 + Math.random() * 85) * (0.6 + heat * 0.7),
            life: 0,
            maxLife: 0.7 + Math.random() * 0.8,
            size: 5 + Math.random() * 13 * (0.5 + heat),
            hue: 18 + Math.random() * 28,
          });
        }

        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = "lighter";

        particles.current = particles.current.filter((particle) => {
          particle.life += delta;
          if (particle.life >= particle.maxLife) return false;

          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          particle.vy += 26 * delta; // les braises retombent un peu
          particle.vx *= 0.99;

          const progress = particle.life / particle.maxLife;
          const alpha = (1 - progress) * 0.5;
          const radius = particle.size * (1 - progress * 0.55);

          const gradient = context.createRadialGradient(
            particle.x,
            particle.y,
            0,
            particle.x,
            particle.y,
            Math.max(radius, 0.5),
          );
          gradient.addColorStop(0, `hsla(${particle.hue + 18}, 100%, 66%, ${alpha})`);
          gradient.addColorStop(1, `hsla(${particle.hue}, 100%, 48%, 0)`);
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(particle.x, particle.y, Math.max(radius, 0.5), 0, Math.PI * 2);
          context.fill();
          return true;
        });

        context.globalCompositeOperation = "source-over";
        frame = requestAnimationFrame(step);
      };

      const start = () => {
        if (running) return;
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(step);
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(frame);
      };

      // Onglet caché : on arrête vraiment, on ne peint pas dans le vide.
      const onVisibility = () => (document.hidden ? stop() : start());
      document.addEventListener("visibilitychange", onVisibility);
      frame = requestAnimationFrame(step);

      return () => {
        stop();
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        particles.current = [];
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full motion-reduce:hidden"
      />
    );
  },
);

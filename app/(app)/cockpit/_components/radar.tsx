"use client";

import { useEffect, useRef } from "react";

/**
 * Fond radar du bloc « Signaux les plus forts ».
 *
 * Registre volontairement distinct des deux autres blocs : ni le rouge des
 * actions urgentes, ni l'ambre de la boîte mail — ici c'est du violet/cyan
 * électrique, le langage de la détection.
 *
 * Trois garde-fous, comme les flammes :
 *   - `prefers-reduced-motion` : une seule image fixe, aucune boucle ;
 *   - onglet caché : la boucle est arrêtée, pas ralentie ;
 *   - un seul `requestAnimationFrame` pour tout le bloc, quel que soit le
 *     nombre de signaux.
 */

interface Blip {
  /** Position relative dans le canvas (0 → 1). */
  x: number;
  y: number;
  /** 0 → 1 : pilote la taille et la fréquence des ondes. */
  strength: number;
  /** Décalage de phase, pour que les pings ne battent pas à l'unisson. */
  phase: number;
}

const SWEEP_PERIOD = 4.2;
const PING_PERIOD = 2.6;

function readRgb(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

export function Radar({ strengths }: { strengths: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Lues dans la boucle sans la relancer.
  const blips = useRef<Blip[]>([]);
  blips.current = strengths.map((strength, index) => ({
    x: 0.12 + ((index * 0.37) % 0.76),
    y: (index + 0.5) / Math.max(strengths.length, 1),
    strength: Math.max(0.15, Math.min(1, strength)),
    phase: (index * 0.61) % 1,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let start = 0;
    let violet = "167 139 250";
    let cyan = "76 212 230";

    function fit() {
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function readTokens() {
      violet = readRgb("--rgb-violet", violet);
      cyan = readRgb("--rgb-cyan", cyan);
    }

    /** Une image. `t` en secondes ; `t = 0` donne la version figée. */
    function draw(t: number) {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // Balayage : un secteur lumineux qui tourne depuis le bord gauche.
      const cx = -h * 0.15;
      const cy = h / 2;
      const radius = Math.hypot(w - cx, h / 2) * 1.05;
      const angle = (t / SWEEP_PERIOD) * Math.PI * 2;

      const sweep = ctx.createConicGradient?.(angle, cx, cy);
      if (sweep) {
        sweep.addColorStop(0, `rgba(${cyan}, 0.20)`);
        sweep.addColorStop(0.06, `rgba(${violet}, 0.06)`);
        sweep.addColorStop(0.2, `rgba(${violet}, 0)`);
        sweep.addColorStop(1, `rgba(${violet}, 0)`);
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cercles de portée.
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring += 1) {
        ctx.strokeStyle = `rgba(${violet}, 0.12)`;
        ctx.beginPath();
        ctx.arc(cx, cy, (radius / 4.4) * ring, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Pings : des ondes concentriques partent de chaque signal.
      for (const blip of blips.current) {
        const bx = blip.x * w;
        const by = blip.y * h;
        const cycle = ((t / PING_PERIOD + blip.phase) % 1 + 1) % 1;
        const maxR = 26 + blip.strength * 54;

        for (const offset of [0, 0.5]) {
          const progress = (cycle + offset) % 1;
          const alpha = (1 - progress) * 0.5 * blip.strength;
          if (alpha <= 0.01) continue;
          ctx.strokeStyle = `rgba(${cyan}, ${alpha})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(bx, by, progress * maxR, 0, Math.PI * 2);
          ctx.stroke();
        }

        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 9 + blip.strength * 7);
        glow.addColorStop(0, `rgba(${cyan}, ${0.5 * blip.strength})`);
        glow.addColorStop(1, `rgba(${cyan}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(bx, by, 9 + blip.strength * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(now: number) {
      if (!start) start = now;
      draw((now - start) / 1000);
      frame = window.requestAnimationFrame(loop);
    }

    function stop() {
      if (!frame) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    }

    function play() {
      if (frame || reduceMotion.matches || document.hidden) return;
      start = 0;
      frame = window.requestAnimationFrame(loop);
    }

    function apply() {
      stop();
      fit();
      readTokens();
      // Mouvement réduit : une seule image, balayage figé.
      if (reduceMotion.matches) draw(0);
      else play();
    }

    const onVisibility = () => (document.hidden ? stop() : play());

    apply();
    window.addEventListener("resize", apply);
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", apply);
    const themeObserver = new MutationObserver(() => {
      readTokens();
      if (reduceMotion.matches) draw(0);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      stop();
      window.removeEventListener("resize", apply);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", apply);
      themeObserver.disconnect();
    };
  }, [strengths.length]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

/**
 * Barres de réception type antenne : cinq barres dont le remplissage suit le
 * score. Statique et sans JS — l'intensité est une donnée, pas une animation.
 */
export function SignalBars({ score }: { score: number }) {
  const lit = Math.max(1, Math.round((score / 100) * 5));
  return (
    <span
      className="inline-flex items-end gap-0.5"
      role="img"
      aria-label={`Réception ${lit} sur 5`}
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className="w-1 rounded-sm"
          style={{
            height: `${5 + index * 3}px`,
            background: index < lit ? "var(--cyan)" : "var(--line)",
            opacity: index < lit ? 1 : 0.6,
          }}
        />
      ))}
    </span>
  );
}

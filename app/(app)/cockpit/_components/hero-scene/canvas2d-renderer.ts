import type { SceneFrame, SceneRenderer } from "./webgl-renderer";

/**
 * Repli sans WebGL : mêmes plans, en dégradés 2D. Moins riche (pas de nuages
 * ni de brouillard fbm), mais jamais vide ni cassé.
 */

const HORIZON = 0.3;

const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round((v + (b[i] - v) * t) * 255)).join(",")})`;

/** Étoiles figées : même tirage à chaque image, pas de scintillement aléatoire. */
const STARS = Array.from({ length: 90 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1), y: HORIZON + 0.08 + r(2) * (0.9 - HORIZON), s: 0.4 + r(3) * 1.1, p: r(4) * 6 };
});

export function createCanvas2DRenderer(canvas: HTMLCanvasElement): SceneRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let w = 1;
  let h = 1;

  return {
    resize(width, height) {
      canvas.width = w = width;
      canvas.height = h = height;
    },
    render({ time, night, flash, sun, moon }: SceneFrame) {
      const horizon = h * (1 - HORIZON);
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, mix([0.12, 0.4, 0.78], [0.03, 0.04, 0.14], night));
      sky.addColorStop(0.65, mix([0.42, 0.8, 0.86], [0.08, 0.1, 0.26], night));
      sky.addColorStop(1, mix([1, 0.8, 0.52], [0.11, 0.16, 0.34], night));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);

      const sea = ctx.createLinearGradient(0, horizon, 0, h);
      sea.addColorStop(0, mix([0.55, 0.83, 0.86], [0.08, 0.12, 0.26], night));
      sea.addColorStop(1, mix([0.04, 0.33, 0.55], [0.02, 0.03, 0.1], night));
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizon, w, h - horizon);

      const glow = (x: number, y: number, radius: number, color: string, alpha: number) => {
        const g = ctx.createRadialGradient(x * w, (1 - y) * h, 0, x * w, (1 - y) * h, radius);
        g.addColorStop(0, color.replace("A", String(alpha)));
        g.addColorStop(1, color.replace("A", "0"));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, horizon);
      };
      if (night < 1) glow(sun[0], sun[1], h * 0.5, "rgba(255,226,160,A)", (1 - night) * (0.9 + flash));
      if (night > 0) {
        glow(moon[0], moon[1], h * 0.6, "rgba(242,214,150,A)", night * 0.35);
        for (const star of STARS) {
          ctx.globalAlpha = night * (0.55 + 0.45 * Math.sin(time * 1.5 + star.p));
          ctx.fillStyle = "rgb(235,240,255)";
          ctx.fillRect(star.x * w, (1 - star.y) * h, star.s, star.s);
        }
        ctx.globalAlpha = 1;
      }

      // Houle : des tirets de reflet, plus courts vers l'horizon, qui glissent.
      ctx.strokeStyle = night > 0.5 ? "rgba(242,214,150,0.22)" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const depth = (i + 1) / 8;
        const y = horizon + depth * (h - horizon);
        const dash = w * (0.02 + depth * 0.05);
        ctx.beginPath();
        for (let j = 0; j < 5; j++) {
          const x = (((j * 0.23 + i * 0.37 + time * 0.01 * (1 + depth)) % 1) * 0.8 + 0.15) * w;
          ctx.moveTo(x, y);
          ctx.lineTo(x + dash, y);
        }
        ctx.stroke();
      }
    },
    dispose() {},
  };
}

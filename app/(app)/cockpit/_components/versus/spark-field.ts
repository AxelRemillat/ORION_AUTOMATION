/**
 * Systeme de particules de la scene VERSUS — TS pur, sans React ni DOM hors du
 * contexte 2D qu'on lui passe. Le composant ne porte plus que le cycle de vie.
 *
 * Deux familles : des BRAISES lentes qui montent en derivant, et quelques
 * ETINCELLES rapides avec une trainee. Rien ne forme de nappe : la densite est
 * plafonnee et les particules meurent en chemin.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** Longueur de trainee : 0 pour une braise, > 0 pour une etincelle. */
  trail: number;
  color: string;
}

const MAX_PARTICLES = 60;
const SPAWN_PER_SECOND = 14;

export class SparkField {
  private particles: Particle[] = [];
  private debt = 0;
  private blue: string;
  private red: string;

  constructor(blue: string, red: string) {
    this.blue = blue;
    this.red = red;
  }

  /** Une braise, ou une etincelle rapide une fois sur cinq environ. */
  private spawn(w: number, h: number, x?: number, y?: number) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const px = x ?? Math.random() * w;
    const fast = Math.random() < 0.22;
    this.particles.push({
      x: px,
      y: y ?? h * (0.55 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * (fast ? 90 : 22),
      vy: -(fast ? 110 + Math.random() * 90 : 18 + Math.random() * 26),
      life: 0,
      maxLife: fast ? 0.5 + Math.random() * 0.4 : 1.4 + Math.random() * 1.2,
      size: fast ? 1.1 : 0.8 + Math.random() * 1.2,
      trail: fast ? 6 + Math.random() * 10 : 0,
      // La ligne de front est au centre : chaque camp garde sa couleur.
      color: px < w / 2 ? this.blue : this.red,
    });
  }

  /** Gerbe ponctuelle, en pixels. */
  burst(w: number, h: number, x: number, y: number) {
    for (let index = 0; index < 14; index += 1) this.spawn(w, h, x, y);
  }

  step(ctx: CanvasRenderingContext2D, dt: number, w: number, h: number, intensity: number) {
    this.debt += SPAWN_PER_SECOND * (0.35 + intensity) * dt;
    while (this.debt >= 1) {
      this.spawn(w, h);
      this.debt -= 1;
    }

    ctx.clearRect(0, 0, w, h);
    // Les particules s'additionnent au lieu de se masquer : c'est ce qui donne
    // leur coeur blanc aux etincelles.
    ctx.globalCompositeOperation = "lighter";

    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.maxLife) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 6 * dt;

      ctx.globalAlpha = (1 - p.life / p.maxLife) * 0.9;
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;

      if (p.trail > 0) {
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.012, p.y - p.vy * 0.012 + p.trail * 0.1);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/**
 * Moteur du reseau neuronal affiche derriere le formulaire de connexion.
 *
 * TS pur : aucune dependance a React ni au DOM en dehors du contexte 2D qu'on
 * lui passe. Cela le rend testable et permet au composant de se limiter au
 * cycle de vie (rAF, listeners, lecture des tokens de theme).
 *
 * Modele de mouvement : chaque noeud garde une derive de fond CONSTANTE (il ne
 * s'arrete jamais) et, par-dessus, un decalage rappele par un ressort amorti.
 * Curseur et ondes n'agissent que sur ce decalage : le reseau revient donc
 * toujours a sa forme d'origine et ne peut pas s'agglutiner sous le pointeur.
 */

export interface Palette {
  /** Triplets RVB lus sur les tokens de theme. */
  link: [number, number, number];
  node: [number, number, number];
  hub: [number, number, number];
  /** Opacites de base, ajustees selon le theme clair/sombre. */
  alpha: { link: number; node: number; hub: number };
}

interface Node {
  /** Position de derive. */
  x: number;
  y: number;
  /** Derive de fond, en px/s — jamais amortie. */
  vx: number;
  vy: number;
  /** Decalage courant et sa vitesse (ressort amorti vers 0). */
  ox: number;
  oy: number;
  ovx: number;
  ovy: number;
  radius: number;
  hub: boolean;
}

interface Pulse {
  from: number;
  to: number;
  /** Avancement 0 → 1 le long du lien. */
  t: number;
  speed: number;
}

interface Wave {
  x: number;
  y: number;
  radius: number;
}

// --- Reglages ---------------------------------------------------------------
/** Plafond dur : au-dela, le cout O(n²) des liens devient inutilement visible. */
const MAX_NODES = 50;
/** Un noeud pour ~24 000 px² : un petit ecran n'est jamais surcharge. */
const AREA_PER_NODE = 24_000;
const LINK_DISTANCE = 132;
const POINTER_RADIUS = 190;
const MAX_OFFSET = 34;
const SPRING = 6;
const SPRING_DAMPING = 3.2;
const MAX_PULSES = 6;
const PULSE_INTERVAL = 0.75;
const MAX_WAVES = 3;
const WAVE_SPEED = 420;
const WAVE_MAX_RADIUS = 340;
/** Au-dela, l'onde ne pousse plus : elle ne fait que s'afficher. */
const WAVE_BAND = 26;

/** Graine fixe : le reseau a toujours la meme allure, y compris en statique. */
const SEED = 0x0715eed;

/** PRNG deterministe : la meme graine donne toujours le meme reseau. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = ([r, g, b]: [number, number, number], alpha: number) =>
  `rgba(${r}, ${g}, ${b}, ${alpha})`;

export class NeuralField {
  private nodes: Node[] = [];
  private pulses: Pulse[] = [];
  private waves: Wave[] = [];
  private pointer: { x: number; y: number } | null = null;
  private sincePulse = 0;
  private random = mulberry32(SEED);
  private width: number;
  private height: number;
  private palette: Palette;

  constructor(width: number, height: number, palette: Palette) {
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.populate();
  }

  // --- Cycle de vie ---------------------------------------------------------

  private populate() {
    const target = Math.max(
      14,
      Math.min(MAX_NODES, Math.floor((this.width * this.height) / AREA_PER_NODE)),
    );
    this.random = mulberry32(SEED);
    this.nodes = Array.from({ length: target }, (_, index) => {
      const hub = index % 7 === 3;
      const angle = this.random() * Math.PI * 2;
      const speed = 6 + this.random() * 11;
      return {
        x: this.random() * this.width,
        y: this.random() * this.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ox: 0,
        oy: 0,
        ovx: 0,
        ovy: 0,
        radius: hub ? 2.6 + this.random() * 0.9 : 1.1 + this.random() * 0.8,
        hub,
      };
    });
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.populate();
    this.pulses = [];
    this.waves = [];
  }

  setPalette(palette: Palette) {
    this.palette = palette;
  }

  setPointer(point: { x: number; y: number } | null) {
    this.pointer = point;
  }

  /** Declenche une onde. Ignoree si trop d'ondes sont deja en cours. */
  emitWave(x: number, y: number) {
    if (this.waves.length >= MAX_WAVES) return;
    this.waves.push({ x, y, radius: 0 });
  }

  // --- Simulation -----------------------------------------------------------

  step(dt: number) {
    this.moveNodes(dt);
    this.advancePulses(dt);
    this.advanceWaves(dt);
  }

  private moveNodes(dt: number) {
    for (const node of this.nodes) {
      // Derive de fond : rebond sur les bords pour garder la densite stable.
      node.x += node.vx * dt;
      node.y += node.vy * dt;
      if (node.x < 0 || node.x > this.width) {
        node.vx *= -1;
        node.x = Math.max(0, Math.min(this.width, node.x));
      }
      if (node.y < 0 || node.y > this.height) {
        node.vy *= -1;
        node.y = Math.max(0, Math.min(this.height, node.y));
      }

      let ax = 0;
      let ay = 0;

      if (this.pointer) {
        const dx = this.pointer.x - (node.x + node.ox);
        const dy = this.pointer.y - (node.y + node.oy);
        const distance = Math.hypot(dx, dy);
        // L'attraction s'annule de tres pres : les noeuds effleurent le curseur
        // sans venir s'y coller.
        if (distance > 1 && distance < POINTER_RADIUS) {
          const falloff =
            (1 - distance / POINTER_RADIUS) * Math.min(1, Math.max(0, (distance - 26) / 70));
          ax += (dx / distance) * falloff * 150;
          ay += (dy / distance) * falloff * 150;
        }
      }

      for (const wave of this.waves) {
        const dx = node.x + node.ox - wave.x;
        const dy = node.y + node.oy - wave.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 1 && Math.abs(distance - wave.radius) < WAVE_BAND) {
          const fade = 1 - wave.radius / WAVE_MAX_RADIUS;
          ax += (dx / distance) * fade * 260;
          ay += (dy / distance) * fade * 260;
        }
      }

      // Ressort amorti : le decalage revient toujours a zero.
      ax += -SPRING * node.ox - SPRING_DAMPING * node.ovx;
      ay += -SPRING * node.oy - SPRING_DAMPING * node.ovy;

      node.ovx += ax * dt;
      node.ovy += ay * dt;
      node.ox += node.ovx * dt;
      node.oy += node.ovy * dt;

      const offset = Math.hypot(node.ox, node.oy);
      if (offset > MAX_OFFSET) {
        node.ox = (node.ox / offset) * MAX_OFFSET;
        node.oy = (node.oy / offset) * MAX_OFFSET;
      }
    }
  }

  private advancePulses(dt: number) {
    this.sincePulse += dt;
    if (this.sincePulse >= PULSE_INTERVAL && this.pulses.length < MAX_PULSES) {
      // Le minuteur n'est consomme que si une impulsion est reellement partie :
      // sinon un reseau momentanement clairseme resterait muet.
      if (this.spawnPulse()) this.sincePulse = 0;
    }

    this.pulses = this.pulses.filter((pulse) => {
      pulse.t += pulse.speed * dt;
      // Le lien a pu disparaitre entre-temps : on coupe l'impulsion avec lui.
      return pulse.t < 1 && this.distanceBetween(pulse.from, pulse.to) < LINK_DISTANCE;
    });
  }

  /**
   * Amorce une impulsion sur un lien EXISTANT.
   *
   * Tirer deux noeuds au hasard echouait ~6 fois sur 10 (moins de 4 % des
   * paires sont reliees) et le reseau restait muet la plupart du temps. On
   * enumere donc les liens reels — 1 225 comparaisons trois fois par seconde,
   * negligeable — et on privilegie ceux qui partent d'un hub.
   */
  private spawnPulse(): boolean {
    // Cle normalisee : une impulsion peut circuler dans un sens ou dans l'autre.
    const linkKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const busy = new Set(this.pulses.map((pulse) => linkKey(pulse.from, pulse.to)));
    const candidates: { from: number; to: number; weight: number }[] = [];

    for (let i = 0; i < this.nodes.length; i += 1) {
      for (let j = i + 1; j < this.nodes.length; j += 1) {
        if (busy.has(linkKey(i, j))) continue;
        if (this.distanceBetween(i, j) >= LINK_DISTANCE) continue;
        candidates.push({
          from: i,
          to: j,
          weight: this.nodes[i].hub || this.nodes[j].hub ? 3 : 1,
        });
      }
    }
    if (!candidates.length) return false;

    let ticket = this.random() * candidates.reduce((sum, c) => sum + c.weight, 0);
    const picked = candidates.find((c) => (ticket -= c.weight) <= 0) ?? candidates[0];

    // Un lien partant d'un hub s'anime depuis le hub : la lecture est plus nette.
    const fromHub = this.nodes[picked.to].hub && !this.nodes[picked.from].hub;
    this.pulses.push({
      from: fromHub ? picked.to : picked.from,
      to: fromHub ? picked.from : picked.to,
      t: 0,
      speed: 0.4 + this.random() * 0.5,
    });
    return true;
  }

  private advanceWaves(dt: number) {
    this.waves = this.waves.filter((wave) => {
      wave.radius += WAVE_SPEED * dt;
      return wave.radius < WAVE_MAX_RADIUS;
    });
  }

  private distanceBetween(a: number, b: number) {
    const first = this.nodes[a];
    const second = this.nodes[b];
    if (!first || !second) return Infinity;
    return Math.hypot(first.x + first.ox - (second.x + second.ox), first.y + first.oy - (second.y + second.oy));
  }

  // --- Rendu ----------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D) {
    const { link, node: nodeColor, hub: hubColor, alpha } = this.palette;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Liens — plus lumineux a proximite du curseur.
    ctx.lineWidth = 1;
    for (let i = 0; i < this.nodes.length; i += 1) {
      const a = this.nodes[i];
      const ax = a.x + a.ox;
      const ay = a.y + a.oy;
      for (let j = i + 1; j < this.nodes.length; j += 1) {
        const b = this.nodes[j];
        const bx = b.x + b.ox;
        const by = b.y + b.oy;
        const distance = Math.hypot(bx - ax, by - ay);
        if (distance >= LINK_DISTANCE) continue;

        let strength = 1 - distance / LINK_DISTANCE;
        if (this.pointer) {
          const toPointer = Math.hypot((ax + bx) / 2 - this.pointer.x, (ay + by) / 2 - this.pointer.y);
          if (toPointer < POINTER_RADIUS) strength += (1 - toPointer / POINTER_RADIUS) * 1.6;
        }

        ctx.strokeStyle = rgba(link, Math.min(0.75, strength * alpha.link));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // 2. Impulsions le long des liens.
    for (const pulse of this.pulses) {
      const from = this.nodes[pulse.from];
      const to = this.nodes[pulse.to];
      if (!from || !to) continue;
      const x = from.x + from.ox + (to.x + to.ox - (from.x + from.ox)) * pulse.t;
      const y = from.y + from.oy + (to.y + to.oy - (from.y + from.oy)) * pulse.t;
      // Apparition et disparition en fondu, pour ne pas « clignoter ».
      const fade = Math.sin(pulse.t * Math.PI);
      ctx.fillStyle = rgba(hubColor, fade * 0.85);
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Noeuds — les hubs portent un halo.
    for (const node of this.nodes) {
      const x = node.x + node.ox;
      const y = node.y + node.oy;
      if (node.hub) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, node.radius * 6);
        glow.addColorStop(0, rgba(hubColor, alpha.hub));
        glow.addColorStop(1, rgba(hubColor, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, node.radius * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(node.hub ? hubColor : nodeColor, node.hub ? alpha.hub : alpha.node);
      ctx.beginPath();
      ctx.arc(x, y, node.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Ondes de clic.
    ctx.lineWidth = 1.5;
    for (const wave of this.waves) {
      const fade = 1 - wave.radius / WAVE_MAX_RADIUS;
      ctx.strokeStyle = rgba(hubColor, fade * 0.45);
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

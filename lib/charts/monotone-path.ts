/**
 * Interpolation cubique MONOTONE (Fritsch–Carlson) — fonction PURE.
 *
 * Une Bézier naïve ou une Catmull-Rom « dépasse » : entre deux points bas elle
 * plonge sous le minimum, ce qui donnerait des valeurs négatives sur un
 * graphique de comptages. Fritsch–Carlson borne les tangentes de façon à ce que
 * la courbe reste comprise entre les valeurs voisines : aucun dépassement, ni
 * sous 0, ni au-dessus du maximum réel.
 *
 * Renvoie directement l'attribut `d` d'un `<path>` SVG.
 */

export interface Point {
  x: number;
  y: number;
}

const round = (value: number) => Number(value.toFixed(2));

/** Tangentes en chaque point, bornées pour préserver la monotonie. */
function tangents(points: Point[]): number[] {
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];

  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  const m = new Array<number>(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];

  for (let i = 1; i < n - 1; i += 1) {
    // Changement de sens (ou palier) : tangente nulle, c'est un extremum local.
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
      continue;
    }
    // Moyenne harmonique pondérée : garantit |m| <= 3 × min(|pentes|).
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
  }
  return m;
}

export function monotonePath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${round(points[0].x)} ${round(points[0].y)}`;
  if (points.length === 2) {
    return `M ${round(points[0].x)} ${round(points[0].y)} L ${round(points[1].x)} ${round(points[1].y)}`;
  }

  const m = tangents(points);
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const h = (points[i + 1].x - points[i].x) / 3;
    d +=
      ` C ${round(points[i].x + h)} ${round(points[i].y + m[i] * h)}` +
      `, ${round(points[i + 1].x - h)} ${round(points[i + 1].y - m[i + 1] * h)}` +
      `, ${round(points[i + 1].x)} ${round(points[i + 1].y)}`;
  }
  return d;
}

/** Même courbe, refermée sur la ligne de base : sert à peindre l'aire. */
export function monotoneArea(points: Point[], baseline: number): string {
  if (points.length === 0) return "";
  const line = monotonePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${round(last.x)} ${round(baseline)} L ${round(first.x)} ${round(baseline)} Z`;
}

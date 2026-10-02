/**
 * Mini-graphe en aire : grille légère, courbe lissée, point final accentué.
 *
 * Rendu SVG inline, sans dépendance ni JS client. Les couleurs passent par
 * `style` (et non par un attribut de présentation) : c'est la seule forme où
 * `var(--token)` est garanti dans tous les navigateurs, d'où le suivi
 * automatique du thème clair / sombre.
 *
 * La courbe est étirée en largeur (`preserveAspectRatio="none"`) ; le point
 * final est donc un élément HTML positionné en pourcentage, sinon l'étirement
 * l'aplatirait en ellipse.
 */

interface SparklineProps {
  /** Valeurs dans l'ordre chronologique. */
  values: number[];
  /** Identifiant unique dans la page (sert au dégradé SVG). */
  id: string;
  /** Description lue par les lecteurs d'écran. */
  label: string;
  /** Token de couleur de la courbe (`--primary` par défaut). */
  token?: string;
}

const WIDTH = 240;
const HEIGHT = 64;
const PADDING = 5;
const USABLE = HEIGHT - PADDING * 2;

/** Courbe lissée par segments de Bézier : rendu « brume » plutôt qu'anguleux. */
function buildPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    path += ` C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}

export function Sparkline({ values, id, label, token = "--primary" }: SparklineProps) {
  const color = `var(${token})`;
  const series = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...series, 1);

  const points = series.map((value, index) => ({
    x: (index / (series.length - 1)) * WIDTH,
    y: PADDING + USABLE - (value / max) * USABLE,
  }));

  const line = buildPath(points);
  const area = `${line} L ${WIDTH} ${HEIGHT} L 0 ${HEIGHT} Z`;
  const lastY = points[points.length - 1].y;

  return (
    <div className="relative h-16 w-full" role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
        className="h-full w-full"
      >
        <defs>
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.32 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {/* Grille : trois repères horizontaux très discrets. */}
        {[0.25, 0.5, 0.75].map((step) => (
          <line
            key={step}
            x1="0"
            x2={WIDTH}
            y1={PADDING + USABLE * step}
            y2={PADDING + USABLE * step}
            style={{ stroke: "var(--line-soft)" }}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} style={{ fill: `url(#spark-${id})` }} />
        <path
          d={line}
          fill="none"
          style={{ stroke: color }}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Point final : halo brumeux + pastille, la signature « lumière » de la palette. */}
      <span
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
        style={{ left: "calc(100% - 3px)", top: `${(lastY / HEIGHT) * 100}%`, background: color }}
      />
      <span
        className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: "calc(100% - 3px)",
          top: `${(lastY / HEIGHT) * 100}%`,
          background: color,
          boxShadow: "0 0 0 1.5px var(--surface)",
        }}
      />
    </div>
  );
}

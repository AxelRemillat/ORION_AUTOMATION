/**
 * Tableau de score du round : FAITES / TOTAL.
 *
 * Le « / » n'est pas un caractère mais un trait diagonal : blanc au cœur, avec
 * une copie rouge et une copie bleue décalées d'un pixel. C'est l'aberration
 * chromatique des écrans de transition — un glyphe ne la rendrait pas.
 *
 * `celebrate` sert au moment d'une validation : le slash scintille plus fort et
 * le bloc tremble brièvement.
 */
export function ScoreCounter({
  done,
  total,
  celebrate = false,
  size = "md",
}: {
  done: number;
  total: number;
  /** Renforce le scintillement et secoue le compteur, 300 ms. */
  celebrate?: boolean;
  size?: "md" | "xl";
}) {
  const big = size === "xl";
  const digit = big ? "text-[64px] leading-none" : "text-[34px] leading-none";

  return (
    <div
      className={`flex flex-col items-center gap-1 ${celebrate ? "motion-safe:vs-shake" : ""}`}
      role="status"
      aria-label={`${done} action${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} sur ${total}`}
    >
      <span
        aria-hidden
        className="font-versus text-[10px] font-bold uppercase tracking-[0.34em]"
        style={{ color: "var(--vs-ink-soft)" }}
      >
        Round du jour
      </span>

      <span aria-hidden className="flex items-center gap-2">
        <span
          className={`font-versus font-extrabold italic tabular-nums ${digit}`}
          style={{ color: "var(--vs-ink)" }}
        >
          {done}
        </span>

        <EnergySlash height={big ? 56 : 32} celebrate={celebrate} />

        <span
          className={`font-versus font-extrabold italic tabular-nums ${digit}`}
          style={{ color: "var(--vs-ink-soft)" }}
        >
          {total}
        </span>
      </span>
    </div>
  );
}

/** Le trait diagonal lumineux, en trois couches décalées. */
function EnergySlash({ height, celebrate }: { height: number; celebrate: boolean }) {
  const width = Math.round(height * 0.45);
  const layers = [
    { dx: -1.5, color: "var(--vs-red)", opacity: 0.85, blur: 0 },
    { dx: 1.5, color: "var(--vs-blue)", opacity: 0.85, blur: 0 },
    { dx: 0, color: "var(--vs-ink)", opacity: 1, blur: 0 },
  ];

  return (
    <span
      className={`relative inline-block ${celebrate ? "motion-safe:vs-flicker" : "motion-safe:vs-flicker"}`}
      style={{ width, height, opacity: celebrate ? 1 : 0.95 }}
      aria-hidden
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="overflow-visible">
        {/* Halo diffus, posé sous les traits nets. */}
        <line
          x1={width * 0.16}
          y1={height * 0.94}
          x2={width * 0.84}
          y2={height * 0.06}
          strokeWidth={7}
          strokeLinecap="round"
          style={{ stroke: "var(--vs-blue)", opacity: 0.28, filter: "blur(4px)" }}
        />
        {layers.map((layer) => (
          <line
            key={layer.color + layer.dx}
            x1={width * 0.16 + layer.dx}
            y1={height * 0.94}
            x2={width * 0.84 + layer.dx}
            y2={height * 0.06}
            strokeWidth={layer.dx === 0 ? 3 : 2.5}
            strokeLinecap="round"
            style={{ stroke: layer.color, opacity: layer.opacity }}
          />
        ))}
      </svg>
    </span>
  );
}

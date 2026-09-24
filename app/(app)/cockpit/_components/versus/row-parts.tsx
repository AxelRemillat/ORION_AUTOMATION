"use client";

/**
 * Pieces de la ligne d'action : jauge de chaleur et bouton parallelogramme.
 *
 * Le skew est applique au bouton et annule sur son contenu — sans quoi le
 * texte et l'icone pencheraient aussi, ce qui les rend illisibles.
 */

export const SKEW = { transform: "skewX(-12deg)" };
export const UNSKEW = { transform: "skewX(12deg)" };

/** Jauge de chaleur : dégradé bleu → rouge, curseur lumineux sur le score. */
export function HeatGauge({ score, accent }: { score: number; accent: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span
        className="relative h-1 w-full max-w-[180px] overflow-visible rounded-full"
        style={{ background: "linear-gradient(90deg, var(--vs-blue), var(--vs-red))", opacity: 0.45 }}
        role="img"
        aria-label={`Chaleur ${score} sur 100`}
      >
        <span
          aria-hidden
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${score}%`, background: accent, boxShadow: `0 0 8px ${accent}` }}
        />
      </span>
      <span
        className="font-data text-[11px] tabular-nums"
        style={{ color: "var(--vs-ink-soft)" }}
      >
        {score}
      </span>
    </div>
  );
}

/** Parallélogramme à bord lumineux, texte redressé. */
export function GhostButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ ...SKEW, borderColor: "var(--vs-line)", color: "var(--vs-ink)" }}
      className="inline-flex h-9 w-10 items-center justify-center border motion-safe:transition-all hover:border-white/50 hover:shadow-[0_0_14px_rgb(var(--rgb-vs-ink) / 0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
    >
      <span style={UNSKEW}>{children}</span>
    </button>
  );
}

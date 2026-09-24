"use client";

/**
 * Pieces de la ligne d'action : jauge de chaleur et bouton parallelogramme.
 *
 * Le skew est applique au bouton et annule sur son contenu — sans quoi le
 * texte et l'icone pencheraient aussi, ce qui les rend illisibles.
 *
 * Aucune `opacity` n'est posee sur un conteneur : elle s'appliquerait a tout le
 * sous-arbre. Les transparences sont portees par les couleurs elles-memes.
 */

export const SKEW = { transform: "skewX(-12deg)" };
export const UNSKEW = { transform: "skewX(12deg)" };

/** Jauge de chaleur : piste discrete, remplissage plein, curseur lumineux. */
export function HeatGauge({ score, accent }: { score: number; accent: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span
        className="relative h-1.5 w-full max-w-[180px] rounded-full"
        style={{ background: "rgb(var(--rgb-vs-ink) / 0.15)" }}
        role="img"
        aria-label={`Chaleur ${score} sur 100`}
      >
        {/*
          Le degrade couvre TOUTE la piste puis est rogne a la valeur : avec une
          simple `width`, il se comprimerait et la couleur sous le curseur ne
          correspondrait plus a la position sur l'echelle.
        */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: "linear-gradient(90deg, var(--vs-blue), var(--vs-red))",
            clipPath: `inset(0 ${100 - score}% 0 0 round 9999px)`,
          }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${score}%`,
            background: accent,
            boxShadow: `0 0 8px ${accent}`,
            border: "1px solid rgb(var(--rgb-vs-ink) / 0.9)",
          }}
        />
      </span>
      <span
        className="font-data text-[11px] tabular-nums"
        style={{ color: "rgb(var(--rgb-vs-ink) / 0.8)" }}
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
      style={SKEW}
      className="vs-ghost inline-flex h-9 w-10 items-center justify-center border motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
    >
      <span style={UNSKEW}>{children}</span>
    </button>
  );
}

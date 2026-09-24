import type { ScoreLine } from "@/lib/scoring";

/**
 * Détail du score de chaleur : d'où viennent les points.
 *
 * Un score nu (« 72/100 ») ne se discute pas, donc ne se corrige pas. En
 * affichant la base, les bonus, les malus ET ce qui a été ignoré — un signal
 * non daté, un signal périmé — le chiffre devient vérifiable : on voit
 * immédiatement si le prospect est mal classé parce qu'une source n'était pas
 * datée, ou parce qu'il est réellement froid.
 */

const SIGN = (points: number): string => (points > 0 ? `+${points}` : `${points}`);

function toneOf(line: ScoreLine): string {
  if (line.kind === "bonus") return "var(--good)";
  if (line.kind === "malus") return "var(--lost)";
  if (line.kind === "base") return "var(--primary)";
  return "var(--faint)";
}

/** Liste complète, pour la fiche prospect. */
export function ScoreBreakdown({ lines, className }: { lines: ScoreLine[]; className?: string }) {
  if (!lines.length) return null;

  return (
    <ul className={className}>
      {lines.map((line, index) => (
        <li key={`${line.label}-${index}`} className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-[13px] leading-snug text-muted">{line.label}</span>
          <span
            className="font-data shrink-0 text-[12px]"
            style={{ color: toneOf(line) }}
          >
            {line.kind === "info" && line.points === 0 ? "0" : SIGN(line.points)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Version d'une ligne, pour les actions du jour : seuls les ajustements
 * apparaissent — la base est déjà lisible dans la jauge.
 */
export function ScoreBreakdownInline({ lines }: { lines: ScoreLine[] }) {
  const adjustments = lines.filter((line) => line.kind === "bonus" || line.kind === "malus");
  if (!adjustments.length) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {adjustments.map((line, index) => (
        <span key={`${line.label}-${index}`} className="font-data text-[11px]" style={{ color: toneOf(line) }}>
          {SIGN(line.points)} {line.label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

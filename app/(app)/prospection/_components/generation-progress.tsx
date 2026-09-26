import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobProgress } from "@/lib/jobs/types";

/** Les quatre temps d'une génération, dans l'ordre où le serveur les franchit. */
const STAGES = ["Analyse", "Stratège", "Rédaction", "Juge"] as const;

/** Étape en cours, déduite du pourcentage posé par le serveur (5 / 25 / 50 / 75). */
function stageOf(pct: number): number {
  if (pct >= 75) return 3;
  if (pct >= 50) return 2;
  if (pct >= 25) return 1;
  return 0;
}

/**
 * Barre de progression d'une génération de mail.
 *
 * Elle lit l'avancement du job en base : fermer l'écran puis revenir la
 * retrouve là où le serveur en est, pas remise à zéro.
 */
export function GenerationProgress({ progress }: { progress: JobProgress | null }) {
  const pct = Math.max(3, Math.min(100, progress?.pct ?? 3));
  const current = stageOf(pct);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-mist" role="status" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-medium text-text">
          <Loader2 className="h-4 w-4 text-primary motion-safe:animate-spin" aria-hidden />
          {progress?.step ?? "Génération en file d'attente"}
        </p>
        <span className="font-data text-[12px] tabular-nums text-muted">{Math.round(pct)} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand-grad motion-safe:transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-2">
        {STAGES.map((label, index) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-1.5 text-[12px]",
              index < current ? "text-good-ink" : index === current ? "font-medium text-primary-ink" : "text-faint",
            )}
          >
            {index < current ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <span className="font-data text-[11px]">{index + 1}.</span>
            )}
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-muted">
        Vous pouvez quitter la page : la génération continue sur le serveur et le brouillon sera là au retour.
      </p>
    </div>
  );
}

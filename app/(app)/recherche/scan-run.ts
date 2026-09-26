import type { SearchRun } from "@/types";
import type { EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import type { ScanStats } from "./scan-summary";
import type { SearchCriteriaInput } from "./search-form";
import type { SignalCriteriaInput } from "./signals-form";

/**
 * Lecture d'un scan terminé, tel que le job l'a rangé dans `search_runs`.
 *
 * Le scan tourne côté serveur : l'écran ne reçoit plus de réponse HTTP à la
 * fin, il relit la ligne. Tout ce qu'il affiche en vient — y compris le bilan,
 * que le job range dans `progress.summary`.
 */
export interface FinishedScan {
  results: EnrichedCompany[];
  warnings: EnrichmentWarning[];
  scan: ScanStats | null;
  error: string | null;
}

export function readFinishedScan(run: SearchRun): FinishedScan {
  const summary = (run.progress as { summary?: ScanStats } | null)?.summary;
  return {
    results: (run.results ?? []) as EnrichedCompany[],
    warnings: (run.warnings ?? []) as EnrichmentWarning[],
    scan: summary && typeof summary.total === "number" ? summary : null,
    error: run.status === "error" ? run.error ?? "Recherche impossible." : null,
  };
}

/** Libellé de la tâche, affiché dans l'indicateur de la navbar. */
export function criteriaLabel(criteria: SearchCriteriaInput): string {
  const what = criteria.q?.trim() || (criteria.section ? `section ${criteria.section}` : "tous secteurs");
  return ["Recherche", what, criteria.zone?.trim()].filter(Boolean).join(" · ").slice(0, 160);
}

export function signalsLabel(criteria: SignalCriteriaInput): string {
  return `Signaux · dép. ${criteria.departement}`;
}

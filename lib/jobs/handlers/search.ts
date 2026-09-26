import { clampAnalysisLimit, clampScanWidth, searchAndEnrich } from "@/lib/enrichment";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { knownSirens } from "@/lib/trash/exclusions";
import { finishRun, saveProgress } from "@/lib/search/runs";
import { readExcludedSectors } from "@/lib/signals/settings";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";
import { closeRunOnFailure, fromScan, prepareRun, runIdOf, stopCheck } from "./search-shared";

/** Critères d'une recherche par critères, tels qu'envoyés par l'écran. */
export interface SearchParams {
  q?: string;
  /** Lettre de section NAF. */
  section?: string;
  /** Identifiant de tranche d'effectif (voir SIZE_BUCKETS). */
  size?: string;
  /** Ville, code postal ou département. */
  zone?: string;
  /** Plafond d'enrichissements profonds — Pappers (1-10). */
  limit?: number;
  /** Largeur du scan Linkup (5-25). */
  scanWidth?: number;
  /** Ligne `search_runs` déjà ouverte par l'écran, s'il y en a une. */
  runId?: string;
  /** Autorise le dépassement jusqu'au plafond de 3x (défaut : oui). */
  goFurther?: boolean;
  /** Passe outre le ciblage pour cette recherche seulement. */
  includeExcluded?: boolean;
}

export function searchLabel(params: SearchParams): string {
  const what = params.q?.trim() || (params.section ? `section ${params.section}` : "tous secteurs");
  return ["Recherche", what, params.zone?.trim()].filter(Boolean).join(" · ").slice(0, 160);
}

/**
 * Étape 2 — le scan complet (annuaire → Linkup → Pappers).
 *
 * `searchAndEnrich` est d'un seul tenant (lib/enrichment) : l'étape dure donc
 * autant que le scan, dans la limite de 300 s. Sa reprise reste économe :
 * chaque lot scanné est journalisé dans `scan_history`, qu'une nouvelle
 * tentative exclut (`knownSirens`) au lieu de le repayer.
 */
async function scan(ctx: StepContext): Promise<StepOutcome> {
  const params = ctx.job.params as SearchParams;
  const runId = runIdOf(ctx);
  const includeExcluded = params.includeExcluded === true;
  const exclude = await knownSirens(ctx.db).catch(() => new Set<string>());
  const excludedSectors = includeExcluded ? [] : await readExcludedSectors(ctx.db);

  const outcome = await searchAndEnrich(
    {
      q: params.q,
      section: params.section || undefined,
      tranches: tranchesForBucket(params.size),
      zone: params.zone,
      // Bornes côté serveur : le client ne peut pas faire exploser la facture.
      limit: clampAnalysisLimit(params.limit),
      scanWidth: clampScanWidth(params.scanWidth),
      goFurther: params.goFurther !== false,
    },
    {
      exclude,
      excludedSectors,
      includeExcluded,
      onProgress: async (progress) => {
        await saveProgress(ctx.db, runId, progress);
        await ctx.progress(fromScan(progress));
      },
      shouldStop: stopCheck(ctx, runId),
      onScanned: async (rows) => {
        if (!rows.length) return;
        const scannedAt = new Date().toISOString();
        await ctx.db.from("scan_history").upsert(
          rows.map((row) => ({ ...row, user_id: ctx.userId, scanned_at: scannedAt })),
          { onConflict: "user_id,siren" },
        );
      },
    },
  );

  // Zone inconnue, annuaire injoignable : relancer ne changerait rien.
  if ("error" in outcome) throw new JobError(outcome.error, false, 422);

  const stopped = await stopCheck(ctx, runId)();
  const final = {
    // Pages prévues = pages lues : le plan est clos, la barre finit pleine.
    phase: "fiches" as const,
    pagesRead: outcome.pagesRead ?? 0,
    pagesPlanned: outcome.pagesRead ?? 0,
    scanned: outcome.scanned,
    withSignal: outcome.withSignal,
    analysed: outcome.analysed,
    analysedPlanned: outcome.analysed,
    step: stopped ? "Scan arrêté" : "Scan terminé",
  };
  await finishRun(ctx.db, runId, {
    status: stopped ? "stopped" : "done",
    results: outcome.results,
    warnings: outcome.warnings,
    progress: final,
  });

  return {
    state: { response: { ...outcome, runId } },
    result: { runId },
    progress: { ...fromScan(final), pct: 100 },
  };
}

export const searchCriteriaHandler: JobHandler = {
  steps: [prepareRun, scan],
  onFailed: closeRunOnFailure,
};

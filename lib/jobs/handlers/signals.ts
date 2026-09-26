import { clampAnalysisLimit } from "@/lib/enrichment/limits";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { knownSirens } from "@/lib/trash/exclusions";
import { EMPTY_PROGRESS, finishRun, saveProgress, type RunProgress } from "@/lib/search/runs";
import { DEFAULT_SIGNAL_DAYS, searchBySignals } from "@/lib/signals";
import { readExcludedSectors } from "@/lib/signals/settings";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";
import {
  closeRunOnFailure,
  fromScan,
  prepareRun,
  runIdOf,
  startHeartbeat,
  stopCheck,
  type ScanSummary,
} from "./search-shared";

export interface SignalsParams {
  /** Numéro de département, seul filtre géographique des deux sources. */
  departement?: string;
  /** Identifiant de tranche d'effectif (`"petite"` = 10 à 49). */
  size?: string;
  /** Fenêtre d'antériorité en jours. */
  days?: number;
  limit?: number;
  runId?: string;
  /** Passe outre le ciblage pour cette recherche seulement. */
  includeExcluded?: boolean;
}

/** Deux chiffres, ou un département corse (`2A`, `2B`), ou l'outre-mer. */
const DEPARTEMENT = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/i;

/** Borne la fenêtre : au-delà de 90 jours, ce n'est plus une actualité. */
export function clampDays(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNAL_DAYS;
  return Math.max(7, Math.min(90, parsed));
}

/** Contrôle des paramètres, partagé par la route et le job. Rend l'erreur ou null. */
export function signalsParamsError(params: SignalsParams): string | null {
  const departement = params.departement?.trim().toUpperCase() ?? "";
  if (!DEPARTEMENT.test(departement)) return "Indiquez un numéro de département (par exemple 69).";
  if (!tranchesForBucket(params.size).length) return "Choisissez une taille d'entreprise.";
  return null;
}

export function signalsLabel(params: SignalsParams): string {
  return `Signaux · dép. ${params.departement?.trim().toUpperCase() ?? "?"}`;
}

/**
 * Étape 2 — sources officielles → identité → fiches.
 *
 * Même limite que la recherche par critères : `searchBySignals` est d'un seul
 * tenant, l'étape dure donc autant que la recherche (35 à 45 s en pratique).
 */
async function search(ctx: StepContext): Promise<StepOutcome> {
  const params = ctx.job.params as SignalsParams;
  const invalid = signalsParamsError(params);
  if (invalid) throw new JobError(invalid, false, 422);

  const runId = runIdOf(ctx);
  const departement = params.departement!.trim().toUpperCase();
  const limit = clampAnalysisLimit(params.limit);
  const includeExcluded = params.includeExcluded === true;
  const exclude = await knownSirens(ctx.db).catch(() => new Set<string>());
  const excludedSectors = includeExcluded ? [] : await readExcludedSectors(ctx.db);

  let last: RunProgress = EMPTY_PROGRESS;
  const stopHeartbeat = startHeartbeat(ctx, runId, () => last);
  const report = async (progress: RunProgress) => {
    last = progress;
    await saveProgress(ctx.db, runId, progress);
    await ctx.progress(fromScan(progress));
  };

  const outcome = await searchBySignals(
    { departement, tranches: tranchesForBucket(params.size), days: clampDays(params.days), limit },
    {
      exclude,
      excludedSectors,
      includeExcluded,
      shouldStop: stopCheck(ctx, runId),
      // Phase 1 : lecture des sources et résolution d'identité, gratuite.
      onProgress: ({ looked, found }) =>
        report({
          phase: "annuaire",
          pagesRead: looked,
          pagesPlanned: Math.max(looked, limit * 8),
          scanned: looked,
          withSignal: found,
          analysed: 0,
          analysedPlanned: limit,
          step: `Rapprochement des signaux · ${found} entreprise(s) en tranche`,
        }),
      onEnrich: ({ analysed, planned }) =>
        report({
          phase: "fiches",
          pagesRead: 1,
          pagesPlanned: 1,
          scanned: 0,
          withSignal: planned,
          analysed,
          analysedPlanned: planned,
          step: `Ouverture des fiches ${analysed}/${planned}`,
        }),
    },
  ).finally(stopHeartbeat);

  const stopped = await stopCheck(ctx, runId)();
  const final = {
    phase: "fiches" as const,
    pagesRead: 1,
    pagesPlanned: 1,
    scanned: outcome.lookups,
    withSignal: outcome.signalsFound,
    analysed: outcome.analysed,
    analysedPlanned: outcome.analysed,
    step: stopped ? "Recherche arrêtée" : "Recherche terminée",
  };
  const summary: ScanSummary = {
    // Ce mode ne lit pas l'annuaire par pages : « total » est le nombre de
    // signaux lus, « scannées » celui des identités résolues.
    total: outcome.signalsFound,
    scanned: outcome.lookups,
    unverified: 0,
    withSignal: outcome.results.length,
    analysed: outcome.analysed,
    requested: limit,
    totalCapped: false,
    zoneLabel: `département ${departement}`,
    skippedKnown: outcome.skippedKnown,
    pagesRead: 0,
    stopReason: outcome.sources
      .map((source) =>
        source.available ? `${source.label} : ${source.count} signaux` : `${source.label} : ${source.unavailableReason}`,
      )
      .join(" · "),
    outOfBracket: [...outcome.excluded, ...outcome.outOfBracket],
  };
  await finishRun(ctx.db, runId, {
    status: stopped ? "stopped" : "done",
    results: outcome.results,
    warnings: outcome.warnings,
    progress: { ...final, summary },
  });

  return {
    state: { response: { ...outcome, runId } },
    result: { runId },
    progress: { ...fromScan(final), pct: 100 },
  };
}

export const searchSignalsHandler: JobHandler = {
  steps: [prepareRun, search],
  onFailed: closeRunOnFailure,
};

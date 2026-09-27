import { annuaireLookup } from "@/lib/funnel/identify";
import { runCost } from "@/lib/funnel/cost";
import { harvest } from "@/lib/funnel/harvest";
import { liveDigDeps, liveTriageAsk } from "@/lib/funnel/live";
import { cleanPrefs, readPrefs, type FunnelPrefs } from "@/lib/funnel/settings";
import { runDigStage, runFilterStage, runTriageStage } from "@/lib/funnel/stages";
import { candidatesOf, countFunnel, insertHarvest } from "@/lib/funnel/store";
import { finishRun } from "@/lib/search/runs";
import { knownSirens } from "@/lib/trash/exclusions";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";
import { closeRunOnFailure, prepareRun, runIdOf } from "./search-shared";

/** Variante de `search_signals` qui porte l'entonnoir (voir handlers/index.ts). */
export const FUNNEL_KIND = "funnel";

/**
 * Job `search_signals` + `params.kind = "funnel"` — l'entonnoir « signaux d'abord » en 4 étages.
 *
 *   préparation → moisson → filtre → tri LLM → creusage ×5 → bilan
 *
 * Le creusage est découpé en 5 étapes de 4 fiches au plus : une étape de job
 * doit tenir dans les 300 s d'une fonction. Chaque étape est idempotente — elle
 * ne reprend que les lignes au bon statut dans `signal_candidates`.
 */

const DIG_PER_STEP = 4;
const DIG_STEPS = 5;
/** Marge avant la coupure d'une fonction (300 s). */
const STEP_BUDGET_MS = 240_000;

async function prefsOf(ctx: StepContext): Promise<FunnelPrefs> {
  const stored = await readPrefs(ctx.db, ctx.userId);
  // Un run manuel peut surcharger zones, fenêtre et plafond, sans toucher aux réglages.
  return cleanPrefs(ctx.job.params, stored);
}

const progress = (step: string, pct: number, counts = { scanned: 0, signals: 0, sheets: 0 }) => ({ step, pct, counts });

async function harvestStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const prefs = await prefsOf(ctx);
  if (!prefs.departements.length) {
    throw new JobError("Aucune zone : indiquez au moins un département dans les réglages Signaux.", false, 422);
  }
  await ctx.progress(progress(`Moisson BODACC et France Travail · ${prefs.departements.join(", ")}`, 10));
  const collected = await harvest({ departements: prefs.departements, days: prefs.days });
  const inserted = await insertHarvest(ctx.db, ctx.userId, runId, collected.signals);
  return {
    state: { runId, startedAt: ctx.job.state.startedAt ?? new Date().toISOString(), warnings: collected.warnings },
    progress: progress(`${collected.signals.length} signaux moissonnés, ${inserted} nouveaux`, 20, {
      scanned: collected.signals.length,
      signals: 0,
      sheets: 0,
    }),
  };
}

async function filterStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const prefs = await prefsOf(ctx);
  const known = await knownSirens(ctx.db).catch(() => new Set<string>());
  const { lookups } = await runFilterStage(ctx.db, ctx.userId, runId, {
    prefs,
    lookup: annuaireLookup,
    known,
    deadline: Date.now() + STEP_BUDGET_MS,
  });
  return { progress: progress(`Filtre déterministe · ${lookups} identités annuaire`, 40) };
}

async function triageStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const { triaged, retained } = await runTriageStage(ctx.db, ctx.userId, runId, liveTriageAsk);
  return { progress: progress(`Tri : ${retained} retenus sur ${triaged}`, 55) };
}

const digStep = (index: number) =>
  async function dig(ctx: StepContext): Promise<StepOutcome> {
    const runId = runIdOf(ctx);
    const prefs = await prefsOf(ctx);
    const { dug, remaining } = await runDigStage(ctx.db, ctx.userId, runId, {
      deps: liveDigDeps(ctx.db, ctx.userId, runId),
      limit: prefs.digLimit,
      perStep: DIG_PER_STEP,
    });
    const pct = 55 + Math.round(((index + 1) / DIG_STEPS) * 40);
    return { progress: progress(dug ? `Creusage : ${dug} fiche(s) de plus` : "Creusage terminé", remaining ? pct : 95) };
  };

async function finishStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const rows = await candidatesOf(ctx.db, ctx.userId, runId);
  const counts = countFunnel(rows);
  const since = String(ctx.job.state.startedAt ?? ctx.job.created_at);
  const cost = await runCost(ctx.db, ctx.userId, since);
  const prospectIds = rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id));

  // Journal du coût par run : visible dans les logs Vercel.
  console.log(`[entonnoir] run ${runId} ${JSON.stringify({ counts, cost })}`);
  await finishRun(ctx.db, runId, {
    status: "done",
    results: [],
    warnings: (ctx.job.state.warnings as unknown[]) ?? [],
    progress: {
      phase: "fiches",
      pagesRead: 1,
      pagesPlanned: 1,
      scanned: counts.bruts,
      withSignal: counts.retenus,
      analysed: counts.creuses,
      analysedPlanned: counts.creuses,
      step: "Entonnoir terminé",
      funnel: counts,
      cost,
    },
  });
  return {
    result: { runId, prospectIds },
    progress: progress(`${counts.contactables} prospect(s) prêt(s) sur ${counts.bruts} signaux`, 100, {
      scanned: counts.bruts,
      signals: counts.retenus,
      sheets: counts.creuses,
    }),
  };
}

export const signalFunnelHandler: JobHandler = {
  steps: [prepareRun, harvestStep, filterStep, triageStep, ...Array.from({ length: DIG_STEPS }, (_, i) => digStep(i)), finishStep],
  onFailed: closeRunOnFailure,
};

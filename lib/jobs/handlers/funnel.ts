import { annuaireLookup } from "@/lib/funnel/identify";
import { runCost } from "@/lib/funnel/cost";
import { harvest } from "@/lib/funnel/harvest";
import { liveDigDeps, liveTriageAsk } from "@/lib/funnel/live";
import { cleanPrefs, readPrefs, type FunnelPrefs } from "@/lib/funnel/settings";
import { runDigStage, runFilterStage, runTriageStage } from "@/lib/funnel/stages";
import { candidatesOf, countFunnel, insertHarvest, yieldBySource } from "@/lib/funnel/store";
import { finishRun } from "@/lib/search/runs";
import { knownSirens } from "@/lib/trash/exclusions";
import { runSiteStage } from "@/lib/funnel/site-priority";
import { findSiteFree } from "@/lib/contact-finder/free-site";
import { realDeps as realContactDeps } from "@/lib/contact-finder/clients";
import type { JobHandler, StepContext, StepOutcome } from "../runner";
import { closeRunOnFailure, prepareRun, runIdOf } from "./search-shared";

/** Variante de `search_signals` qui porte l'entonnoir (voir handlers/index.ts). */
export const FUNNEL_KIND = "funnel";

/**
 * Job `search_signals` + `params.kind = "funnel"` — l'entonnoir « signaux d'abord » en 4 étages.
 *
 *   préparation → moisson → filtre ×8 → tri LLM → creusage ×5 → bilan
 *
 * Le filtre et le creusage sont découpés en étapes : une étape de job doit
 * tenir dans les 300 s d'une fonction. Le 30/09/2026, le filtre en UNE étape
 * s'arrêtait après 263 signaux (identités annuaire limitées en débit) et le
 * reste du run n'était jamais examiné. Chaque étape est idempotente — elle ne
 * reprend que les lignes au bon statut dans `signal_candidates`.
 */

/** 600 identités à ~1 par seconde (avec les 429 de l'annuaire) : 8 étapes de 240 s. */
export const FILTER_STEPS = 8;
export const DIG_PER_STEP = 4;
const DIG_STEPS = 5;
/** Marge avant la coupure d'une fonction (300 s). */
export const STEP_BUDGET_MS = 240_000;

export async function prefsOf(ctx: StepContext): Promise<FunnelPrefs> {
  const stored = await readPrefs(ctx.db, ctx.userId);
  // Un run manuel peut surcharger zones, fenêtre et plafond, sans toucher aux réglages.
  // Préparation élargie (objectif du jour non atteint) : fenêtre, zones et
  // plafond de creusage du second tour (lib/jobs/handlers/prepare.ts).
  const widen = (ctx.job.state?.widen ?? null) as Record<string, unknown> | null;
  return cleanPrefs({ ...ctx.job.params, ...(widen ?? {}) }, stored);
}

const progress = (step: string, pct: number, counts = { scanned: 0, signals: 0, sheets: 0 }) => ({ step, pct, counts });

export async function harvestStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const prefs = await prefsOf(ctx);
  // Aucun département : toute la France.
  const zone = prefs.departements.length ? prefs.departements.join(", ") : "toute la France";
  await ctx.progress(progress(`Moisson France Travail et BODACC · ${zone}`, 10));
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

export const filterStep = (index: number) =>
  async function filter(ctx: StepContext): Promise<StepOutcome> {
    const runId = runIdOf(ctx);
    const prefs = await prefsOf(ctx);
    const known = await knownSirens(ctx.db).catch(() => new Set<string>());
    const { lookups, remaining, bySource } = await runFilterStage(ctx.db, ctx.userId, runId, {
      prefs,
      lookup: annuaireLookup,
      known,
      deadline: Date.now() + STEP_BUDGET_MS,
    });
    const quota = Object.entries(bySource).map(([source, count]) => `${source} ${count}`).join(", ");
    const pct = 20 + Math.round(((index + 1) / FILTER_STEPS) * 20);
    return {
      progress: progress(
        `Filtre déterministe · ${lookups} identités annuaire${quota ? ` (budget : ${quota})` : ""}${remaining ? ` · ${remaining} à examiner` : ""}`,
        pct,
      ),
    };
  };

/** Étape GRATUITE : recherche de site des retenus, avant le creusage payant. */
export async function siteStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const deps = realContactDeps(null);
  const { checked, found } = await runSiteStage(ctx.db, ctx.userId, runId, {
    findSite: (identity) => findSiteFree(identity, deps, { deadline: Date.now() + STEP_BUDGET_MS }),
    deadline: Date.now() + STEP_BUDGET_MS,
  });
  return { progress: progress(`Sites : ${found} trouvé(s) sur ${checked} fiche(s) vérifiée(s)`, 56) };
}

export async function triageStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const { triaged, retained } = await runTriageStage(ctx.db, ctx.userId, runId, liveTriageAsk);
  return { progress: progress(`Tri : ${retained} retenus sur ${triaged}`, 55) };
}

export const digStep = (index: number, total = DIG_STEPS) =>
  async function dig(ctx: StepContext): Promise<StepOutcome> {
    const runId = runIdOf(ctx);
    const prefs = await prefsOf(ctx);
    const { dug, remaining } = await runDigStage(ctx.db, ctx.userId, runId, {
      deps: liveDigDeps(ctx.db, ctx.userId, runId),
      limit: prefs.digLimit,
      perStep: DIG_PER_STEP,
      prefs,
    });
    const pct = 55 + Math.round(((index + 1) / total) * 40);
    return { progress: progress(dug ? `Creusage : ${dug} fiche(s) de plus` : "Creusage terminé", remaining ? pct : 95) };
  };

export async function finishStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const rows = await candidatesOf(ctx.db, ctx.userId, runId);
  const counts = countFunnel(rows);
  const bySource = yieldBySource(rows);
  const since = String(ctx.job.state.startedAt ?? ctx.job.created_at);
  const cost = await runCost(ctx.db, ctx.userId, since);
  const prospectIds = rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id));

  // Journal du coût par run : visible dans les logs Vercel.
  console.log(`[entonnoir] run ${runId} ${JSON.stringify({ counts, bySource, cost })}`);
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
      bySource,
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
  steps: [
    prepareRun,
    harvestStep,
    ...Array.from({ length: FILTER_STEPS }, (_, i) => filterStep(i)),
    triageStep,
    siteStep,
    ...Array.from({ length: DIG_STEPS }, (_, i) => digStep(i)),
    finishStep,
  ],
  onFailed: closeRunOnFailure,
};

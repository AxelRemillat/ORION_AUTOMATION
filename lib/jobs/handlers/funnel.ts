import { annuaireLookup } from "@/lib/funnel/identify";
import { ftWindowDays } from "@/lib/funnel/harvest";
import { ftCursorStore } from "@/lib/funnel/ft-cursor-store";
import { runCost } from "@/lib/funnel/cost";
import { harvest } from "@/lib/funnel/harvest";
import { liveDigDeps, liveTriageAsk } from "@/lib/funnel/live";
import { cleanPrefs, readPrefs, type FunnelPrefs } from "@/lib/funnel/settings";
import { runDigStage, runFilterStage, runTriageStage } from "@/lib/funnel/stages";
import { candidatesOf, countFunnel, insertHarvest, reopenUnexamined, yieldBySource } from "@/lib/funnel/store";
import { finishRun } from "@/lib/search/runs";
import { knownSirens } from "@/lib/trash/exclusions";
import { runSiteStage } from "@/lib/funnel/site-priority";
import { resolveSite } from "@/lib/contact-finder/free-site";
import { textOf } from "@/lib/contact-finder/links";
import { verifyOpposition } from "@/lib/enrichment/opposition";
import { thirdPartyEmployer } from "@/lib/emails/quality/third-party";
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
// 10 étapes de 240 s : 1 800 identités annuaire à ~1 par seconde.
export const FILTER_STEPS = 10;
/** Étapes de recherche de site (gratuite, puis Linkup plafonné) : chacune reprend où la précédente s'est arrêtée. */
export const SITE_STEPS = 3;
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
  // Fenêtre France Travail réglable par run (`params.ftDays`, Cowork #39) ; 30 jours par défaut.
  const collected = await harvest({ departements: prefs.departements, days: prefs.days, ftDays: ftWindowDays(ctx.job.params?.ftDays), ftCursor: ftCursorStore() });
  const inserted = await insertHarvest(ctx.db, ctx.userId, runId, collected.signals);
  // Les signaux laissés « non examinés » par un run précédent sont repris ici.
  const reopened = await reopenUnexamined(ctx.db, ctx.userId, runId, collected.signals.map((signal) => signal.hash));
  return {
    // Mesure (Cowork #40) : offres lues en tête / sous le curseur, signaux nouveaux vs déjà vus.
    state: { runId, startedAt: ctx.job.state.startedAt ?? new Date().toISOString(), warnings: collected.warnings, harvest: { collected: collected.signals.length, inserted, reopened, ft: collected.ft } },
    progress: progress(`${collected.signals.length} signaux moissonnés, ${inserted} nouveaux, ${reopened} repris (non examinés) · France Travail : ${collected.ft.read} offres lues${collected.ft.head !== undefined ? ` (tête ${collected.ft.head}, sous le curseur ${collected.ft.below ?? 0})` : ""}, ${collected.ft.anonymous} anonymes et ${collected.ft.staffing} d'intermédiaires ignorées`, 20, {
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
  const { checked, found, opposed, clients } = await runSiteStage(ctx.db, ctx.userId, runId, {
    checkOpposition: async (siren) => {
      const check = await verifyOpposition(siren, "inpi-only");
      return check.ok ? check.refuses : null;
    },
    screenClient: async (website) => {
      const page = await deps.fetchHtml(website);
      return page ? thirdPartyEmployer({ activity: textOf(page.html).slice(0, 5000) }) : null;
    },
    // URL de l'offre, domaines du nom, puis Linkup (score ≥ 4, plafond du jour).
    findSite: async (identity, row) =>
      (
        await resolveSite(identity, deps, {
          knownUrls: [(row.facts as { employerUrl?: string | null } | null)?.employerUrl],
          score: (row.triage as { score?: number } | null)?.score ?? row.score,
          deadline: Date.now() + STEP_BUDGET_MS,
        })
      ).site,
    deadline: Date.now() + STEP_BUDGET_MS,
  });
  return {
    progress: progress(
      `Sites : ${found} trouvé(s) sur ${checked} fiche(s) · ${opposed} opposée(s) (INPI) · ${clients} « signal pour un client » écartée(s)`,
      56,
    ),
  };
}

/**
 * Étapes de tri : ~20 s par lot de 20, ~10 lots par étape de 240 s. Cinq
 * étapes couvrent ~1 000 filtrés ; une étape sans rien à trier est immédiate.
 */
export const TRIAGE_STEPS = 5;

export const triageStep = (index: number, total = TRIAGE_STEPS) =>
  async function triage(ctx: StepContext): Promise<StepOutcome> {
    const runId = runIdOf(ctx);
    const { triaged, retained, pending, total: all } = await runTriageStage(ctx.db, ctx.userId, runId, liveTriageAsk, {
      deadline: Date.now() + STEP_BUDGET_MS,
      final: index === total - 1,
    });
    if (pending) return { progress: progress(`Tri : ${triaged} / ${all} signaux triés`, 45 + Math.round(((index + 1) / total) * 10)) };
    return { progress: progress(`Tri : ${retained} retenus sur ${triaged}`, 55) };
  };

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
    ...Array.from({ length: TRIAGE_STEPS }, (_, i) => triageStep(i)),
    // Trois étapes de 240 s : ~40 retenus par run (France Travail élargi, 05/10/2026).
    ...Array.from({ length: SITE_STEPS }, () => siteStep),
    ...Array.from({ length: DIG_STEPS }, (_, i) => digStep(i)),
    finishStep,
  ],
  onFailed: closeRunOnFailure,
};

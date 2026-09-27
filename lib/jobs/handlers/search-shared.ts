import { EMPTY_PROGRESS as EMPTY_SCAN, finishRun, isStopRequested, progressRatio, type RunProgress } from "@/lib/search/runs";
import type { JobProgress } from "../types";
import { JobError, type StepContext, type StepOutcome } from "../runner";

/**
 * Plomberie commune aux deux recherches.
 *
 * Un job de recherche écrit AUSSI dans sa ligne `search_runs` : c'est elle
 * que l'écran Recherche relit pour afficher la barre puis les entreprises
 * trouvées. Le job ne fait que la piloter.
 */

/** Avancement d'un scan, traduit dans le format des jobs. */
export function fromScan(progress: RunProgress): JobProgress {
  return {
    step: progress.step,
    pct: Math.round(progressRatio(progress) * 100),
    counts: { scanned: progress.scanned, signals: progress.withSignal, sheets: progress.analysed },
  };
}

/** Identifiant de la ligne `search_runs` pilotée par ce job. */
export function runIdOf(ctx: StepContext): string {
  const id = ctx.job.state.runId;
  if (typeof id !== "string") throw new JobError("scan introuvable : l'étape de préparation n'a pas tourné", false);
  return id;
}

/**
 * Étape 1 — la ligne `search_runs` existe avant le premier appel payant.
 *
 * Idempotente : l'écran actuel l'ouvre lui-même et passe `runId` ; un job créé
 * par POST /api/jobs n'en a pas, on l'ouvre ici une seule fois.
 */
export async function prepareRun(ctx: StepContext): Promise<StepOutcome> {
  const given = ctx.job.state.runId ?? ctx.job.params.runId;
  let runId = typeof given === "string" && given ? given : null;

  if (!runId) {
    const criteria: Record<string, unknown> = { ...ctx.job.params };
    delete criteria.runId;
    const { data, error } = await ctx.db
      .from("search_runs")
      .insert({ user_id: ctx.userId, criteria, status: "running", progress: EMPTY_SCAN })
      .select("id")
      .single();
    if (error || !data) throw new Error(`ouverture du scan impossible : ${error?.message ?? "inconnue"}`);
    runId = data.id;
  }

  return {
    state: { runId },
    result: { runId },
    progress: { ...fromScan(EMPTY_SCAN), step: "Préparation du scan" },
  };
}

/** Arrêt demandé : annulation du job OU bouton « Arrêter » de l'écran Recherche. */
export function stopCheck(ctx: StepContext, runId: string) {
  return async () => (await ctx.isCancelled()) || (await isStopRequested(ctx.db, runId));
}

/** Échec définitif : la ligne `search_runs` ne doit pas rester « running ». */
export async function closeRunOnFailure(ctx: StepContext, message: string): Promise<void> {
  const runId = ctx.job.state.runId;
  if (typeof runId === "string") await finishRun(ctx.db, runId, { status: "error", error: message });
}

/** Cadence du battement de cœur, bien sous le seuil « périmé » de l'écran (90 s). */
export const HEARTBEAT_MS = 20_000;

/**
 * Battement de cœur du scan.
 *
 * L'écran juge un scan « interrompu » après 90 s sans écriture sur sa ligne
 * `search_runs`. Or un lot Linkup ou une vague de fiches Pappers peut durer
 * plus longtemps que ça : le bandeau de la navbar disparaissait alors qu'il
 * tournait encore. On réécrit donc le dernier avancement connu toutes les
 * 20 s, ce qui fait avancer `updated_at` sans rien changer d'autre.
 */
export function startHeartbeat(ctx: StepContext, runId: string, last: () => RunProgress) {
  const timer = setInterval(() => {
    void ctx.db
      .from("search_runs")
      .update({ progress: last() })
      .eq("id", runId)
      .eq("status", "running")
      .then(() => undefined, () => undefined);
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

/**
 * Bilan d'un scan terminé, rangé dans `search_runs.progress.summary`.
 * Même forme que `ScanStats` de l'écran Recherche.
 */
export interface ScanSummary {
  total: number;
  scanned: number;
  unverified: number;
  withSignal: number;
  analysed: number;
  requested: number;
  totalCapped: boolean;
  zoneLabel: string | null;
  skippedKnown: number;
  pagesRead: number;
  stopReason: string;
  outOfBracket: string[];
}

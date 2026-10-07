import { isOpenAIQuotaError, QUOTA_MESSAGE } from "@/lib/ai/quota";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { claimJob, commitStep, getJobRow, readStatus, writeProgress } from "./store";
import { MAX_ATTEMPTS, isTerminal, type JobProgress, type JobResult, type JobRow, type JobType } from "./types";

/**
 * Exécuteur : UNE étape par appel, puis on rend la main.
 *
 * Une étape est idempotente et courte : elle lit son point de reprise dans
 * `state`, écrit ses résultats en base, puis rend ce qu'il faut fusionner dans
 * `state` / `result`. Si la fonction meurt au milieu, le bail expire et l'étape
 * est rejouée depuis le même point de reprise.
 */

export type Db = SupabaseClient<Database>;

export interface StepContext {
  /** Client service_role : chaque requête filtre elle-même sur `userId`. */
  db: Db;
  userId: string;
  job: JobRow;
  /** Avancement en cours d'étape (barre qui bouge pendant un long scan). */
  progress: (progress: JobProgress) => Promise<void>;
  /** Vrai si l'utilisateur a annulé : l'étape s'arrête proprement. */
  isCancelled: () => Promise<boolean>;
}

export interface StepOutcome {
  state?: Record<string, unknown>;
  result?: JobResult;
  progress?: JobProgress;
  /** Termine le job avant la dernière étape (rien d'autre à faire). */
  done?: boolean;
}

export interface JobHandler {
  steps: ((ctx: StepContext) => Promise<StepOutcome>)[];
  /** Appelé une fois, quand le job échoue définitivement (clore la ligne liée). */
  onFailed?: (ctx: StepContext, message: string) => Promise<void>;
}

/**
 * Erreur lisible. `retry: false` pour ce qu'une reprise ne corrigera pas
 * (prospect introuvable, clé absente, zone inconnue) : inutile de repayer.
 */
export class JobError extends Error {
  constructor(
    message: string,
    readonly retry = true,
    readonly httpStatus = 500,
    /**
     * Champs rendus TELS QUELS avec l'erreur, à côté de `error`.
     *
     * Sert aux refus que l'écran doit savoir interpréter : le gating d'accroche
     * rend `needsFeeding` et `canForce`, sur lesquels la bannière « à nourrir »
     * et le bouton « Générer quand même » se branchent. Un message d'erreur ne
     * se lit pas au motif régulier côté client.
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export type StepVerdict = "continue" | "retry" | "done" | "failed" | "cancelled";

/** Après un échec : nouvelle tentative, ou échec définitif ? */
export function failureDecision(
  attempts: number,
  error: unknown,
): { verdict: "retry" | "failed"; message: string; httpStatus: number; details?: Record<string, unknown> } {
  // Crédit OpenAI épuisé : rien à réessayer, ce n'est pas un échec de contenu.
  if (isOpenAIQuotaError(error)) return { verdict: "failed", message: QUOTA_MESSAGE, httpStatus: 402, details: { openai_quota: true } };
  const message = error instanceof Error ? error.message : String(error ?? "erreur inconnue");
  const job = error instanceof JobError ? error : null;
  const httpStatus = job?.httpStatus ?? 500;
  const details = job?.details;
  if (job && !job.retry) return { verdict: "failed", message, httpStatus, details };
  if (attempts < MAX_ATTEMPTS) return { verdict: "retry", message, httpStatus, details };
  return {
    verdict: "failed",
    message: `Échec après ${MAX_ATTEMPTS} tentatives : ${message}`,
    httpStatus,
    details,
  };
}

/**
 * Les modules de comptage (api_usage) et de cache écrivent avec la session du
 * navigateur. Un tick n'en a pas : sans ceci, le coût des jobs de fond serait
 * invisible. ORION_SCRIPT_USER_ID est le mécanisme déjà prévu pour les scripts
 * (lib/usage/record.ts) ; l'app étant mono-utilisateur, il vaut pour
 * l'instance entière.
 */
function actAs(userId: string) {
  if (!process.env.ORION_SCRIPT_USER_ID) process.env.ORION_SCRIPT_USER_ID = userId;
}

export async function runClaimedStep(
  db: Db,
  job: JobRow,
  handlers: Record<JobType, JobHandler>,
): Promise<StepVerdict> {
  actAs(job.user_id);
  const handler = handlers[job.type];
  const ctx: StepContext = {
    db,
    userId: job.user_id,
    job,
    progress: (progress) => writeProgress(db, job.id, progress),
    isCancelled: async () => (await readStatus(db, job.id)) !== "running",
  };

  if (!handler) {
    await commitStep(db, job.id, { status: "failed", error: `Type de tâche inconnu : ${job.type}` });
    return "failed";
  }

  try {
    const run = handler.steps[job.step];
    const outcome = run ? await run(ctx) : { done: true };
    const next = job.step + 1;
    const done = Boolean(outcome.done) || next >= handler.steps.length;
    const written = await commitStep(db, job.id, {
      step: next,
      state: { ...job.state, ...(outcome.state ?? {}) },
      result: { ...job.result, ...(outcome.result ?? {}) },
      ...(outcome.progress ? { progress: outcome.progress } : {}),
      status: done ? "done" : "running",
      attempts: 0,
      error: null,
    });
    if (!written) return "cancelled";
    return done ? "done" : "continue";
  } catch (error) {
    const decision = failureDecision(job.attempts, error);
    console.error(`[jobs] ${job.type} ${job.id} étape ${job.step} : ${decision.message}`);
    if (decision.verdict === "retry") {
      // Le bail est libéré : la prochaine prise rejoue la même étape.
      await commitStep(db, job.id, {
        progress: {
          ...job.progress,
          step: `Nouvelle tentative (${job.attempts + 1}/${MAX_ATTEMPTS})…`,
        },
      });
      return "retry";
    }
    const written = await commitStep(db, job.id, {
      status: "failed",
      error: decision.message,
      state: {
        ...job.state,
        httpStatus: decision.httpStatus,
        ...(decision.details ? { httpDetails: decision.details } : {}),
      },
      progress: { ...job.progress, step: "Échec" },
    });
    if (written) await handler.onFailed?.(ctx, decision.message).catch(() => undefined);
    return written ? "failed" : "cancelled";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pilote un job depuis la requête qui l'a lancé, étape après étape.
 *
 * C'est ce qui garde les écrans actuels fonctionnels (ils attendent la
 * réponse), sans rien perdre du fond : si l'onglet se ferme ou si la fonction
 * est coupée, le job existe en base et un tick le reprend là où il en était.
 * Rend la ligne finale, ou null si le délai est dépassé (job encore en cours).
 */
export async function driveJob(
  db: Db,
  jobId: string,
  handlers: Record<JobType, JobHandler>,
  deadlineMs: number,
  options: { returnIfQueued?: boolean } = {},
): Promise<JobRow | null> {
  const stopAt = Date.now() + deadlineMs;
  while (Date.now() < stopAt) {
    const claimed = await claimJob(db, jobId);
    if (claimed) {
      const verdict = await runClaimedStep(db, claimed, handlers);
      if (verdict === "continue" || verdict === "retry") continue;
      return getJobRow(db, jobId);
    }
    // Pas pris : file d'attente (3 jobs déjà en cours) ou étape tenue par un
    // tick. On relit, et on attend.
    const row = await getJobRow(db, jobId);
    if (!row || isTerminal(row.status)) return row;
    if (options.returnIfQueued && row.status === "queued") return row;
    await sleep(2_000);
  }
  return null;
}

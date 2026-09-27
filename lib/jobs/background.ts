import { createAdminClient } from "@/lib/supabase/server";
import { baseUrl, dispatchTick, waitUntil } from "./dispatch";
import { HANDLERS } from "./handlers";
import { runClaimedStep, type Db, type JobHandler } from "./runner";
import { claimJob } from "./store";
import type { JobType } from "./types";

/** Budget d'une invocation : sous maxDuration (300 s), marge d'écriture comprise. */
export const DRAIN_BUDGET_MS = 285_000;
/**
 * On n'ouvre plus d'étape s'il reste moins que ça : une étape de scan peut
 * durer plusieurs minutes, et une étape coupée par la plateforme n'est reprise
 * qu'à l'expiration de son bail (315 s). Mieux vaut la laisser au tick suivant.
 */
export const MIN_STEP_WINDOW_MS = 150_000;

/**
 * Fait avancer les jobs DANS cette invocation, étape après étape.
 *
 * Le job désigné passe d'abord ; quand il est terminé (ou en file), on prend
 * n'importe quel autre job prenable. Rend `true` seulement si l'invocation
 * s'arrête FAUTE DE TEMPS alors qu'il restait des étapes à prendre : un job qui
 * attend sa place (3 déjà en cours) ne doit pas déclencher de relève, sinon
 * les ticks se relanceraient en boucle.
 */
export async function drainJobs(
  db: Db,
  options: { jobId?: string | null; budgetMs?: number; handlers?: Record<JobType, JobHandler> } = {},
): Promise<boolean> {
  const handlers = options.handlers ?? HANDLERS;
  const stopAt = Date.now() + (options.budgetMs ?? DRAIN_BUDGET_MS);
  let preferred = options.jobId ?? null;

  while (stopAt - Date.now() >= MIN_STEP_WINDOW_MS) {
    const claimed = (preferred ? await claimJob(db, preferred) : null) ?? (await claimJob(db, null));
    if (!claimed) return false;
    const verdict = await runClaimedStep(db, claimed, handlers);
    // Le job désigné est clos : la suite de la file est prise au tour suivant.
    if (claimed.id === preferred && verdict !== "continue" && verdict !== "retry") preferred = null;
  }
  return true;
}

/**
 * Lance le travail en arrière-plan et rend la main tout de suite.
 *
 * C'est ce qui rend une recherche ou une génération indépendante du
 * navigateur : la requête qui la crée répond en quelques millisecondes, la
 * fonction continue en `waitUntil` jusqu'à 300 s. Aucun secret ni aller-retour
 * HTTP n'est nécessaire pour ce chemin. Au-delà du budget, un tick prend le
 * relais (JOBS_TICK_SECRET), puis pg_cron, puis le sondage de l'écran.
 */
export function driveInBackground(request: Request, jobId?: string | null): void {
  const base = baseUrl(request);
  waitUntil(
    (async () => {
      const pending = await drainJobs(createAdminClient(), { jobId });
      if (pending) await dispatchTick(base, {});
    })(),
  );
}

/**
 * Ce qui manque pour que les jobs tournent, en noms de variables seulement —
 * jamais leur valeur. Sert au diagnostic affiché par GET /api/jobs/health.
 */
export function missingSettings(env: Record<string, string | undefined> = process.env): string[] {
  return ["SUPABASE_SERVICE_ROLE", "JOBS_TICK_SECRET"].filter((name) => !env[name]);
}

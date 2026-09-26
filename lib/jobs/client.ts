import { ApiError, gatewayMessage, postJson } from "@/lib/enrichment/api-client";
import type { Job, JobTarget, JobType } from "./types";

/**
 * Accès navigateur aux jobs. Aucun import serveur : ce module est chargé par
 * la navbar et par les écrans Recherche et Prospection.
 */

/** Événement émis quand un écran lance un job : la navbar se rafraîchit aussitôt. */
export const JOBS_CHANGED = "orion:jobs-changed";

export function notifyJobsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOBS_CHANGED));
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new ApiError("Réseau indisponible. Vérifiez votre connexion.", 0);
  }
  const payload = (await response.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
  if (!response.ok) throw new ApiError(payload?.error ?? gatewayMessage(response.status), response.status, payload);
  return payload as T;
}

export async function startJob(type: JobType, target: JobTarget, params: Record<string, unknown>): Promise<string> {
  const { id } = await postJson<{ id: string }>("/api/jobs", { type, target, params });
  notifyJobsChanged();
  return id;
}

export interface JobSnapshot<T = unknown> {
  job: Job;
  /** Réponse complète, une fois le job terminé (brouillon, brief, faits...). */
  output?: T | null;
  /** Détails d'un refus que l'écran sait interpréter (`canForce`...). */
  details?: Record<string, unknown> | null;
}

export const fetchJob = <T = unknown>(id: string) => getJson<JobSnapshot<T>>(`/api/jobs/${id}`);

export const fetchActiveJobs = () => getJson<{ jobs: Job[] }>("/api/jobs?active=1").then((body) => body.jobs);

export const fetchProspectJobs = (prospectId: string) =>
  getJson<{ jobs: Job[] }>(`/api/jobs?prospectId=${encodeURIComponent(prospectId)}`).then((body) => body.jobs);

export const markJobSeen = (id: string) => postJson(`/api/jobs/${id}/seen`, {}).catch(() => undefined);

export const cancelJob = (id: string) => postJson(`/api/jobs/${id}/cancel`, {}).then(() => notifyJobsChanged());

export const isActive = (job: Pick<Job, "status">) => job.status === "queued" || job.status === "running";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Suit un job jusqu'à sa fin et rend son dernier état (avec `output`).
 *
 * `stopped()` permet à l'écran d'abandonner le suivi (changement de prospect,
 * démontage) : le JOB, lui, continue côté serveur — seul le regard s'en va.
 * Une coupure réseau n'interrompt pas le suivi, elle retarde le tour suivant.
 */
export async function watchJob<T = unknown>(
  id: string,
  options: { onUpdate?: (job: Job) => void; stopped?: () => boolean; intervalMs?: number } = {},
): Promise<JobSnapshot<T> | null> {
  const interval = options.intervalMs ?? 1_500;
  while (!options.stopped?.()) {
    try {
      const snapshot = await fetchJob<T>(id);
      if (options.stopped?.()) return null;
      options.onUpdate?.(snapshot.job);
      if (!isActive(snapshot.job)) return snapshot;
    } catch (error) {
      // Job introuvable : inutile d'insister. Réseau : on réessaie.
      if (error instanceof ApiError && error.status === 404) throw error;
    }
    await sleep(interval);
  }
  return null;
}

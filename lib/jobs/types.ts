import { z } from "zod";

/**
 * Contrat partagé des travaux de fond (table `jobs`).
 *
 * L'écran (liste des tâches, badges) se code sur ces types : ils ne changent
 * pas sans prévenir. Les colonnes internes à l'exécuteur (`step`, `state`)
 * sont typées à part, dans `JobRow`.
 */

export const JOB_TYPES = [
  "search_criteria",
  "search_signals",
  "signal_funnel",
  "email_generate",
  "email_rewrite",
  "reanalyze",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Un job terminé, quelle qu'en soit l'issue. */
export const TERMINAL_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled"];
export const isTerminal = (status: JobStatus) => TERMINAL_STATUSES.includes(status);

export interface JobTarget {
  prospectId?: string;
  /** Ce que l'écran affiche : « Recherche Lyon · 10-49 », « Mail ACME ». */
  label: string;
}

export interface JobCounts {
  scanned: number;
  signals: number;
  sheets: number;
}

export interface JobProgress {
  /** Étape en clair, déjà rédigée pour l'écran. */
  step: string;
  /** 0 à 100. */
  pct: number;
  counts: JobCounts;
}

export interface JobResult {
  prospectIds?: string[];
  messageId?: string;
  /** Recherches : la ligne `search_runs` qui porte les entreprises trouvées. */
  runId?: string;
}

export interface Job {
  id: string;
  user_id: string;
  type: JobType;
  target: JobTarget;
  params: Record<string, unknown>;
  status: JobStatus;
  progress: JobProgress;
  result: JobResult;
  error: string | null;
  attempts: number;
  locked_until: string | null;
  seen_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** La ligne complète, telle que l'exécuteur la lit. */
export interface JobRow extends Job {
  /** Index de la prochaine étape. */
  step: number;
  /** Point de reprise entre deux étapes. */
  state: Record<string, unknown>;
}

/** Colonnes rendues à l'écran : jamais `state` (brouillons, contacts...). */
export const PUBLIC_COLUMNS =
  "id, user_id, type, target, params, status, progress, result, error, attempts, locked_until, seen_at, created_at, started_at, finished_at";

/** Jobs `running` simultanés par utilisateur ; les suivants attendent. */
export const MAX_RUNNING_PER_USER = 3;
/** Une tentative + deux reprises par étape. */
export const MAX_ATTEMPTS = 3;
/**
 * Bail d'une étape, en secondes. Plus long que la durée maximale d'une
 * fonction (300 s sur Hobby) : un bail expiré signifie donc à coup sûr que la
 * fonction est morte, et que le job peut être repris sans doublon.
 */
export const LEASE_SECONDS = 315;

export const EMPTY_PROGRESS: JobProgress = {
  step: "En file d'attente",
  pct: 0,
  counts: { scanned: 0, signals: 0, sheets: 0 },
};

export const CREATE_JOB_SCHEMA = z.object({
  type: z.enum(JOB_TYPES),
  target: z.object({
    prospectId: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(160),
  }),
  params: z.record(z.unknown()).default({}),
});
export type CreateJobInput = z.infer<typeof CREATE_JOB_SCHEMA>;

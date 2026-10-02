import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_PROGRESS,
  LEASE_SECONDS,
  MAX_RUNNING_PER_USER,
  PUBLIC_COLUMNS,
  type CreateJobInput,
  type Job,
  type JobProgress,
  type JobResult,
  type JobRow,
} from "./types";

/**
 * Seule porte d'entrée vers la table `jobs`.
 *
 * La table n'est pas (encore) dans le `Database` de types.ts, partagé avec
 * d'autres chantiers : on passe par un client non typé ici, et les types de
 * lib/jobs/types.ts font foi.
 */

type Loose = SupabaseClient<any, "public", any>;
const jobs = (db: unknown) => (db as Loose).from("jobs");

/** Création, côté utilisateur (RLS : `user_id` = auth.uid() par défaut). */
export async function createJob(
  db: unknown,
  input: CreateJobInput,
  /** Client service_role (préparation automatique) : `auth.uid()` y est nul. */
  userId?: string,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await jobs(db)
    .insert({
      ...(userId ? { user_id: userId } : {}),
      type: input.type,
      target: input.target,
      params: input.params,
      status: "queued",
      progress: EMPTY_PROGRESS,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "création impossible" };
  return { id: (data as { id: string }).id };
}

export async function getJob(db: unknown, id: string): Promise<Job | null> {
  const { data } = await jobs(db).select(PUBLIC_COLUMNS).eq("id", id).maybeSingle();
  return (data as Job | null) ?? null;
}

export async function getJobRow(db: unknown, id: string): Promise<JobRow | null> {
  const { data } = await jobs(db).select("*").eq("id", id).maybeSingle();
  return (data as JobRow | null) ?? null;
}

/** Jobs en file ou en cours, plus les terminés que l'écran n'a pas encore montrés. */
export async function listActiveJobs(db: unknown): Promise<Job[]> {
  const { data } = await jobs(db)
    .select(PUBLIC_COLUMNS)
    .or("status.in.(queued,running),seen_at.is.null")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data as Job[] | null) ?? [];
}

/**
 * Derniers jobs de mail d'un prospect : l'écran Prospection s'en sert pour
 * reprendre une génération en cours, ou réafficher la dernière terminée.
 */
export async function listProspectJobs(db: unknown, prospectId: string, limit = 5): Promise<Job[]> {
  const { data } = await jobs(db)
    .select(PUBLIC_COLUMNS)
    .in("type", ["email_generate", "email_rewrite"])
    .eq("target->>prospectId", prospectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Job[] | null) ?? [];
}

/**
 * Ce qu'un job terminé a produit, pour l'écran qui l'a lancé : la réponse
 * complète d'un mail (brief, faits, brouillon) ou les détails d'un refus
 * (`needsFeeding`, `canForce`). Jamais le reste de `state`.
 */
export async function getJobOutput(
  db: unknown,
  id: string,
): Promise<{ output: unknown; details: Record<string, unknown> | null } | null> {
  const { data } = await jobs(db).select("state").eq("id", id).maybeSingle();
  if (!data) return null;
  const state = ((data as { state: Record<string, unknown> | null }).state ?? {}) as Record<string, unknown>;
  const details = state.httpDetails && typeof state.httpDetails === "object" ? (state.httpDetails as Record<string, unknown>) : null;
  return { output: state.response ?? null, details };
}

export async function listRecentJobs(db: unknown, limit = 20): Promise<Job[]> {
  const { data } = await jobs(db)
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Job[] | null) ?? [];
}

/** Annule un job non terminé. Rend la ligne annulée, ou null si déjà close. */
export async function cancelJob(db: unknown, id: string): Promise<JobRow | null> {
  const { data } = await jobs(db)
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      locked_until: null,
      progress: { ...EMPTY_PROGRESS, step: "Annulé" },
    })
    .eq("id", id)
    .in("status", ["queued", "running"])
    .select("*")
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function markSeen(db: unknown, id: string): Promise<void> {
  await jobs(db).update({ seen_at: new Date().toISOString() }).eq("id", id);
}

/** Un job encore vivant (en file ou en cours) pilote-t-il ce scan ? */
export async function hasLiveJobForRun(db: unknown, runId: string): Promise<boolean> {
  const { data } = await jobs(db)
    .select("id")
    .in("status", ["queued", "running"])
    .or(`params->>runId.eq.${runId},result->>runId.eq.${runId}`)
    .limit(1);
  return Boolean(data?.length);
}

/** Existe-t-il un job qu'un tick pourrait prendre maintenant ? */
export async function hasClaimableJob(db: unknown): Promise<boolean> {
  const { data } = await jobs(db)
    .select("id")
    .in("status", ["queued", "running"])
    .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`)
    .limit(1);
  return Boolean(data?.length);
}

// --- Exécuteur (client service_role) ----------------------------------------

/** Prend une étape sous verrou (fonction SQL `claim_job`). */
export async function claimJob(admin: unknown, jobId?: string | null): Promise<JobRow | null> {
  const { data, error } = await (admin as Loose).rpc("claim_job", {
    p_job_id: jobId ?? null,
    p_lease_seconds: LEASE_SECONDS,
    p_max_running: MAX_RUNNING_PER_USER,
  });
  if (error) throw new Error(`claim_job : ${error.message}`);
  const rows = (data as JobRow[] | null) ?? [];
  return rows[0] ?? null;
}

/**
 * Écrit l'issue d'une étape. Conditionnée à `status = running` : un job
 * annulé pendant l'étape reste annulé, l'écriture tardive ne le ressuscite pas.
 */
export async function commitStep(
  admin: unknown,
  id: string,
  patch: {
    step?: number;
    state?: Record<string, unknown>;
    progress?: JobProgress;
    result?: JobResult;
    status?: "running" | "done" | "failed";
    error?: string | null;
    attempts?: number;
  },
): Promise<boolean> {
  const terminal = patch.status === "done" || patch.status === "failed";
  const { data } = await jobs(admin)
    .update({
      ...patch,
      locked_until: null,
      ...(terminal ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq("id", id)
    .eq("status", "running")
    .select("id");
  return Boolean(data?.length);
}

/** Avancement en cours d'étape : ne touche ni au bail ni au statut. */
export async function writeProgress(admin: unknown, id: string, progress: JobProgress): Promise<void> {
  await jobs(admin).update({ progress }).eq("id", id).eq("status", "running");
}

export async function readStatus(admin: unknown, id: string): Promise<string | null> {
  const { data } = await jobs(admin).select("status").eq("id", id).maybeSingle();
  return (data as { status: string } | null)?.status ?? null;
}

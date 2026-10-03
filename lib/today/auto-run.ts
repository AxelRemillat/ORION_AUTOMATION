import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanPrefs, DEFAULT_PREFS } from "@/lib/funnel/settings";
import { utcToParis } from "@/lib/outbox/paris-time";
import { createJob } from "@/lib/jobs/store";
import type { Database } from "@/types";

/**
 * Préparation automatique du matin.
 *
 * Le tick pg_cron (chaque minute) appelle `startDueAutoRuns`. Une préparation
 * part quand l'interrupteur est actif, que l'heure réglée (Paris) est passée et
 * qu'aucune n'a encore tourné aujourd'hui. Le verrou est la mise à jour
 * CONDITIONNELLE de `last_auto_run_on` : deux ticks simultanés ne lancent
 * qu'un seul run. Un serveur muet à 5 h rattrape le run au tick suivant.
 */

type Db = SupabaseClient<Database>;
type Loose = SupabaseClient<any, "public", any>;

export const PREPARE_LABEL = "Préparation du jour";

/**
 * Code pur : la préparation de ce jour est-elle due ?
 *
 * Du lundi au vendredi seulement (heure de Paris) : rien à préparer le week-end,
 * où rien ne part. « Lancer maintenant » (`enqueuePrepare`, déclenchement
 * manuel) reste possible tous les jours.
 */
export function autoRunDue(input: { daily: boolean; autoHour: number; lastRunOn: string | null; now: Date }): boolean {
  if (!input.daily) return false;
  const { date, time, weekday } = utcToParis(input.now);
  if (weekday === 0 || weekday === 6) return false;
  if (input.lastRunOn && input.lastRunOn >= date) return false;
  return Number(time.slice(0, 2)) >= input.autoHour;
}

/** Une préparation encore en file ou en cours, pour cet utilisateur ? */
export async function livePrepareJob(db: unknown, userId: string): Promise<string | null> {
  const { data } = await (db as Loose)
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "search_signals")
    .eq("params->>kind", "prepare")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Dernière préparation, telle que l'en-tête la résume (erreur comprise). */
export interface PrepareHealth {
  status: string;
  /** Erreur du job de préparation lui-même, s'il a échoué. */
  error: string | null;
  at: string;
  /** Brouillons (`email_generate`) lancés par cette préparation et tombés en échec. */
  failedDrafts: number;
  /** Arrêt propre sur plafond (OpenAI) : le motif, tel que le job l'a écrit. */
  stoppedReason?: string | null;
  firstDraftError: string | null;
}

/** Code pur : la ligne d'alerte de l'en-tête, `null` si tout va bien. */
export function prepareAlert(health: PrepareHealth | null): string | null {
  if (!health) return null;
  if (health.status === "failed") return `Dernière préparation en échec : ${health.error ?? "erreur inconnue"}`;
  if (health.stoppedReason) return `Dernière préparation arrêtée — ${health.stoppedReason}`;
  if (health.failedDrafts > 0) {
    return `${health.failedDrafts} brouillon(s) non rédigé(s)${health.firstDraftError ? ` : ${health.firstDraftError}` : ""}`;
  }
  return null;
}

export async function lastPrepareHealth(db: unknown, userId: string): Promise<PrepareHealth | null> {
  const loose = db as Loose;
  const { data } = await loose
    .from("jobs")
    .select("status, error, created_at, finished_at, progress")
    .eq("user_id", userId)
    .eq("type", "search_signals")
    .eq("params->>kind", "prepare")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = data as { status: string; error: string | null; created_at: string; finished_at: string | null; progress?: { step?: string } | null } | null;
  if (!job) return null;
  const { data: drafts } = await loose
    .from("jobs")
    .select("error")
    .eq("user_id", userId)
    .eq("type", "email_generate")
    .eq("status", "failed")
    .gte("created_at", job.created_at);
  const failed = (drafts ?? []) as { error: string | null }[];
  return {
    status: job.status,
    error: job.error,
    at: job.finished_at ?? job.created_at,
    failedDrafts: failed.length,
    firstDraftError: failed.find((row) => row.error)?.error ?? null,
    stoppedReason: job.progress?.step?.startsWith("Plafond") ? job.progress.step : null,
  };
}

/** Crée le job de préparation (client service_role : `userId` explicite). */
export async function enqueuePrepare(db: unknown, userId: string, digLimit: number, trigger: "auto" | "manuel") {
  return createJob(
    db,
    { type: "search_signals", target: { label: PREPARE_LABEL }, params: { kind: "prepare", digLimit, trigger } },
    userId,
  );
}

export async function startDueAutoRuns(admin: Db, now = new Date()): Promise<number> {
  const { data } = await admin.from("funnel_settings").select("*").eq("daily", true);
  const today = utcToParis(now).date;
  let started = 0;
  for (const row of data ?? []) {
    const prefs = cleanPrefs({ autoHour: row.auto_hour, dailyTarget: row.daily_target, daily: row.daily }, DEFAULT_PREFS);
    if (!autoRunDue({ daily: prefs.daily, autoHour: prefs.autoHour, lastRunOn: row.last_auto_run_on ?? null, now })) continue;
    // Verrou : seul le premier tick qui fait passer la date lance le run.
    const { data: locked } = await admin
      .from("funnel_settings")
      .update({ last_auto_run_on: today })
      .eq("user_id", row.user_id)
      .or(`last_auto_run_on.is.null,last_auto_run_on.lt.${today}`)
      .select("user_id");
    if (!locked?.length) continue;
    if (await livePrepareJob(admin, row.user_id)) continue;
    const created = await enqueuePrepare(admin, row.user_id, prefs.dailyTarget, "auto");
    if ("id" in created) started += 1;
    else console.error(`[aujourdhui] préparation non lancée : ${created.error}`);
  }
  return started;
}

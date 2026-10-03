import type { ProspectStatus } from "@/types";
import { purgeCutoff } from "./retention";
import type { Db } from "./scope";

/**
 * Opérations de corbeille. Chacune reçoit le client Supabase à utiliser :
 *   - client de session (RLS) depuis l'app — l'utilisateur ne touche qu'à ses
 *     propres lignes ;
 *   - client service_role depuis le cron, qui purge tous les comptes.
 *
 * Toutes sont idempotentes : rejouées, elles ne font rien de plus.
 */

export type TrashResult = { ok: true; count: number } | { ok: false; error: string };

/** Met un prospect à la corbeille en mémorisant son statut. */
export async function moveToTrash(db: Db, prospectId: string, now = new Date()): Promise<TrashResult> {
  const { data, error } = await db
    .from("prospects")
    .select("id, status")
    .eq("id", prospectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, count: 0 };

  const update = await db
    .from("prospects")
    .update({ deleted_at: now.toISOString(), status_before_delete: data.status })
    .eq("id", prospectId)
    .is("deleted_at", null);
  return update.error ? { ok: false, error: update.error.message } : { ok: true, count: 1 };
}

/** Restaure un prospect, au statut exact qu'il avait avant la corbeille. */
export async function restoreFromTrash(db: Db, prospectId: string): Promise<TrashResult> {
  const { data, error } = await db
    .from("prospects")
    .select("id, status, status_before_delete")
    .eq("id", prospectId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, count: 0 };

  const status = (data.status_before_delete ?? data.status) as ProspectStatus;
  const update = await db
    .from("prospects")
    .update({ deleted_at: null, status_before_delete: null, status })
    .eq("id", prospectId);
  return update.error ? { ok: false, error: update.error.message } : { ok: true, count: 1 };
}

interface Doomed {
  id: string;
  user_id: string;
  siren: string | null;
  company_name: string;
}

/** Raison lisible dans l'onglet « Exclus » : la table ne garde que le SIREN. */
const exclusionReason = (name: string) => `« ${name} », supprimé définitivement depuis la corbeille`;

/**
 * Suppression définitive de prospects DÉJÀ à la corbeille, avec leurs données.
 *
 * Ordre choisi pour qu'une interruption ne laisse jamais de trou :
 *   1. le SIREN entre d'abord dans `excluded_companies` ;
 *   2. les données sans clé étrangère vers le prospect (états d'action,
 *      favoris, emails reçus) sont supprimées ;
 *   3. le prospect est supprimé : messages, deals et relances suivent par
 *      `on delete cascade`, le brief est une colonne du prospect.
 * Rejouée après une panne, la purge reprend là où elle s'était arrêtée.
 */
export async function purgeProspects(db: Db, doomed: readonly Doomed[]): Promise<TrashResult> {
  if (!doomed.length) return { ok: true, count: 0 };
  const ids = doomed.map((row) => row.id);

  const exclusions = doomed
    .filter((row) => row.siren)
    .map((row) => ({ user_id: row.user_id, siren: row.siren as string, reason: exclusionReason(row.company_name) }));
  if (exclusions.length) {
    const { error } = await db
      .from("excluded_companies")
      .upsert(exclusions, { onConflict: "user_id,siren", ignoreDuplicates: true });
    if (error) return { ok: false, error: `exclusion du SIREN : ${error.message}` };
  }

  // Anciens états d'action du Cockpit (file retirée le 03/10/2026) : nettoyés avec ces lignes.
  const [reminders, messages, inbound] = await Promise.all([
    db.from("reminders").select("id").in("prospect_id", ids),
    db.from("messages").select("id").in("prospect_id", ids),
    db.from("inbound_messages").select("id").in("prospect_id", ids),
  ]);
  const actionIds = [
    ...ids.map((id) => `approche-${id}`),
    ...(reminders.data ?? []).map((row) => `relance-${row.id}`),
    ...(messages.data ?? []).map((row) => `brouillon-${row.id}`),
    ...(inbound.data ?? []).map((row) => `reponse-${row.id}`),
  ];

  const steps = await Promise.all([
    db.from("action_states").delete().in("action_id", actionIds),
    db.from("inbound_messages").delete().in("prospect_id", ids),
    ...groupSirensByUser(doomed).map(([userId, sirens]) =>
      db.from("favorites").delete().eq("user_id", userId).in("siren", sirens),
    ),
  ]);
  const failed = steps.find((step) => step.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  const { data, error } = await db
    .from("prospects")
    .delete()
    .in("id", ids)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

function groupSirensByUser(doomed: readonly Doomed[]): [string, string[]][] {
  const byUser = new Map<string, string[]>();
  for (const row of doomed) {
    if (!row.siren) continue;
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.siren]);
  }
  return [...byUser];
}

/** Suppression définitive d'UN prospect de la corbeille (bouton de /corbeille). */
export async function deleteForever(db: Db, prospectId: string): Promise<TrashResult> {
  const { data, error } = await db
    .from("prospects")
    .select("id, user_id, siren, company_name")
    .eq("id", prospectId)
    .not("deleted_at", "is", null);
  if (error) return { ok: false, error: error.message };
  return purgeProspects(db, data ?? []);
}

/** Purge tout ce qui dort à la corbeille depuis plus de 14 jours. */
export async function purgeExpired(db: Db, now = new Date()): Promise<TrashResult> {
  const { data, error } = await db
    .from("prospects")
    .select("id, user_id, siren, company_name")
    .not("deleted_at", "is", null)
    .lt("deleted_at", purgeCutoff(now));
  if (error) return { ok: false, error: error.message };
  return purgeProspects(db, data ?? []);
}

/** « Autoriser à nouveau » : le SIREN peut revenir dans la recherche. */
export async function allowAgain(db: Db, siren: string): Promise<TrashResult> {
  const { data, error } = await db.from("excluded_companies").delete().eq("siren", siren).select("siren");
  return error ? { ok: false, error: error.message } : { ok: true, count: data?.length ?? 0 };
}

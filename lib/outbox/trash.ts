import { purgeCutoff } from "@/lib/trash/retention";
import type { Db } from "@/lib/trash/scope";
import type { Message } from "@/types";

/**
 * Corbeille des MAILS — même contrat que celle des prospects (lib/trash) :
 * masqué partout, restaurable à l'identique pendant 14 jours, puis purgé par
 * le même cron. Un mail envoyé n'y va jamais : c'est l'historique de l'affaire.
 *
 * Un mail programmé mis à la corbeille est annulé (`cancelled`) : il ne peut
 * plus partir, et redevient un simple brouillon s'il est restauré.
 */

export type MessageTrashResult = { ok: true; count: number } | { ok: false; error: string };

const SENT_ERROR = "Un mail envoyé reste dans l'historique : il ne peut pas aller à la corbeille.";
const SENDING_ERROR = "Ce mail est en cours d'envoi : attendez la fin de l'envoi.";

export async function trashMessage(db: Db, messageId: string, now = new Date()): Promise<MessageTrashResult> {
  const { data, error } = await db
    .from("messages")
    .select("id, status, send_status, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row = data as Pick<Message, "status" | "send_status" | "deleted_at"> | null;
  if (!row) return { ok: false, error: "Mail introuvable." };
  if (row.deleted_at) return { ok: true, count: 0 };
  if (row.status === "sent" || row.send_status === "sent") return { ok: false, error: SENT_ERROR };
  if (row.send_status === "sending") return { ok: false, error: SENDING_ERROR };

  // Conditionnelle : si un tick vient de le prendre, rien n'est touché.
  const { data: updated, error: updateError } = await db
    .from("messages")
    .update({
      deleted_at: now.toISOString(),
      ...(row.send_status === "scheduled" ? { send_status: "cancelled" as const } : {}),
    })
    .eq("id", messageId)
    .eq("status", "draft")
    .eq("send_status", row.send_status ?? "draft")
    .is("deleted_at", null)
    .select("id");
  if (updateError) return { ok: false, error: updateError.message };
  return updated?.length ? { ok: true, count: 1 } : { ok: false, error: SENDING_ERROR };
}

/** Restaure un mail ; un programmé annulé revient en brouillon (l'heure est passée ou à revoir). */
export async function restoreMessage(db: Db, messageId: string): Promise<MessageTrashResult> {
  const { data, error } = await db
    .from("messages")
    .select("id, send_status")
    .eq("id", messageId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, count: 0 };
  const cancelled = (data as Pick<Message, "send_status">).send_status === "cancelled";
  const update = await db
    .from("messages")
    .update({ deleted_at: null, ...(cancelled ? { send_status: "draft" as const, scheduled_at: null } : {}) })
    .eq("id", messageId);
  return update.error ? { ok: false, error: update.error.message } : { ok: true, count: 1 };
}

/** Supprime des mails DÉJÀ à la corbeille, et l'état de leurs actions Cockpit. */
async function purge(db: Db, ids: string[]): Promise<MessageTrashResult> {
  if (!ids.length) return { ok: true, count: 0 };
  // Anciens états d'action du Cockpit (file retirée le 03/10/2026) : nettoyés avec ces lignes.
  await db.from("action_states").delete().in("action_id", ids.map((id) => `brouillon-${id}`));
  const { data, error } = await db
    .from("messages")
    .delete()
    .in("id", ids)
    .not("deleted_at", "is", null)
    .neq("status", "sent")
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

export async function deleteMessageForever(db: Db, messageId: string): Promise<MessageTrashResult> {
  return purge(db, [messageId]);
}

/** Purge des mails à la corbeille depuis plus de 14 jours (même cron que les prospects). */
export async function purgeExpiredMessages(db: Db, now = new Date()): Promise<MessageTrashResult> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deleted_at", purgeCutoff(now));
  if (error) return { ok: false, error: error.message };
  return purge(db, ((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** Mails à la corbeille, les plus récents d'abord, avec le nom de leur prospect. */
export async function trashedMessages(db: Db) {
  const { data } = await db
    .from("messages")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  const messages = (data ?? []) as Message[];
  const ids = [...new Set(messages.map((message) => message.prospect_id))];
  const { data: prospects } = ids.length
    ? await db.from("prospects").select("id, company_name, deleted_at").in("id", ids)
    : { data: [] };
  const byId = new Map(
    ((prospects ?? []) as { id: string; company_name: string; deleted_at?: string | null }[]).map((row) => [row.id, row]),
  );
  return messages.map((message) => ({
    message,
    companyName: byId.get(message.prospect_id)?.company_name ?? "Prospect supprimé",
    prospectTrashed: Boolean(byId.get(message.prospect_id)?.deleted_at),
  }));
}

export type TrashedMessage = Awaited<ReturnType<typeof trashedMessages>>[number];

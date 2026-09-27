import { purgeCutoff } from "@/lib/trash/retention";
import type { Db } from "@/lib/trash/scope";
import type { InboundMessage } from "@/types";

/**
 * Corbeille des mails REÇUS — même contrat que les mails envoyés
 * (lib/outbox/trash.ts) : masqué partout (Cockpit, actions du jour,
 * compteurs), restaurable 14 jours, puis purgé par le même cron.
 */

export type InboundTrashResult = { ok: true; count: number } | { ok: false; error: string };

export async function trashInbound(db: Db, inboundId: string, now = new Date()): Promise<InboundTrashResult> {
  const { data, error } = await db
    .from("inbound_messages")
    .update({ deleted_at: now.toISOString() })
    .eq("id", inboundId)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

export async function restoreInbound(db: Db, inboundId: string): Promise<InboundTrashResult> {
  const { data, error } = await db
    .from("inbound_messages")
    .update({ deleted_at: null })
    .eq("id", inboundId)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

/** Supprime des mails reçus DÉJÀ à la corbeille, et l'état de leurs actions Cockpit. */
async function purge(db: Db, ids: string[]): Promise<InboundTrashResult> {
  if (!ids.length) return { ok: true, count: 0 };
  await db.from("action_states").delete().in("action_id", ids.map((id) => `reponse-${id}`));
  const { data, error } = await db
    .from("inbound_messages")
    .delete()
    .in("id", ids)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

export const deleteInboundForever = (db: Db, inboundId: string) => purge(db, [inboundId]);

/** Purge des mails reçus à la corbeille depuis plus de 14 jours. */
export async function purgeExpiredInbound(db: Db, now = new Date()): Promise<InboundTrashResult> {
  const { data, error } = await db
    .from("inbound_messages")
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deleted_at", purgeCutoff(now));
  if (error) return { ok: false, error: error.message };
  return purge(db, ((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** Mails reçus à la corbeille, les plus récents d'abord. */
export async function trashedInbound(db: Db): Promise<InboundMessage[]> {
  const { data } = await db
    .from("inbound_messages")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  return (data ?? []) as InboundMessage[];
}

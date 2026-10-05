import type { Db } from "@/lib/trash/scope";
import type { MessageType } from "@/types";
import { isProspectReply } from "@/lib/inbound/auto-reply";

/**
 * Relances et réponses : une relance ne part JAMAIS vers quelqu'un qui a
 * répondu. Deux verrous :
 *   1. à la réception (/api/inbound) : les relances programmées du prospect
 *      redeviennent des brouillons, motif à l'appui, et ses rappels sont soldés ;
 *   2. au départ (règles d'envoi) : une réponse reçue depuis le dernier mail
 *      parti refuse la relance, même si le 1. a été manqué.
 */

export const RELANCE_TYPES: readonly MessageType[] = ["relance_1", "relance_2"];

const day = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(iso));

export const replyCancelReason = (receivedAt: string) => `Relance annulée : le prospect a répondu le ${day(receivedAt)}.`;

/** Annule les relances programmées (ou bloquées) d'un prospect qui vient de répondre. */
export async function cancelRelancesOnReply(
  db: Db,
  input: { userId: string; prospectId: string; receivedAt: string },
): Promise<number> {
  const { data } = await db
    .from("messages")
    .update({ send_status: "draft", scheduled_at: null, send_error: replyCancelReason(input.receivedAt), send_attempts: 0 })
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospectId)
    .eq("status", "draft")
    .in("type", [...RELANCE_TYPES])
    .in("send_status", ["scheduled", "blocked", "failed"])
    .select("id");
  // Plus rien à relancer : les rappels ouverts sont soldés.
  await db
    .from("reminders")
    .update({ done: true })
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospectId)
    .eq("done", false);
  return data?.length ?? 0;
}

/** Date de la réponse reçue depuis le dernier mail parti, ou `null`. */
export async function replySinceLastSend(db: Db, userId: string, prospectId: string): Promise<string | null> {
  const { data: sent } = await db
    .from("messages")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("prospect_id", prospectId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1);
  const lastSent = (sent?.[0] as { sent_at?: string | null } | undefined)?.sent_at ?? null;
  if (!lastSent) return null;
  const { data: replies } = await db
    .from("inbound_messages")
    .select("received_at, from_email, subject, body")
    .eq("user_id", userId)
    .eq("prospect_id", prospectId)
    .is("deleted_at", null)
    .gte("received_at", lastSent)
    .order("received_at", { ascending: false })
    .limit(20);
  // Une réponse automatique (anti-spam, absence) n'arrête pas les relances.
  const rows = (replies ?? []) as { received_at: string; from_email: string; subject?: string | null; body?: string | null }[];
  return rows.find((row) => isProspectReply(row))?.received_at ?? null;
}

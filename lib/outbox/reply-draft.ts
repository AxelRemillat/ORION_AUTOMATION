import type { Db } from "@/lib/trash/scope";
import type { InboundMessage, Message } from "@/types";

/**
 * Brouillon de réponse à un mail reçu, enregistré dans `messages` :
 * type `reponse`, rattaché au mail reçu (`reply_to_inbound_id`) et à son fil
 * Gmail (`thread_id`, `reply_to_gmail_message_id`). Un seul brouillon vivant
 * par mail reçu : on le réécrit plutôt que d'en empiler.
 *
 * C'est ce qui permet de le programmer (même chemin que tout mail), de le
 * mettre à la corbeille, ou de le retrouver en revenant sur l'écran.
 */

export type ReplyDraft = Pick<
  Message,
  "id" | "subject" | "body" | "send_status" | "scheduled_at" | "scheduled_to" | "send_error"
>;

export type ReplyDraftResult = { ok: true; messageId: string } | { ok: false; error: string };

const COLUMNS = "id, subject, body, send_status, scheduled_at, scheduled_to, send_error";

/** Le brouillon de réponse en cours (non envoyé, hors corbeille), s'il existe. */
export async function currentReplyDraft(db: Db, inboundId: string): Promise<ReplyDraft | null> {
  const { data } = await db
    .from("messages")
    .select(COLUMNS)
    .eq("reply_to_inbound_id", inboundId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ReplyDraft | null) ?? null;
}

export async function saveReplyDraft(
  db: Db,
  input: { userId: string; inboundId: string; subject: string; body: string },
): Promise<ReplyDraftResult> {
  if (!input.body.trim()) return { ok: false, error: "Le message est vide." };

  const { data } = await db
    .from("inbound_messages")
    .select("id, prospect_id, thread_id, gmail_message_id")
    .eq("id", input.inboundId)
    .is("deleted_at", null)
    .maybeSingle();
  const inbound = data as Pick<InboundMessage, "id" | "prospect_id" | "thread_id" | "gmail_message_id"> | null;
  if (!inbound) return { ok: false, error: "Mail reçu introuvable ou à la corbeille." };
  if (!inbound.prospect_id) return { ok: false, error: "Expéditeur non rattaché à un prospect : réponse impossible ici." };

  const content = { subject: input.subject.trim() || null, body: input.body.trim() };
  const existing = await currentReplyDraft(db, inbound.id);
  if (existing) {
    // Un mail en cours d'envoi ne se réécrit plus.
    const { data: updated, error } = await db
      .from("messages")
      .update(content)
      .eq("id", existing.id)
      .eq("status", "draft")
      .neq("send_status", "sending")
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!updated?.length) return { ok: false, error: "Ce brouillon est en cours d'envoi." };
    return { ok: true, messageId: existing.id };
  }

  const { data: inserted, error } = await db
    .from("messages")
    .insert({
      prospect_id: inbound.prospect_id,
      user_id: input.userId,
      type: "reponse",
      status: "draft",
      send_status: "draft",
      thread_id: inbound.thread_id,
      reply_to_inbound_id: inbound.id,
      reply_to_gmail_message_id: inbound.gmail_message_id ?? null,
      ...content,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Brouillon non enregistré." };
  return { ok: true, messageId: (inserted as { id: string }).id };
}

import { recordProspectEvent } from "@/lib/history/record";
import { isBounce } from "@/lib/settings/volumes";
import type { Db } from "@/lib/trash/scope";
import { scheduleMessage } from "./scheduler";
import { readableSendError } from "./send-errors";
import { checkSendRules, MESSAGE_COLUMNS, sendNow, type OutboxMessage, type SendDeps, type SendResult } from "./send";

/**
 * « Renvoyer » un mail en ÉCHEC — action MANUELLE uniquement (jamais d'envoi
 * automatique). Le même contenu (objet, corps, destinataire, prospect) repart
 * dans le circuit normal : immédiatement (`sendNow`, mêmes contrôles qu'un envoi
 * manuel) ou programmé (`scheduleMessage`).
 *
 * Garde-fous, avant de toucher à quoi que ce soit :
 *   - le mail est bien en échec, en brouillon, pas à la corbeille ;
 *   - AUCUN identifiant d'envoi Gmail (anti-doublon : un mail qui en a un est parti) ;
 *   - le prospect n'est ni opposé, ni « ne plus contacter », ni « non joignable »,
 *     et n'a pas répondu « stop » (les règles d'envoi revérifient le reste).
 * L'échec est écrit dans l'historique de la fiche AVANT la remise à zéro du
 * compteur de tentatives.
 */

export type PrepareResult = { ok: true; messageId: string; prospectId: string; to: string | null } | { ok: false; error: string };

const STOP = /^\s*stop\b/i;

export async function prepareResend(db: Db, input: { userId: string; messageId: string; now?: Date }): Promise<PrepareResult> {
  const { data } = await db
    .from("messages")
    .select("id, prospect_id, user_id, type, status, send_status, send_error, send_attempts, scheduled_to, gmail_message_id, deleted_at")
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const message = data as {
    id: string; prospect_id: string; type: string; status: string; send_status: string | null; send_error: string | null;
    send_attempts: number | null; scheduled_to: string | null; gmail_message_id: string | null; deleted_at: string | null;
  } | null;
  if (!message || message.deleted_at) return { ok: false, error: "Mail introuvable ou à la corbeille." };
  if (message.gmail_message_id) return { ok: false, error: "Ce mail a déjà un identifiant d'envoi Gmail : il est parti, pas de renvoi (anti-doublon)." };
  if (message.status === "sent") return { ok: false, error: "Ce mail est déjà envoyé." };
  if (message.send_status !== "failed") return { ok: false, error: "Seul un mail en échec peut être renvoyé." };

  const { data: prospect } = await db
    .from("prospects")
    .select("id, do_not_contact, key_figures, deleted_at")
    .eq("id", message.prospect_id)
    .eq("user_id", input.userId)
    .maybeSingle();
  const row = prospect as { do_not_contact?: boolean; key_figures?: Record<string, unknown> | null; deleted_at?: string | null } | null;
  if (!row || row.deleted_at) return { ok: false, error: "Fiche introuvable ou à la corbeille." };
  if (row.key_figures?.refuses_prospecting === true) return { ok: false, error: "Prospect opposé à la prospection : renvoi refusé." };
  if (row.do_not_contact) return { ok: false, error: "Prospect « ne plus contacter » : renvoi refusé." };
  if (row.key_figures?.unreachable) return { ok: false, error: "Prospect « non joignable » : renvoi refusé." };

  const { data: inbound } = await db
    .from("inbound_messages")
    .select("from_email, subject, body, category")
    .eq("prospect_id", message.prospect_id)
    .is("deleted_at", null);
  const replies = (inbound ?? []) as { from_email: string; subject?: string | null; body?: string | null; category?: string | null }[];
  if (replies.some((reply) => !isBounce(reply) && (reply.category === "refus" || STOP.test(reply.body ?? "") || STOP.test(reply.subject ?? "")))) {
    return { ok: false, error: "Le prospect a répondu « stop » : renvoi refusé." };
  }

  // Trace de l'échec dans l'historique, puis remise dans le circuit (tentatives à 0).
  await recordProspectEvent(db, {
    prospectId: message.prospect_id,
    userId: input.userId,
    kind: "send_failed",
    channel: "email",
    at: (input.now ?? new Date()).toISOString(),
    data: { title: "Envoi en échec, remis dans le circuit", detail: readableSendError(message.send_error), raw: message.send_error ?? null, attempts: message.send_attempts ?? 0, type: message.type },
  });
  const { data: reset } = await db
    .from("messages")
    .update({ send_status: "draft", send_attempts: 0, send_error: null, scheduled_at: null, send_started_at: null })
    .eq("id", message.id)
    .eq("user_id", input.userId)
    .eq("send_status", "failed")
    .is("gmail_message_id", null)
    .select("id");
  if (!reset?.length) return { ok: false, error: "Ce mail vient de changer d'état : rechargez." };
  return { ok: true, messageId: message.id, prospectId: message.prospect_id, to: message.scheduled_to };
}

/**
 * Règles d'envoi vérifiées AVANT de toucher au mail : un renvoi refusé laisse
 * le mail en « Échec », tel quel (rien n'est remis à zéro pour rien).
 */
async function preflightResend(db: Db, userId: string, messageId: string, to: string, now: Date, ignoreDailyCap: boolean) {
  const { data } = await db.from("messages").select(MESSAGE_COLUMNS).eq("id", messageId).eq("user_id", userId).maybeSingle();
  if (!data) return { ok: false as const, error: "Mail introuvable." };
  const refused = await checkSendRules(db, data as unknown as OutboxMessage, to, now);
  if (refused && !refused.ok && !(ignoreDailyCap && refused.status === 429)) return { ok: false as const, error: refused.error };
  return null;
}

/** Renvoi immédiat : même destinataire que la tentative ratée (ou celui fourni). */
export async function resendNow(
  db: Db,
  input: { userId: string; messageId: string; to?: string | null },
  deps: SendDeps = {},
): Promise<SendResult | { ok: false; error: string }> {
  const { data: current } = await db.from("messages").select("scheduled_to").eq("id", input.messageId).eq("user_id", input.userId).maybeSingle();
  const to = input.to?.trim() || (current as { scheduled_to?: string | null } | null)?.scheduled_to || null;
  if (!to) return { ok: false, error: "Destinataire inconnu : utilisez « Programmer » pour le saisir." };
  const blocked = await preflightResend(db, input.userId, input.messageId, to, deps.now ?? new Date(), false);
  if (blocked) return blocked;
  const prepared = await prepareResend(db, { userId: input.userId, messageId: input.messageId, now: deps.now });
  if (!prepared.ok) return prepared;
  return sendNow(db, { userId: input.userId, messageId: prepared.messageId, prospectId: prepared.prospectId, to }, deps);
}

/** Renvoi programmé : mêmes règles que toute programmation. */
export async function resendLater(db: Db, input: { userId: string; messageId: string; to: string; at: Date }, now = new Date()) {
  // Le plafond du jour se juge au jour d'envoi : il n'empêche pas de programmer.
  const blocked = await preflightResend(db, input.userId, input.messageId, input.to, now, true);
  if (blocked) return blocked;
  const prepared = await prepareResend(db, { userId: input.userId, messageId: input.messageId, now });
  if (!prepared.ok) return prepared;
  return scheduleMessage(db, { userId: input.userId, messageId: prepared.messageId, to: input.to, at: input.at }, now);
}

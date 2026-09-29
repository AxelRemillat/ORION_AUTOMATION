import { advanceStatus } from "@/lib/constants";
import { TRASHED_ERROR, type Db } from "@/lib/trash/scope";
import type { Message, MessageType, ProspectStatus } from "@/types";
import { loadOffer } from "@/lib/offer/read";
import { signatureFor } from "@/lib/offer/model";
import { blockReason, normalizeSubject, preflight, type PreflightResult } from "@/lib/mail-preflight";
import { buildDeliverability } from "./deliverability";
import { RELANCE_TYPES, replySinceLastSend } from "./relances";

/**
 * LE chemin d'envoi d'un mail — manuel (/api/emails/send) comme programmé
 * (lib/outbox/scheduler.ts). Une seule suite de règles, un seul appel n8n, une
 * seule mise à jour d'état : un mail programmé ne peut rien faire qu'un envoi
 * manuel n'aurait pas fait.
 *
 * Le client passé peut être la session (RLS) ou service_role (tick, sans
 * cookie) : chaque requête filtre donc explicitement sur `user_id`.
 */

/** Délai avant la relance suivante, en jours, selon le message qui vient de partir. */
const NEXT_REMINDER_DAYS: Partial<Record<MessageType, number>> = {
  intro: 4,
  relance_1: 7,
};

/**
 * Statut visé après envoi. Le garde-fou est le RANG dans le pipeline
 * (`advanceStatus`) : un `intro` ne peut jamais dégrader un prospect gagné.
 */
const STATUS_AFTER_SEND: Partial<Record<MessageType, ProspectStatus>> = {
  intro: "contacte",
  relance_1: "relance_1",
  relance_2: "relance_2",
  reponse: "en_discussion",
};

export const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * `blocked` : une règle refuse l'envoi — le rejouer ne changerait rien.
 * `transient` : n8n injoignable ou en erreur — une reprise peut passer.
 * Le plafond du jour sort en `blocked` avec le statut 429 : il se juge au
 * moment de l'envoi, pas de la programmation.
 * `unrecorded` : le mail est PARTI mais son état n'a pas pu être écrit ; il ne
 * doit surtout pas être renvoyé.
 * `preflight` : le contrôle avant envoi (lib/mail-preflight) refuse le mail —
 * le tick le passe en `blocked`, motif visible dans « Programmés ».
 */
export type SendFailureKind = "invalid" | "blocked" | "preflight" | "conflict" | "config" | "transient" | "unrecorded";

export type SendResult =
  | {
      ok: true;
      messageId: string;
      sentAt: string;
      prospectStatus: ProspectStatus | null;
      reminderDueAt: string | null;
    }
  | { ok: false; kind: SendFailureKind; error: string; status: number };

export interface SendDeps {
  now?: Date;
  fetch?: typeof fetch;
  /** URL du webhook n8n ; lue dans l'environnement si absente. */
  webhookUrl?: string | null;
}

export type OutboxMessage = Pick<
  Message,
  "id" | "user_id" | "prospect_id" | "type" | "subject" | "body" | "status" | "thread_id"
> &
  Pick<Message, "deleted_at" | "send_status" | "reply_to_inbound_id" | "reply_to_gmail_message_id">;

const fail = (kind: SendFailureKind, error: string, status: number): SendResult => ({ ok: false, kind, error, status });

/** Règles communes : `null` si l'envoi est permis, sinon le refus à afficher. */
export async function checkSendRules(db: Db, message: OutboxMessage, to: unknown, now: Date): Promise<SendResult | null> {
  if (!isEmail(to)) return fail("invalid", "Destinataire invalide.", 400);
  if (message.status === "sent") return fail("conflict", "Ce message a déjà été envoyé.", 409);
  if (message.deleted_at) {
    return fail("blocked", "Ce mail est à la corbeille : restaurez-le depuis /corbeille pour l'envoyer.", 409);
  }

  const { data: prospect } = await db
    .from("prospects")
    .select("id, deleted_at, do_not_contact, email, key_figures, website")
    .eq("id", message.prospect_id)
    .eq("user_id", message.user_id)
    .maybeSingle();
  const row = prospect as ProspectForPreflight | null;
  if (!row || row.deleted_at) return fail("blocked", TRASHED_ERROR, 409);
  if (row.do_not_contact) {
    return fail("blocked", "Prospect marqué « ne plus contacter » : envoi refusé.", 409);
  }

  // Une relance ne part jamais vers quelqu'un qui a répondu.
  if (RELANCE_TYPES.includes(message.type)) {
    const replied = await replySinceLastSend(db, message.user_id, message.prospect_id);
    if (replied) return fail("preflight", `Relance refusée : le prospect a répondu (${replied.slice(0, 10)}).`, 422);
  }

  const check = await preflightFor(db, message, to, row);
  if (!check.ok) return fail("preflight", blockReason(check), 422);

  const { data: sent } = await db
    .from("messages")
    .select("status, sent_at")
    .eq("user_id", message.user_id)
    .eq("status", "sent");
  const cap = buildDeliverability((sent ?? []) as Pick<Message, "status" | "sent_at">[], now);
  if (cap.remaining <= 0) {
    return fail(
      "blocked",
      `Plafond d'envois du jour atteint (${cap.sentToday}/${cap.dailyCap}) : réessayez demain.`,
      429,
    );
  }
  return null;
}

type ProspectForPreflight = {
  deleted_at?: string | null;
  do_not_contact?: boolean;
  email?: string | null;
  key_figures?: Record<string, unknown> | null;
  website?: string | null;
};

/** Clés où un enrichissement antérieur a pu déposer une adresse TROUVÉE. */
const EMAIL_KEYS = ["email", "contact_email", "hunter_email", "contact"] as const;

/** Adresses trouvées pour ce prospect, avec une source (fiche, enrichissement). */
export const knownAddresses = (prospect: ProspectForPreflight | null): string[] =>
  [prospect?.email, ...EMAIL_KEYS.map((key) => prospect?.key_figures?.[key])].filter(
    (value): value is string => typeof value === "string" && value.includes("@"),
  );

/** Contrôle avant envoi, avec la signature du compte et les adresses connues. */
export async function preflightFor(
  db: Db,
  message: Pick<OutboxMessage, "user_id" | "subject" | "body" | "type">,
  to: unknown,
  prospect: ProspectForPreflight | null,
): Promise<PreflightResult> {
  const { offer } = await loadOffer(db as never, message.user_id);
  return preflight({
    subject: message.subject,
    body: message.body,
    to: typeof to === "string" ? to : null,
    signature: signatureFor(offer),
    knownAddresses: knownAddresses(prospect),
    website: prospect?.website ?? null,
    kind: message.type === "reponse" ? "reponse" : "prospection",
  });
}

/** Identifiants Gmail renvoyés par le nœud Gmail de n8n, s'il y en a. */
function gmailIds(payload: unknown): { threadId: string | null; gmailId: string | null } {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) if (typeof body[key] === "string" && body[key]) return body[key] as string;
    return null;
  };
  return { threadId: pick("thread_id", "threadId"), gmailId: pick("gmail_message_id", "id", "messageId") };
}

/**
 * Envoie un message DÉJÀ verrouillé (`send_status = sending`) par l'appelant.
 * N'écrit rien en cas d'échec : c'est l'appelant qui décide (rendre la main,
 * reprogrammer une tentative, déclarer l'échec).
 */
export async function deliver(db: Db, message: OutboxMessage, to: string, deps: SendDeps = {}): Promise<SendResult> {
  const now = deps.now ?? new Date();
  const refused = await checkSendRules(db, message, to, now);
  if (refused) return refused;

  const webhookUrl = deps.webhookUrl !== undefined ? deps.webhookUrl : process.env.N8N_WEBHOOK_SEND_URL;
  if (!webhookUrl) return fail("config", "N8N_WEBHOOK_SEND_URL n'est pas configurée.", 503);

  let payload: unknown = null;
  try {
    const response = await (deps.fetch ?? fetch)(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        // Majuscule initiale, sans point final : corrigé d'office au départ.
        subject: normalizeSubject(message.subject ?? ""),
        body: message.body,
        prospect_id: message.prospect_id,
        message_id: message.id,
        thread_id: message.thread_id ?? null,
        // Réponse à un mail reçu : n8n la poste dans le même fil (In-Reply-To).
        reply_to_gmail_message_id: message.reply_to_gmail_message_id ?? null,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return fail("transient", `n8n a répondu ${response.status}. ${detail.slice(0, 200)}`.trim(), 502);
    }
    payload = await response.json().catch(() => null);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "inconnue";
    return fail("transient", `Webhook n8n injoignable (${reason}).`, 502);
  }

  // --- Le mail est parti : on met l'état à jour ----------------------------
  const sentAt = now.toISOString();
  const ids = gmailIds(payload);
  const { error: messageError } = await db
    .from("messages")
    .update({
      status: "sent",
      sent_at: sentAt,
      send_status: "sent",
      subject: normalizeSubject(message.subject ?? ""),
      sent_to: to,
      send_error: null,
      send_started_at: null,
      ...(message.thread_id ? {} : ids.threadId ? { thread_id: ids.threadId } : {}),
      ...(ids.gmailId ? { gmail_message_id: ids.gmailId } : {}),
    })
    .eq("id", message.id)
    .eq("user_id", message.user_id);
  if (messageError) {
    return fail("unrecorded", `Mail envoyé mais statut non enregistré : ${messageError.message}`, 500);
  }

  // Une réponse partie solde le mail reçu auquel elle répond.
  if (message.reply_to_inbound_id) {
    await db
      .from("inbound_messages")
      .update({ handled: true })
      .eq("id", message.reply_to_inbound_id)
      .eq("user_id", message.user_id);
  }

  const nextStatus = STATUS_AFTER_SEND[message.type];
  const { data: prospect } = await db
    .from("prospects")
    .select("status")
    .eq("id", message.prospect_id)
    .eq("user_id", message.user_id)
    .maybeSingle();
  const current = (prospect as { status: ProspectStatus } | null)?.status ?? null;
  const applied = nextStatus && current ? advanceStatus(current, nextStatus) : null;
  if (applied) {
    await db.from("prospects").update({ status: applied }).eq("id", message.prospect_id).eq("user_id", message.user_id);
  }

  // Une relance en attente à la fois : les anciennes sont soldées par l'envoi.
  await db
    .from("reminders")
    .update({ done: true })
    .eq("prospect_id", message.prospect_id)
    .eq("user_id", message.user_id)
    .eq("done", false);

  const delay = NEXT_REMINDER_DAYS[message.type];
  let reminderDueAt: string | null = null;
  if (delay) {
    reminderDueAt = new Date(now.getTime() + delay * 86_400_000).toISOString();
    await db
      .from("reminders")
      .insert({ prospect_id: message.prospect_id, user_id: message.user_id, due_at: reminderDueAt, done: false });
  }

  return { ok: true, messageId: message.id, sentAt, prospectStatus: applied ?? current, reminderDueAt };
}

export const MESSAGE_COLUMNS =
  "id, user_id, prospect_id, type, subject, body, status, thread_id, deleted_at, send_status, send_attempts, scheduled_to, reply_to_inbound_id, reply_to_gmail_message_id";

/**
 * Envoi MANUEL (bouton « Envoyer »). Verrouille le message (`sending`) pour
 * qu'un tick ne l'envoie pas en même temps, puis rend l'état précédent si
 * l'envoi n'a pas eu lieu.
 */
export async function sendNow(
  db: Db,
  input: { userId: string; messageId: string; prospectId: string; to: unknown },
  deps: SendDeps = {},
): Promise<SendResult> {
  const { data } = await db
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", input.messageId)
    .eq("prospect_id", input.prospectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const message = data as (OutboxMessage & { send_status?: string }) | null;
  if (!message) return fail("invalid", "Message introuvable.", 404);
  if (message.status === "sent") return fail("conflict", "Ce message a déjà été envoyé.", 409);
  if (message.send_status === "sending") return fail("conflict", "Ce message est déjà en cours d'envoi.", 409);

  const now = deps.now ?? new Date();
  // Vérifier AVANT de verrouiller : un refus ne touche à rien.
  const refused = await checkSendRules(db, message, input.to, now);
  if (refused) return refused;

  const previous = message.send_status ?? "draft";
  const { data: locked } = await db
    .from("messages")
    .update({ send_status: "sending", send_started_at: now.toISOString() })
    .eq("id", message.id)
    .eq("user_id", input.userId)
    .eq("status", "draft")
    .in("send_status", ["draft", "scheduled", "failed", "blocked"])
    .is("deleted_at", null)
    .select("id");
  if (!locked?.length) return fail("conflict", "Ce message vient de changer d'état (envoyé ou programmé) : rechargez.", 409);

  const result = await deliver(db, message, input.to as string, { ...deps, now });
  if (!result.ok && result.kind !== "unrecorded") {
    await db
      .from("messages")
      .update({ send_status: previous, send_started_at: null })
      .eq("id", message.id)
      .eq("send_status", "sending");
  }
  return result;
}

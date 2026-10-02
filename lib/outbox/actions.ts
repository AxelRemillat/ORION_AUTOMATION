"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cancelSchedule, scheduleMessage } from "./scheduler";
import { deleteMessageForever, restoreMessage, trashMessage } from "./trash";
import { deleteInboundForever, restoreInbound, trashInbound } from "./inbound-trash";
import { setDoNotContact } from "./do-not-contact";
import { confirmOppositionManually } from "./opposition-check";
import { draftIfReady } from "@/lib/today/auto-draft";
import { saveReplyDraft } from "./reply-draft";
import { editScheduledMessage, type EditResult } from "./edit-scheduled";

/**
 * Actions « mail » appelées depuis l'UI (fiche prospect, /prospection,
 * /corbeille, Cockpit). Client de session : la RLS limite chaque opération aux
 * lignes de l'utilisateur connecté.
 */

export type MailActionResult = { ok: true } | { ok: false; error: string };

function done(result: { ok: true } | { ok: false; error: string }): MailActionResult {
  // Compteurs, badges et listes vivent dans tout l'arbre.
  if (result.ok) revalidatePath("/", "layout");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function userId(): Promise<string | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user?.id ?? null;
}

const SESSION_ERROR: MailActionResult = { ok: false, error: "Session expirée. Reconnectez-vous." };

export async function trashMail(messageId: string): Promise<MailActionResult> {
  return done(await trashMessage(createClient(), messageId));
}

export async function restoreMail(messageId: string): Promise<MailActionResult> {
  return done(await restoreMessage(createClient(), messageId));
}

export async function deleteMailForever(messageId: string): Promise<MailActionResult> {
  return done(await deleteMessageForever(createClient(), messageId));
}

/**
 * `at` : instant ISO (UTC), calculé côté client depuis la saisie Europe/Paris.
 * `scheduledAt` rend l'heure RÉELLE (espacement, fenêtre 8 h – 18 h ouvrés).
 */
export async function scheduleMail(
  messageId: string,
  to: string,
  at: string,
): Promise<{ ok: true; scheduledAt: string } | { ok: false; error: string }> {
  const id = await userId();
  if (!id) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const result = await scheduleMessage(createClient(), { userId: id, messageId, to: to.trim(), at: new Date(at) });
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true, scheduledAt: result.scheduledAt ?? at };
}

/** Texte d'un mail programmé ou bloqué, modifié avant son départ (« Programmés »). */
export async function editScheduledMail(messageId: string, subject: string, body: string): Promise<EditResult> {
  const id = await userId();
  if (!id) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const result = await editScheduledMessage(createClient(), { userId: id, messageId, subject, body });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function unscheduleMail(messageId: string): Promise<MailActionResult> {
  const id = await userId();
  if (!id) return SESSION_ERROR;
  return done(await cancelSchedule(createClient(), { userId: id, messageId }));
}

// --- Mails reçus -----------------------------------------------------------

export async function trashReceived(inboundId: string): Promise<MailActionResult> {
  return done(await trashInbound(createClient(), inboundId));
}

export async function restoreReceived(inboundId: string): Promise<MailActionResult> {
  return done(await restoreInbound(createClient(), inboundId));
}

export async function deleteReceivedForever(inboundId: string): Promise<MailActionResult> {
  return done(await deleteInboundForever(createClient(), inboundId));
}

/** Enregistre (ou réécrit) le brouillon de réponse ; rend son id pour le programmer. */
export async function saveReply(
  inboundId: string,
  subject: string,
  body: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const id = await userId();
  if (!id) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const result = await saveReplyDraft(createClient(), { userId: id, inboundId, subject, body });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

// --- Ne plus contacter -----------------------------------------------------

export async function setProspectDoNotContact(
  prospectId: string,
  on: boolean,
): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  const result = await setDoNotContact(createClient(), prospectId, on);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** « J'ai vérifié manuellement » : l'opposition est levée, la fiche redevient programmable. */
export async function confirmOppositionChecked(prospectId: string): Promise<MailActionResult> {
  const id = await userId();
  if (!id) return SESSION_ERROR;
  const db = createClient();
  const result = await confirmOppositionManually(db, id, prospectId);
  // Opposition vérifiée : si c'était le dernier manque, le brouillon part tout seul.
  if (result.ok) await draftIfReady(db, id, prospectId).catch(() => null);
  return done(result);
}

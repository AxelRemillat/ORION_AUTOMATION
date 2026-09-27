"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cancelSchedule, scheduleMessage } from "./scheduler";
import { deleteMessageForever, restoreMessage, trashMessage } from "./trash";

/**
 * Actions « mail » appelées depuis l'UI (fiche prospect, /prospection,
 * /corbeille, Cockpit). Client de session : la RLS limite chaque opération aux
 * lignes de l'utilisateur connecté.
 */

export type MailActionResult = { ok: true } | { ok: false; error: string };

function done(result: { ok: true } | { ok: false; error: string }): MailActionResult {
  // Compteur de la corbeille, badges et listes vivent dans tout l'arbre.
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

/** `at` : instant ISO (UTC), calculé côté client depuis la saisie Europe/Paris. */
export async function scheduleMail(messageId: string, to: string, at: string): Promise<MailActionResult> {
  const id = await userId();
  if (!id) return SESSION_ERROR;
  return done(await scheduleMessage(createClient(), { userId: id, messageId, to: to.trim(), at: new Date(at) }));
}

export async function unscheduleMail(messageId: string): Promise<MailActionResult> {
  const id = await userId();
  if (!id) return SESSION_ERROR;
  return done(await cancelSchedule(createClient(), { userId: id, messageId }));
}

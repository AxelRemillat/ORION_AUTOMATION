import type { Db } from "@/lib/trash/scope";
import { cleanDraft } from "@/lib/mail-preflight";
import { MESSAGE_COLUMNS, preflightFor, type OutboxMessage } from "./send";

/**
 * Modifier le texte d'un mail programmé (ou bloqué) AVANT son départ, depuis
 * « Programmés ». Le texte passe par le même contrôle que l'envoi :
 * - refusé → rien n'est écrit, les erreurs sont rendues ;
 * - accepté → enregistré ; un mail `blocked` dont l'heure est encore à venir
 *   redevient `scheduled`, sinon il attend qu'on le reprogramme.
 * L'heure et le destinataire ne bougent pas.
 */

export type EditResult = { ok: true; rescheduled: boolean } | { ok: false; error: string; errors?: string[] };

export async function editScheduledMessage(
  db: Db,
  input: { userId: string; messageId: string; subject: string; body: string },
  now = new Date(),
): Promise<EditResult> {
  const { data } = await db
    .from("messages")
    .select(`${MESSAGE_COLUMNS}, scheduled_at`)
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const message = data as (OutboxMessage & { scheduled_to?: string | null; scheduled_at?: string | null }) | null;
  if (!message || message.deleted_at) return { ok: false, error: "Mail introuvable." };
  if (message.status === "sent" || !["scheduled", "blocked"].includes(String(message.send_status))) {
    return { ok: false, error: "Ce mail n'est plus modifiable : parti, en cours d'envoi ou annulé." };
  }

  const clean = cleanDraft({ subject: input.subject, body: input.body });
  const { data: prospect } = await db
    .from("prospects")
    .select("email, key_figures, website")
    .eq("id", message.prospect_id)
    .maybeSingle();
  const check = await preflightFor(db, { ...message, subject: clean.subject, body: clean.body }, message.scheduled_to ?? null, prospect as never);
  if (!check.ok) return { ok: false, error: "Le contrôle avant envoi refuse ce texte.", errors: check.errors };

  const future = Boolean(message.scheduled_at && new Date(message.scheduled_at).getTime() > now.getTime());
  const rescheduled = message.send_status === "blocked" && future;
  const { data: updated } = await db
    .from("messages")
    .update({
      subject: clean.subject,
      body: clean.body,
      ...(rescheduled ? { send_status: "scheduled", send_error: null } : {}),
    })
    .eq("id", message.id)
    .eq("user_id", input.userId)
    .in("send_status", ["scheduled", "blocked"])
    .select("id");
  return updated?.length ? { ok: true, rescheduled } : { ok: false, error: "Trop tard : le mail vient de partir." };
}

import { autoReplyKind, isProspectReply } from "@/lib/inbound/auto-reply";
import { readableSendError } from "@/lib/outbox/send-errors";
import type { Db } from "@/lib/trash/scope";
import { appUrl, firstSentence, notifyConfigured, notifyEvent, type NotifyDeps, type NotifyOutcome } from "./ntfy";

/**
 * Les trois notifications d'ORION :
 *   - vraie réponse d'un prospect  → urgent, « Réponse de <Entreprise> », 1re phrase ;
 *   - challenge anti-spam          → default, « Anti-spam à valider : <Entreprise> » ;
 *   - envoi échoué                 → high, « Envoi échoué : <Entreprise> ».
 * Les rebonds et les absences ne notifient pas.
 */

/** Mail reçu (après son enregistrement par /api/inbound). */
export async function notifyInbound(
  db: Db,
  input: {
    userId: string;
    inboundId: string;
    prospectId: string | null;
    companyName: string | null;
    message: { from_email: string; subject?: string | null; body?: string | null; auto_submitted?: string | null };
  },
  deps: NotifyDeps = {},
): Promise<NotifyOutcome | null> {
  const base = appUrl(deps);
  const who = input.companyName ?? input.message.from_email;
  if (autoReplyKind(input.message) === "antispam") {
    return notifyEvent(db, {
      userId: input.userId,
      kind: "antispam",
      messageId: input.inboundId,
      notification: {
        title: `Anti-spam à valider : ${who}`,
        body: "Le serveur du prospect retient ton mail : ouvre le lien de validation dans ORION, puis coche « Validé ».",
        priority: "default",
        tags: ["warning"],
        // Le lien et la case « Validé » sont sur la page du mail reçu.
        click: `${base}/cockpit/inbox/${input.inboundId}`,
      },
    }, deps);
  }
  if (!isProspectReply(input.message)) return null;
  return notifyEvent(db, {
    userId: input.userId,
    kind: "reply",
    messageId: input.inboundId,
    notification: {
      title: `Réponse de ${who}`,
      body: firstSentence(input.message.body ?? "") || (input.message.subject ?? "Nouvelle réponse"),
      priority: "urgent",
      tags: ["incoming_envelope"],
      click: input.prospectId ? `${base}/suivi/${input.prospectId}` : `${base}/cockpit/inbox/${input.inboundId}`,
    },
  }, deps);
}

/** Mail passé en échec d'envoi (tick d'envoi). */
export async function notifySendFailed(
  db: Db,
  input: { userId: string; messageId: string; prospectId: string | null; error: string | null },
  deps: NotifyDeps = {},
): Promise<NotifyOutcome> {
  if (!notifyConfigured(deps)) return { sent: false, reason: "no-topic" };
  let company: string | null = null;
  if (input.prospectId) {
    const { data } = await db.from("prospects").select("company_name").eq("id", input.prospectId).maybeSingle();
    company = (data as { company_name?: string | null } | null)?.company_name ?? null;
  }
  const base = appUrl(deps);
  return notifyEvent(db, {
    userId: input.userId,
    kind: "send_failed",
    messageId: input.messageId,
    notification: {
      title: `Envoi échoué : ${company ?? "mail ORION"}`,
      body: readableSendError(input.error) ?? "Le mail n'est pas parti.",
      priority: "high",
      tags: ["x"],
      click: input.prospectId ? `${base}/suivi/${input.prospectId}` : `${base}/cockpit/mails?onglet=envoyes`,
    },
  }, deps);
}

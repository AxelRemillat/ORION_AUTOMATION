import { recordProspectEvent } from "@/lib/history/record";
import { RELANCE_TYPES } from "@/lib/outbox/relances";
import { offWeekend, parisToUtc } from "@/lib/outbox/paris-time";
import type { Db } from "@/lib/trash/scope";
import type { ProspectStatus } from "@/types";
import { antispamProspectHints, autoReplyKind, isProspectReply, type MailLike } from "./auto-reply";

/**
 * Réponses automatiques, côté base : rattacher un challenge anti-spam à son
 * prospect, décaler les relances après une absence, « Validé ».
 * Aucun envoi ici, aucune suppression.
 */

/**
 * Le prospect d'un challenge anti-spam. L'expéditeur (aktid@invitations.mailinblack.com)
 * n'est pas l'adresse du prospect : on cherche d'abord une adresse citée dans
 * le mail, puis un prospect UNIQUE dont le domaine commence par la partie
 * locale (« aktid » → contact@aktid.fr). Plusieurs candidats : on ne devine pas.
 */
export async function findAntispamProspect(db: Db, message: MailLike, userId?: string): Promise<{ id: string; user_id: string } | null> {
  const hints = antispamProspectHints(message);
  const unique = async (pattern: string) => {
    let query = db.from("prospects").select("id, user_id").ilike("email", pattern).is("deleted_at", null);
    if (userId) query = query.eq("user_id", userId);
    const { data } = await query.limit(2);
    return data?.length === 1 ? (data[0] as { id: string; user_id: string }) : null;
  };
  for (const email of hints.emails) {
    const found = await unique(email);
    if (found) return found;
  }
  return hints.label ? unique(`%@${hints.label}.%`) : null;
}

/** Premier jour ouvré APRÈS la date de retour, 9 h à Paris. */
export function followUpAfter(returnDate: string): Date | null {
  const next = new Date(`${returnDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const at = parisToUtc(next.toISOString().slice(0, 10), "09:00");
  return at ? offWeekend(at) : null;
}

/**
 * Absence avec date de retour : les relances programmées et les rappels qui
 * tomberaient AVANT le retour sont repoussés au lendemain du retour. Rien
 * d'autre ne bouge (pas d'annulation, pas d'envoi).
 */
export async function shiftFollowUpsAfterReturn(db: Db, input: { userId: string; prospectId: string; returnDate: string }): Promise<number> {
  const at = followUpAfter(input.returnDate);
  if (!at) return 0;
  const iso = at.toISOString();
  const { data } = await db
    .from("messages")
    .update({ scheduled_at: iso })
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospectId)
    .eq("status", "draft")
    .eq("send_status", "scheduled")
    .in("type", [...RELANCE_TYPES])
    .lt("scheduled_at", iso)
    .select("id");
  await db
    .from("reminders")
    .update({ due_at: iso })
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospectId)
    .eq("done", false)
    .lt("due_at", iso);
  return data?.length ?? 0;
}

const STATUS_AFTER_SENT: Record<string, ProspectStatus> = { intro: "contacte", relance_1: "relance_1", relance_2: "relance_2" };

export type ValidateResult = { ok: true; prospectId: string; statusRestored: ProspectStatus | null } | { ok: false; error: string };

/**
 * Case « Validé » d'un challenge anti-spam : le lien a été cliqué, le mail est
 * délivré. Marque la fiche (`key_figures.antispam_validated_at`), solde le mail
 * reçu, trace l'historique. Si la fiche était passée « Répondu » à cause de ce
 * challenge (et d'aucune vraie réponse), elle retrouve son statut d'envoi.
 */
export async function setAntispamValidated(
  db: Db,
  input: { userId: string; inboundId: string; validated: boolean; now?: Date },
): Promise<ValidateResult> {
  const now = (input.now ?? new Date()).toISOString();
  const { data } = await db
    .from("inbound_messages")
    .select("id, prospect_id, from_email, subject, body, received_at, deleted_at")
    .eq("id", input.inboundId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const inbound = data as (MailLike & { id: string; prospect_id: string | null; received_at: string; deleted_at: string | null }) | null;
  if (!inbound || inbound.deleted_at) return { ok: false, error: "Mail introuvable ou à la corbeille." };
  if (autoReplyKind(inbound) !== "antispam") return { ok: false, error: "Ce mail n'est pas une validation anti-spam." };

  let prospectId = inbound.prospect_id;
  if (!prospectId) {
    prospectId = (await findAntispamProspect(db, inbound, input.userId))?.id ?? null;
    if (!prospectId) return { ok: false, error: "Prospect introuvable pour ce mail anti-spam : ouvrez sa fiche pour le marquer à la main." };
    // Rattachement (ajout d'un lien, rien n'est effacé).
    await db.from("inbound_messages").update({ prospect_id: prospectId }).eq("id", inbound.id).eq("user_id", input.userId);
  }

  const { data: prospectRow } = await db.from("prospects").select("id, status, key_figures").eq("id", prospectId).eq("user_id", input.userId).maybeSingle();
  const prospect = prospectRow as { id: string; status: ProspectStatus; key_figures: Record<string, unknown> | null } | null;
  if (!prospect) return { ok: false, error: "Fiche introuvable." };

  const figures = { ...(prospect.key_figures ?? {}), antispam_validated_at: input.validated ? now : null, antispam_inbound_id: inbound.id };
  const update: { key_figures: Record<string, unknown>; status?: ProspectStatus } = { key_figures: figures };

  // « Répondu » à tort : seule une VRAIE réponse justifie ce statut.
  let statusRestored: ProspectStatus | null = null;
  if (input.validated && prospect.status === "repondu") {
    const [{ data: replies }, { data: sent }] = await Promise.all([
      db.from("inbound_messages").select("from_email, subject, body").eq("prospect_id", prospect.id).is("deleted_at", null),
      db.from("messages").select("type, sent_at").eq("prospect_id", prospect.id).eq("status", "sent").is("deleted_at", null).order("sent_at", { ascending: false }).limit(1),
    ]);
    const realReply = ((replies ?? []) as MailLike[]).some(isProspectReply);
    const lastType = (sent?.[0] as { type?: string } | undefined)?.type;
    if (!realReply && lastType && STATUS_AFTER_SENT[lastType]) statusRestored = STATUS_AFTER_SENT[lastType];
    if (statusRestored) update.status = statusRestored;
  }

  const { error } = await db.from("prospects").update(update as never).eq("id", prospect.id).eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  await db.from("inbound_messages").update({ handled: input.validated }).eq("id", inbound.id).eq("user_id", input.userId);

  await recordProspectEvent(db, {
    prospectId: prospect.id,
    userId: input.userId,
    kind: "antispam",
    channel: "email",
    at: now,
    data: { title: input.validated ? "Validation anti-spam faite : mail délivré" : "Validation anti-spam annulée", inbound_id: inbound.id },
  });
  if (statusRestored) {
    await recordProspectEvent(db, { prospectId: prospect.id, userId: input.userId, kind: "status", at: now, data: { from: "repondu", to: statusRestored } });
  }
  return { ok: true, prospectId: prospect.id, statusRestored };
}

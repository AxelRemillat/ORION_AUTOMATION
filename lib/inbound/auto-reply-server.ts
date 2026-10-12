import { recordProspectEvent } from "@/lib/history/record";
import { RELANCE_TYPES } from "@/lib/outbox/relances";
import { offWeekend, parisToUtc } from "@/lib/outbox/paris-time";
import type { Db } from "@/lib/trash/scope";
import type { ProspectStatus } from "@/types";
import { absenceReturnDate, antispamProspectHints, autoReplyKind, isProspectReply, type MailLike } from "./auto-reply";

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

/** Résultat du reclassement d'une absence prise à tort pour une réponse (Cowork #49). */
export interface AbsenceReclass {
  inboundId: string;
  prospectId: string | null;
  returnDate: string | null;
  /** Catégorie n8n remise à « autre » (le badge « Absence » vient de la détection). */
  categoryFrom: string | null;
  statusRestored: ProspectStatus | null;
  /** Prochaine relance (rappel rouvert ou créé), ISO ; `null` si rien à faire. */
  followUpAt: string | null;
  /** Relances programmées que la fausse réponse a remises en brouillon : JAMAIS reprogrammées ici. */
  cancelledDrafts: number;
}

/**
 * ABSENCE CLASSÉE « RÉPONSE » À TORT (Cowork #49, LSO MEDICAL) : défait les effets d'une réponse sans rien
 * supprimer ni envoyer ni reprogrammer.
 *   - catégorie n8n « reponse » / « question » / « relance » → « autre » ;
 *   - fiche « Répondu » sans aucune vraie réponse → statut du dernier envoi ;
 *   - rappel de relance soldé par la fausse réponse → rouvert ; date de retour lisible → au lendemain du
 *     retour (9 h Paris, jour ouvré), sinon à sa date d'origine (comportement des absences).
 * `apply: false` : rien n'est écrit, le résultat dit ce qui serait fait.
 */
export async function reclassifyAbsence(
  db: Db,
  input: { userId: string; inboundId: string; apply: boolean; now?: Date },
): Promise<AbsenceReclass | null> {
  const { data } = await db
    .from("inbound_messages")
    .select("id, prospect_id, from_email, subject, body, category, received_at, deleted_at")
    .eq("id", input.inboundId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const inbound = data as (MailLike & { id: string; prospect_id: string | null; category: string | null; received_at: string; deleted_at: string | null }) | null;
  if (!inbound || inbound.deleted_at || autoReplyKind(inbound) !== "absence") return null;
  const returnDate = absenceReturnDate(inbound);
  const result: AbsenceReclass = { inboundId: inbound.id, prospectId: inbound.prospect_id, returnDate, categoryFrom: null, statusRestored: null, followUpAt: null, cancelledDrafts: 0 };
  const now = (input.now ?? new Date()).toISOString();

  if (inbound.category && inbound.category !== "autre") {
    result.categoryFrom = inbound.category;
    if (input.apply) await db.from("inbound_messages").update({ category: "autre" }).eq("id", inbound.id).eq("user_id", input.userId);
  }
  if (!inbound.prospect_id) return result;

  const [{ data: prospectRow }, { data: replies }, { data: sent }, { data: reminders }, { data: drafts }] = await Promise.all([
    db.from("prospects").select("id, status, deleted_at").eq("id", inbound.prospect_id).eq("user_id", input.userId).maybeSingle(),
    db.from("inbound_messages").select("from_email, subject, body, received_at").eq("prospect_id", inbound.prospect_id).eq("user_id", input.userId).is("deleted_at", null),
    db.from("messages").select("type, sent_at").eq("prospect_id", inbound.prospect_id).eq("user_id", input.userId).eq("status", "sent").is("deleted_at", null).order("sent_at", { ascending: false }).limit(1),
    db.from("reminders").select("id, due_at, done, created_at").eq("prospect_id", inbound.prospect_id).eq("user_id", input.userId),
    db.from("messages").select("id, send_error").eq("prospect_id", inbound.prospect_id).eq("user_id", input.userId).eq("status", "draft").eq("send_status", "draft").in("type", [...RELANCE_TYPES]),
  ]);
  const prospect = prospectRow as { id: string; status: ProspectStatus; deleted_at: string | null } | null;
  if (!prospect || prospect.deleted_at) return result;
  const last = sent?.[0] as { type?: string; sent_at?: string } | undefined;
  const realReply = ((replies ?? []) as (MailLike & { received_at: string })[]).some((reply) => isProspectReply(reply) && (!last?.sent_at || reply.received_at >= last.sent_at));
  if (realReply) return result;
  result.cancelledDrafts = ((drafts ?? []) as { send_error: string | null }[]).filter((draft) => /le prospect a répondu/.test(draft.send_error ?? "")).length;

  if (prospect.status === "repondu" && last?.type && STATUS_AFTER_SENT[last.type]) {
    result.statusRestored = STATUS_AFTER_SENT[last.type];
    if (input.apply) {
      await db.from("prospects").update({ status: result.statusRestored }).eq("id", prospect.id).eq("user_id", input.userId);
      await recordProspectEvent(db, { prospectId: prospect.id, userId: input.userId, kind: "status", at: now, data: { from: "repondu", to: result.statusRestored } });
    }
  }

  // Rappel : celui que la fausse réponse a soldé (créé au dernier envoi), rouvert.
  const rows = (reminders ?? []) as { id: string; due_at: string; done: boolean; created_at: string }[];
  const open = rows.find((row) => !row.done);
  const closed = rows
    .filter((row) => row.done && last?.sent_at && row.created_at >= last.sent_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const target = open ?? closed ?? null;
  const after = returnDate ? followUpAfter(returnDate) : null;
  const due = target ? (after && after.toISOString() > target.due_at ? after.toISOString() : target.due_at) : after?.toISOString() ?? null;
  if (!due) return result;
  result.followUpAt = due;
  if (input.apply) {
    if (target) await db.from("reminders").update({ done: false, due_at: due }).eq("id", target.id).eq("user_id", input.userId);
    else await db.from("reminders").insert({ prospect_id: prospect.id, user_id: input.userId, due_at: due, done: false });
  }
  return result;
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

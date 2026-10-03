import { setDoNotContact } from "@/lib/outbox/do-not-contact";
import { scheduleMessage } from "@/lib/outbox/scheduler";
import type { Db } from "@/lib/trash/scope";
import type { DiscardReason, TodayKind } from "@/types";
import { joinBody } from "./body";
import { loadToday } from "./load";
import { flatten } from "./group";
import { PLAN_CLOSE, PLAN_OPEN } from "./plan";
import { utcToParis } from "@/lib/outbox/paris-time";

/**
 * Actions de « Aujourd'hui », sur un client injecté (session côté écran,
 * doubles dans les tests). Règles :
 *   - on ne réécrit qu'un BROUILLON, jamais un mail programmé ou parti ;
 *   - « Valider » ne programme rien : il pose `validated_at` ;
 *   - la programmation n'accepte QUE des brouillons validés, dans la fenêtre
 *     9 h – 17 h, dans la limite du plafond du jour ;
 *   - « Écarter » ajoute une ligne (`prospect_discards`) — rien n'est effacé,
 *     et « Annuler » la neutralise (`undone_at`).
 */

export type CoreResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DraftEdit {
  messageId: string;
  subject: string;
  core: string;
  optOut: boolean;
  signature: string | null;
}

/** Enregistre la retouche ; `validate` pose (true) ou lève (false) la validation. */
export async function saveDraft(db: Db, userId: string, edit: DraftEdit, validate?: boolean): Promise<CoreResult> {
  const body = joinBody(edit.core, edit);
  if (!edit.core.trim()) return { ok: false, error: "Le message est vide." };
  // « Modifié à la main » seulement si le texte a VRAIMENT changé : Valider
  // renvoie aussi le texte, tel quel le plus souvent.
  const { data: current } = await db.from("messages").select("subject, body").eq("id", edit.messageId).eq("user_id", userId).maybeSingle();
  const stored = current as { subject: string | null; body: string } | null;
  const changed = Boolean(stored) && (stored!.body.trim() !== body.trim() || (stored!.subject ?? "") !== (edit.subject.trim() || ""));
  const { data, error } = await db
    .from("messages")
    .update({
      subject: edit.subject.trim() || null,
      body,
      ...(changed ? { edited_by_hand: true } : {}),
      ...(validate === undefined ? {} : { validated_at: validate ? new Date().toISOString() : null }),
    })
    .eq("id", edit.messageId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .not("send_status", "in", "(scheduled,sending)")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Ce mail est déjà programmé ou parti." };
  return { ok: true };
}

export async function discard(
  db: Db,
  userId: string,
  input: { kind: TodayKind; reason: DiscardReason; prospectId: string | null; messageId: string | null; inboundId: string | null; candidateId: string | null },
): Promise<CoreResult<{ discardId: string }>> {
  const { data, error } = await db
    .from("prospect_discards")
    .insert({
      user_id: userId,
      kind: input.kind,
      reason: input.reason,
      prospect_id: input.prospectId,
      message_id: input.messageId,
      inbound_id: input.inboundId,
      candidate_id: input.candidateId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Écart non enregistré." };
  // « Opposé » : la fiche passe en « ne plus contacter » (réversible, voir undo).
  if (input.reason === "oppose" && input.prospectId) {
    const dnc = await setDoNotContact(db, input.prospectId, true);
    if (!dnc.ok) return dnc;
  }
  // Un brouillon validé puis écarté ne doit pas partir avec le lot.
  if (input.messageId) {
    await db.from("messages").update({ validated_at: null }).eq("id", input.messageId).eq("user_id", userId).eq("status", "draft");
  }
  return { ok: true, discardId: (data as { id: string }).id };
}

export async function undoDiscard(db: Db, userId: string, discardId: string): Promise<CoreResult> {
  const { data, error } = await db
    .from("prospect_discards")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", discardId)
    .eq("user_id", userId)
    .is("undone_at", null)
    .select("reason, prospect_id");
  if (error) return { ok: false, error: error.message };
  const row = (data ?? [])[0] as { reason: string; prospect_id: string | null } | undefined;
  if (row?.reason === "oppose" && row.prospect_id) {
    const dnc = await setDoNotContact(db, row.prospect_id, false);
    if (!dnc.ok) return dnc;
  }
  return { ok: true };
}

export interface ScheduleRequest {
  key: string;
  at: string;
}

/**
 * Programme le lot affiché dans la feuille. Chaque élément est revérifié ici :
 * validé, brouillon, destinataire connu, horaire dans la fenêtre — un élément
 * qui ne passe pas est refusé, jamais programmé « quand même ».
 */
export async function scheduleBatch(
  db: Db,
  userId: string,
  requests: readonly ScheduleRequest[],
  remaining: number,
  now = new Date(),
): Promise<CoreResult<{ scheduled: number; refused: { key: string; error: string }[] }>> {
  const items = new Map(flatten((await loadToday(db, userId, now)).groups).map((item) => [item.key, item]));
  const refused: { key: string; error: string }[] = [];
  let scheduled = 0;
  for (const request of requests) {
    const item = items.get(request.key);
    const at = new Date(request.at);
    const { time } = utcToParis(at);
    if (!item || item.status !== "valide" || !item.messageId) refused.push({ key: request.key, error: "Non validé." });
    else if (!item.contact.email) refused.push({ key: request.key, error: "Destinataire manquant." });
    else if (!Number.isFinite(at.getTime()) || time < PLAN_OPEN || time > PLAN_CLOSE) refused.push({ key: request.key, error: "Hors de la fenêtre 9 h – 17 h." });
    else if (scheduled >= remaining) refused.push({ key: request.key, error: "Plafond du jour atteint." });
    else {
      const result = await scheduleMessage(db, { userId, messageId: item.messageId, to: item.contact.email, at }, now);
      if (result.ok) scheduled += 1;
      else refused.push({ key: request.key, error: result.error });
    }
  }
  return { ok: true, scheduled, refused };
}

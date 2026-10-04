import { recordProspectEvent } from "@/lib/history/record";
import type { Db } from "@/lib/trash/scope";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";

/**
 * « Ne plus contacter » — un interrupteur, réversible.
 *
 * Activé : tout envoi (manuel ou programmé) est refusé côté serveur
 * (lib/outbox/send.ts), les envois programmés redeviennent des brouillons, et
 * le prospect passe en « perdu » (son statut précédent est mémorisé).
 * Levé : le prospect retrouve ce statut ; les brouillons restent brouillons.
 */

export type DncResult = { ok: true; cancelled: number } | { ok: false; error: string };

export const DNC_CANCEL_REASON = "Annulé : prospect marqué « ne plus contacter ».";

export async function setDoNotContact(db: Db, prospectId: string, on: boolean): Promise<DncResult> {
  const { data, error } = await db
    .from("prospects")
    .select("id, status, do_not_contact, status_before_dnc")
    .eq("id", prospectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const prospect = data as { status: ProspectStatus; do_not_contact?: boolean; status_before_dnc?: string | null } | null;
  if (!prospect) return { ok: false, error: "Prospect introuvable ou à la corbeille." };

  if (on) {
    if (!prospect.do_not_contact) {
      const update = await db
        .from("prospects")
        .update({ do_not_contact: true, status_before_dnc: prospect.status, status: "perdu" })
        .eq("id", prospectId);
      if (update.error) return { ok: false, error: update.error.message };
      await recordProspectEvent(db, { prospectId, kind: "dnc", data: { on: true, from: prospect.status } });
    }
    // Conditionnelle : un envoi déjà pris par un tick (`sending`) n'est pas touché ;
    // il sera de toute façon refusé par les règles d'envoi.
    const { data: cancelled, error: cancelError } = await db
      .from("messages")
      .update({ send_status: "draft", scheduled_at: null, send_error: DNC_CANCEL_REASON, send_attempts: 0 })
      .eq("prospect_id", prospectId)
      .in("send_status", ["scheduled", "failed", "blocked"])
      .select("id");
    if (cancelError) return { ok: false, error: cancelError.message };
    return { ok: true, cancelled: cancelled?.length ?? 0 };
  }

  if (!prospect.do_not_contact) return { ok: true, cancelled: 0 };
  const before = prospect.status_before_dnc as ProspectStatus | null;
  const restored: ProspectStatus =
    prospect.status === "perdu" && before && PROSPECT_STATUSES.includes(before) ? before : prospect.status;
  const update = await db
    .from("prospects")
    .update({ do_not_contact: false, status_before_dnc: null, status: restored })
    .eq("id", prospectId);
  if (update.error) return { ok: false, error: update.error.message };
  await recordProspectEvent(db, { prospectId, kind: "dnc", data: { on: false, to: restored } });
  return { ok: true, cancelled: 0 };
}

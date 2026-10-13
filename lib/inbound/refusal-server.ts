import type { Db } from "@/lib/trash/scope";
import type { InboundCategory, ProspectStatus } from "@/types";
import { recordProspectEvent } from "@/lib/history/record";
import { setDoNotContact } from "@/lib/outbox/do-not-contact";
import { cancelRelancesOnReply } from "@/lib/outbox/relances";
import { classifyRefusal, laterDate, ownText, REFUSAL_WINDOW, type RefusalKind } from "./refusal";

/**
 * APPLIQUER UN REFUS (Cowork #51). Une réponse RATTACHÉE classée « refus » ou
 * « stop » fait passer la fiche en Perdu et annule les relances ; un « stop »
 * coche aussi « ne plus contacter ». La trace (`key_figures.refusal`) garde
 * l'état d'avant : « Annuler (pas un refus) » le remet exactement.
 */

export interface RefusalTrace {
  inbound_id: string;
  kind: "refus" | "stop";
  previous_status: string;
  previous_category: string;
  dnc_set: boolean;
  at: string;
}

/** Tranche un cas ambigu (LLM léger, coût tracé) ; `null` = indisponible → rien ne change. */
export type AmbiguityJudge = (text: string) => Promise<"refus" | "autre" | null>;

export async function classifyInbound(body: string, judge?: AmbiguityJudge): Promise<RefusalKind> {
  const kind = classifyRefusal(body);
  if (kind !== "ambigu") return kind;
  const verdict = judge ? await judge(ownText(body).slice(0, REFUSAL_WINDOW)).catch(() => null) : null;
  return verdict === "refus" ? "refus" : "autre";
}

type Prospect = { id: string; status: string; key_figures?: Record<string, unknown> | null };

export async function applyRefusal(
  db: Db,
  input: { userId: string; prospect: Prospect; inbound: { id: string; category: string; received_at: string; body: string }; kind: RefusalKind; now?: Date },
): Promise<{ applied: boolean; reminder: string | null }> {
  const at = (input.now ?? new Date()).toISOString();
  if (input.kind === "plus_tard") {
    // Intérêt différé : statut inchangé ; un rappel à la date annoncée, s'il y en a une.
    const date = laterDate(ownText(input.inbound.body), input.now);
    if (date) await db.from("reminders").insert({ prospect_id: input.prospect.id, user_id: input.userId, due_at: `${date}T08:00:00.000Z`, done: false });
    return { applied: false, reminder: date };
  }
  if (input.kind !== "refus" && input.kind !== "stop") return { applied: false, reminder: null };

  const trace: RefusalTrace = {
    inbound_id: input.inbound.id,
    kind: input.kind,
    previous_status: input.prospect.status,
    previous_category: input.inbound.category,
    dnc_set: false,
    at,
  };
  if (input.kind === "stop") {
    const dnc = await setDoNotContact(db, input.prospect.id, true);
    trace.dnc_set = dnc.ok;
  }
  const figures = { ...(input.prospect.key_figures ?? {}), refusal: trace };
  await db.from("prospects").update({ status: "perdu", key_figures: figures }).eq("id", input.prospect.id).eq("user_id", input.userId);
  await db.from("inbound_messages").update({ category: "refus" }).eq("id", input.inbound.id).eq("user_id", input.userId);
  await cancelRelancesOnReply(db, { userId: input.userId, prospectId: input.prospect.id, receivedAt: input.inbound.received_at });
  await recordProspectEvent(db, {
    prospectId: input.prospect.id,
    userId: input.userId,
    kind: "refus",
    data: { title: input.kind === "stop" ? "Refus (« stop ») : perdu, ne plus contacter" : "Refus dans la réponse : passé en Perdu", inbound_id: input.inbound.id },
  });
  return { applied: true, reminder: null };
}

/** « Annuler (pas un refus) » : statut, catégorie et « ne plus contacter » d'avant. */
export async function undoRefusal(db: Db, input: { userId: string; prospectId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await db.from("prospects").select("id, status, key_figures").eq("id", input.prospectId).eq("user_id", input.userId).maybeSingle();
  const row = data as Prospect | null;
  const trace = row?.key_figures?.refusal as RefusalTrace | undefined;
  if (!row || !trace) return { ok: false, error: "Aucun refus à annuler sur cette fiche." };
  if (trace.dnc_set) await setDoNotContact(db, row.id, false);
  const { refusal: _removed, ...figures } = row.key_figures ?? {};
  void _removed;
  await db.from("prospects").update({ status: trace.previous_status as ProspectStatus, key_figures: figures }).eq("id", row.id).eq("user_id", input.userId);
  await db.from("inbound_messages").update({ category: trace.previous_category as InboundCategory }).eq("id", trace.inbound_id).eq("user_id", input.userId);
  await recordProspectEvent(db, { prospectId: row.id, userId: input.userId, kind: "refus", data: { title: "Refus annulé (pas un refus) : statut d'avant remis", undone: true } });
  return { ok: true };
}

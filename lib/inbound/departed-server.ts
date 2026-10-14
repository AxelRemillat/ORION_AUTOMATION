import type { Db } from "@/lib/trash/scope";
import { recordProspectEvent } from "@/lib/history/record";
import { RELANCE_TYPES } from "@/lib/outbox/relances";
import { proposedContacts, type ProposedContact } from "./departed";

/**
 * EFFETS D'UN « CONTACT PARTI » (Cowork #54) sur la fiche rattachée :
 *   - les relances PROGRAMMÉES vers l'adresse partie sont annulées (jamais
 *     envoyées) — celles vers une autre adresse ne bougent pas ;
 *   - l'adresse est marquée « partie » (`key_figures.departed_emails`) : la
 *     garde au départ la refuse (lib/outbox/send.ts) ;
 *   - les contacts cités sont PROPOSÉS (`key_figures.proposed_contacts`) ;
 *     l'adresse principale ne change que sur « Utiliser comme contact
 *     principal » (setPrimaryContact). Rien n'est reprogrammé.
 * Rejouable : aucun doublon.
 */

export const DEPARTED_CANCEL_REASON = "Annulé : contact parti (réponse automatique « ne travaille plus là »).";

export function departedEmails(figures: Record<string, unknown> | null | undefined): string[] {
  const list = (figures as { departed_emails?: { email: string }[] } | null)?.departed_emails;
  return Array.isArray(list) ? list.map((item) => item.email.toLowerCase()) : [];
}

export function proposedOf(figures: Record<string, unknown> | null | undefined): ProposedContact[] {
  const list = (figures as { proposed_contacts?: ProposedContact[] } | null)?.proposed_contacts;
  return Array.isArray(list) ? list : [];
}

type Prospect = { id: string; email: string | null; key_figures: Record<string, unknown> | null };

export async function applyDeparted(
  db: Db,
  input: { userId: string; prospect: Prospect; inbound: { id: string; from_email: string; body: string; received_at: string } },
): Promise<{ cancelled: number; proposed: ProposedContact[] }> {
  const gone = input.inbound.from_email.toLowerCase();
  const domain = gone.split("@")[1] ?? null;
  const figures = input.prospect.key_figures ?? {};

  // 1. Relances programmées vers l'adresse partie : annulées. Le destinataire
  //    est `scheduled_to`, ou l'adresse de la fiche quand il n'est pas fixé.
  const { data: drafts } = await db
    .from("messages")
    .select("id, scheduled_to")
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospect.id)
    .eq("status", "draft")
    .in("type", [...RELANCE_TYPES])
    .in("send_status", ["scheduled", "blocked", "failed"]);
  const toCancel = ((drafts ?? []) as { id: string; scheduled_to: string | null }[])
    .filter((row) => (row.scheduled_to ?? input.prospect.email ?? "").toLowerCase() === gone)
    .map((row) => row.id);
  let cancelled = 0;
  if (toCancel.length) {
    const { data } = await db
      .from("messages")
      .update({ send_status: "draft", scheduled_at: null, send_error: DEPARTED_CANCEL_REASON, send_attempts: 0 })
      .in("id", toCancel)
      .eq("status", "draft")
      .select("id");
    cancelled = data?.length ?? 0;
  }

  // 2. Adresse partie + contacts proposés, sans doublon.
  const already = departedEmails(figures).includes(gone);
  const known = new Set(proposedOf(figures).map((item) => item.email));
  const found = proposedContacts(input.inbound.body, { domain, departedEmail: gone }).filter((item) => !known.has(item.email));
  if (!already || found.length) {
    const departed = already ? (figures.departed_emails as unknown[]) : [...((figures.departed_emails as unknown[]) ?? []), { email: gone, at: input.inbound.received_at, inbound_id: input.inbound.id }];
    const proposed = [...proposedOf(figures), ...found];
    await db.from("prospects").update({ key_figures: { ...figures, departed_emails: departed, proposed_contacts: proposed } } as never).eq("id", input.prospect.id).eq("user_id", input.userId);
    await recordProspectEvent(db, {
      prospectId: input.prospect.id,
      userId: input.userId,
      kind: "contact",
      data: { title: `Contact parti : ${gone}${cancelled ? ` — ${cancelled} relance(s) annulée(s)` : ""}${found.length ? ` — ${found.length} contact(s) proposé(s)` : ""}` },
    });
  }
  return { cancelled, proposed: found };
}

/** « Utiliser comme contact principal » : seulement un contact PROPOSÉ, jamais une adresse partie. */
export async function setPrimaryContact(db: Db, input: { userId: string; prospectId: string; email: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await db.from("prospects").select("id, email, key_figures").eq("id", input.prospectId).eq("user_id", input.userId).maybeSingle();
  const row = data as Prospect | null;
  if (!row) return { ok: false, error: "Fiche introuvable." };
  const email = input.email.toLowerCase();
  if (departedEmails(row.key_figures).includes(email)) return { ok: false, error: "Cette adresse est celle d'un contact parti." };
  const contact = proposedOf(row.key_figures).find((item) => item.email === email);
  if (!contact) return { ok: false, error: "Ce contact n'est pas proposé sur cette fiche." };
  const { error } = await db
    .from("prospects")
    .update({ email: contact.email, email_type: "nominatif", contact_name: contact.name, contact_role: contact.role, contact_source: "réponse (contact parti)", contact_found_by: "reponse:contact-parti" } as never)
    .eq("id", row.id)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  await recordProspectEvent(db, { prospectId: row.id, userId: input.userId, kind: "contact", data: { title: `Contact principal : ${[contact.name, contact.role].filter(Boolean).join(" — ")} <${contact.email}> (au lieu de ${row.email ?? "—"})` } });
  return { ok: true };
}

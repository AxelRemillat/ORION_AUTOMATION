import type { Db } from "@/lib/trash/scope";

/**
 * À QUELLE FICHE RATTACHER UN MAIL REÇU ? (Cowork #51, 13/10/2026)
 *
 * ARTFLEX : ORION écrit à info@artflex-robinetterie.fr, la réponse arrive de
 * jp.romeo@artflex-robinetterie.fr dans le même fil. Le rattachement par
 * adresse exacte échouait : « ne correspond à aucun prospect ». Ordre :
 *   1. l'adresse exacte de la fiche ;
 *   2. le FIL : le `thread_id` Gmail du mail reçu est l'identifiant Gmail du
 *      premier mail du fil, donc d'un mail envoyé par ORION (`gmail_message_id`),
 *      ou son `thread_id` quand il est enregistré ;
 *   3. le DOMAINE de l'entreprise, s'il désigne UNE seule fiche — jamais un
 *      webmail grand public (gmail, orange…) ;
 *   4. sinon : non rattaché.
 */

export type AttachVia = "adresse" | "fil" | "domaine";

/** Domaines de messagerie grand public : partagés par des inconnus, jamais une entreprise. */
export const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com",
  "yahoo.com", "yahoo.fr", "ymail.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "icloud.com",
  "me.com", "mac.com", "aol.com", "aol.fr", "gmx.fr", "gmx.com", "protonmail.com", "proton.me", "bbox.fr", "numericable.fr", "club-internet.fr",
]);

export const domainOf = (email: string | null | undefined): string | null => {
  const match = /@([^@\s>]+)$/.exec((email ?? "").trim().toLowerCase());
  return match ? match[1] : null;
};

export const isConsumerDomain = (domain: string | null): boolean => !domain || CONSUMER_DOMAINS.has(domain);

export interface AttachedProspect {
  id: string;
  user_id: string;
  status: string;
  deleted_at?: string | null;
  company_name: string;
  email?: string | null;
  key_figures?: Record<string, unknown> | null;
}

const COLUMNS = "id, user_id, status, deleted_at, company_name, email, key_figures";

export async function findProspectForInbound(
  db: Db,
  input: { fromEmail: string; threadId: string | null },
): Promise<{ prospect: AttachedProspect; via: AttachVia } | null> {
  // 1. Adresse exacte.
  const { data: exact } = await db.from("prospects").select(COLUMNS).ilike("email", input.fromEmail).limit(1).maybeSingle();
  if (exact) return { prospect: exact as AttachedProspect, via: "adresse" };

  // 2. Le fil : un mail envoyé par ORION dont l'id Gmail (ou le fil) est celui du mail reçu.
  if (input.threadId && /^[A-Za-z0-9_-]{6,64}$/.test(input.threadId)) {
    const { data: sent } = await db
      .from("messages")
      .select("prospect_id")
      .eq("status", "sent")
      .or(`gmail_message_id.eq.${input.threadId},thread_id.eq.${input.threadId}`)
      .limit(1)
      .maybeSingle();
    const prospectId = (sent as { prospect_id: string } | null)?.prospect_id;
    if (prospectId) {
      const { data } = await db.from("prospects").select(COLUMNS).eq("id", prospectId).maybeSingle();
      if (data) return { prospect: data as AttachedProspect, via: "fil" };
    }
  }

  // 3. Le domaine de l'entreprise, s'il ne désigne qu'une fiche active.
  const domain = domainOf(input.fromEmail);
  if (domain && !isConsumerDomain(domain)) {
    const { data } = await db.from("prospects").select(COLUMNS).ilike("email", `%@${domain}`).is("deleted_at", null).limit(2);
    const rows = (data ?? []) as AttachedProspect[];
    if (rows.length === 1) return { prospect: rows[0], via: "domaine" };
  }
  return null;
}

/**
 * Le nouveau correspondant devient un contact secondaire de la fiche
 * (`key_figures.secondary_contacts`), sans toucher à l'adresse principale.
 */
export function withSecondaryContact(
  figures: Record<string, unknown> | null | undefined,
  contact: { email: string; via: AttachVia; at: string },
): Record<string, unknown> | null {
  const current = Array.isArray(figures?.secondary_contacts) ? (figures!.secondary_contacts as { email: string }[]) : [];
  if (current.some((item) => item.email?.toLowerCase() === contact.email.toLowerCase())) return null;
  return { ...(figures ?? {}), secondary_contacts: [...current, { email: contact.email, source: `réponse (${contact.via})`, first_seen_at: contact.at }] };
}

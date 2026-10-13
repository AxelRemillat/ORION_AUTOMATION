import type { Db } from "@/lib/trash/scope";
import { normalizeSubject } from "@/lib/mail-preflight";
import { domainOf, isConsumerDomain } from "@/lib/inbound/attach";

/**
 * RÉPONDRE DEPUIS ORION À UN MAIL REÇU SANS FICHE (Cowork #51).
 *
 * Avant : « Cette adresse ne correspond à aucun prospect » — Axel devait passer
 * par sa messagerie. La réponse part maintenant par le MÊME webhook d'envoi,
 * dans le même fil (`thread_id`, `reply_to_gmail_message_id`), et UNIQUEMENT
 * sur clic. Garde au départ : la liste « ne plus contacter » (adresse ET
 * domaine d'entreprise), même sans fiche. Trace : table `inbound_replies`.
 */

export type FreeReplyResult = { ok: true; replyId: string } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): FreeReplyResult => ({ ok: false, error, status });

/** L'adresse (ou son domaine d'entreprise) est-elle sur « ne plus contacter » ? */
export async function doNotContactFor(db: Db, to: string): Promise<string | null> {
  const { data: exact } = await db.from("prospects").select("company_name").eq("do_not_contact", true).ilike("email", to).limit(1).maybeSingle();
  if (exact) return `${to} est sur « ne plus contacter » (${(exact as { company_name: string }).company_name}).`;
  const domain = domainOf(to);
  if (domain && !isConsumerDomain(domain)) {
    const { data } = await db.from("prospects").select("company_name").eq("do_not_contact", true).ilike("email", `%@${domain}`).limit(1).maybeSingle();
    if (data) return `Le domaine ${domain} est sur « ne plus contacter » (${(data as { company_name: string }).company_name}).`;
  }
  return null;
}

export async function sendFreeReply(
  db: Db,
  input: { userId: string; inboundId: string; to: string; subject: string; body: string },
  deps: { fetch?: typeof fetch; webhookUrl?: string | null; now?: Date } = {},
): Promise<FreeReplyResult> {
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail("Adresse du destinataire invalide.", 400);
  if (!input.body.trim()) return fail("Message vide.", 400);

  const { data } = await db
    .from("inbound_messages")
    .select("id, prospect_id, from_email, subject, thread_id, gmail_message_id, deleted_at")
    .eq("id", input.inboundId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const inbound = data as { id: string; prospect_id: string | null; thread_id: string | null; gmail_message_id: string | null; deleted_at: string | null } | null;
  if (!inbound || inbound.deleted_at) return fail("Mail reçu introuvable ou à la corbeille.", 404);
  if (inbound.prospect_id) return fail("Ce mail est rattaché à une fiche : répondez depuis la réponse de la fiche.", 409);

  const blocked = await doNotContactFor(db, to);
  if (blocked) return fail(`Envoi refusé : ${blocked}`, 409);

  const webhookUrl = deps.webhookUrl !== undefined ? deps.webhookUrl : process.env.N8N_WEBHOOK_SEND_URL;
  if (!webhookUrl) return fail("N8N_WEBHOOK_SEND_URL n'est pas configurée.", 503);

  const subject = normalizeSubject(input.subject.trim() || "Re:");
  const { data: row, error } = await db
    .from("inbound_replies")
    .insert({ user_id: input.userId, inbound_id: inbound.id, to_email: to, subject, body: input.body, status: "sending", thread_id: inbound.thread_id } as never)
    .select("id")
    .single();
  if (error || !row) return fail(`Réponse non enregistrée : ${error?.message ?? "inconnue"}`, 500);
  const replyId = (row as { id: string }).id;

  let payload: Record<string, unknown> | null = null;
  try {
    const response = await (deps.fetch ?? fetch)(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        subject,
        body: input.body,
        prospect_id: null,
        message_id: replyId,
        thread_id: inbound.thread_id,
        // n8n poste la réponse dans le même fil (In-Reply-To / References / threadId).
        reply_to_gmail_message_id: inbound.gmail_message_id,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`n8n a répondu ${response.status}`);
    // `{ ok, gmail_message_id, gmail_thread_id }`, ou la sortie brute d'un nœud n8n (tableau) — comme lib/outbox/send.ts.
    const raw = (await response.json().catch(() => null)) as unknown;
    payload = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "inconnue";
    await db.from("inbound_replies").update({ status: "failed", send_error: reason } as never).eq("id", replyId);
    return fail(`Envoi impossible (${reason}).`, 502);
  }

  const pick = (...keys: string[]) => keys.map((key) => payload?.[key]).find((value) => typeof value === "string" && value) as string | undefined;
  const sentAt = (deps.now ?? new Date()).toISOString();
  await db
    .from("inbound_replies")
    .update({ status: "sent", sent_at: sentAt, gmail_message_id: pick("gmail_message_id", "id", "messageId") ?? null, thread_id: pick("gmail_thread_id", "thread_id", "threadId") ?? inbound.thread_id } as never)
    .eq("id", replyId);
  // Répondu : le mail reçu est soldé et lu.
  await db.from("inbound_messages").update({ handled: true, read_at: sentAt }).eq("id", inbound.id).eq("user_id", input.userId);
  return { ok: true, replyId };
}

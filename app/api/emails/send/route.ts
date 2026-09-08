import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/env";
import type { MessageType, ProspectStatus } from "@/types";

/**
 * POST /api/emails/send — envoi semi-automatique d'un message en brouillon.
 *
 * Le mail lui-même part de n8n (compte Gmail Workspace d'Axel) : ici on se
 * contente d'appeler le webhook puis, si la réponse est OK, de faire avancer
 * l'état applicatif (message envoyé, statut prospect, relance planifiée).
 */

/** Délai avant la relance suivante, en jours, selon le message qui vient de partir. */
const NEXT_REMINDER_DAYS: Partial<Record<MessageType, number>> = {
  intro: 4,
  relance_1: 7,
};

/** Statut visé après envoi. On ne redescend jamais un prospect déjà plus avancé. */
const STATUS_AFTER_SEND: Partial<Record<MessageType, ProspectStatus>> = {
  intro: "contacte",
  relance_1: "relance_1",
  relance_2: "relance_2",
};

/** Statuts « au-delà » de la séquence d'envoi : ils ne doivent pas être écrasés. */
const TERMINAL_STATUSES: ProspectStatus[] = ["repondu", "en_discussion", "gagne", "perdu"];

const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const to = payload?.to;
  const messageId = payload?.message_id;
  const prospectId = payload?.prospect_id;

  if (!isEmail(to) || typeof messageId !== "string" || typeof prospectId !== "string") {
    return NextResponse.json(
      { error: "Payload invalide : { to (email), prospect_id, message_id } sont requis." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // La RLS restreint déjà à l'utilisateur courant : une ligne trouvée = une ligne à lui.
  const { data: message } = await supabase
    .from("messages")
    .select("id, type, subject, body, status, prospect_id")
    .eq("id", messageId)
    .eq("prospect_id", prospectId)
    .maybeSingle();

  if (!message) return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  if (message.status === "sent") {
    return NextResponse.json({ error: "Ce message a déjà été envoyé." }, { status: 409 });
  }

  // --- Appel du webhook n8n (cf. docs/n8n.md pour le contrat) ---------------
  let webhookUrl: string;
  try {
    webhookUrl = requireEnv("N8N_WEBHOOK_SEND_URL");
  } catch {
    return NextResponse.json(
      { error: "N8N_WEBHOOK_SEND_URL n'est pas configurée." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        subject: message.subject ?? "",
        body: message.body,
        prospect_id: prospectId,
        message_id: message.id,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `n8n a répondu ${response.status}. ${detail.slice(0, 200)}`.trim() },
        { status: 502 },
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "inconnue";
    return NextResponse.json({ error: `Webhook n8n injoignable (${reason}).` }, { status: 502 });
  }

  // --- Le mail est parti : on met l'état à jour ----------------------------
  const sentAt = new Date().toISOString();
  const { error: messageError } = await supabase
    .from("messages")
    .update({ status: "sent", sent_at: sentAt })
    .eq("id", message.id);
  if (messageError) {
    return NextResponse.json(
      { error: `Mail envoyé mais statut non enregistré : ${messageError.message}` },
      { status: 500 },
    );
  }

  const nextStatus = STATUS_AFTER_SEND[message.type];
  const { data: prospect } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", prospectId)
    .maybeSingle();

  if (nextStatus && prospect && !TERMINAL_STATUSES.includes(prospect.status)) {
    await supabase.from("prospects").update({ status: nextStatus }).eq("id", prospectId);
  }

  // Une relance en attente à la fois : les anciennes sont soldées par l'envoi.
  await supabase
    .from("reminders")
    .update({ done: true })
    .eq("prospect_id", prospectId)
    .eq("done", false);

  const delay = NEXT_REMINDER_DAYS[message.type];
  let reminderDueAt: string | null = null;
  if (delay) {
    reminderDueAt = new Date(Date.now() + delay * 86_400_000).toISOString();
    await supabase
      .from("reminders")
      .insert({ prospect_id: prospectId, due_at: reminderDueAt, done: false });
  }

  return NextResponse.json({
    ok: true,
    message_id: message.id,
    sent_at: sentAt,
    prospect_status: nextStatus ?? prospect?.status ?? null,
    reminder_due_at: reminderDueAt,
  });
}

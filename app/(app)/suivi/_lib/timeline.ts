import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import type { Deal, Message, Reminder, SendStatus } from "@/types";

/**
 * Timeline d'une affaire : messages, relances et signature réunis sur une même
 * ligne de temps. Fonction pure — la mise en forme reste dans le composant.
 */

export type EventKind = "draft" | "sent" | "reminder" | "reminder-done" | "deal";

export interface TimelineEvent {
  id: string;
  /** Date ISO servant au tri et à l'affichage. */
  at: string;
  kind: EventKind;
  title: string;
  /** Contenu du message, pour les événements qui en portent un. */
  subject?: string | null;
  body?: string;
  /** Identifiant du message : nécessaire au bouton d'envoi. */
  messageId?: string;
  /** État d'envoi d'un brouillon (programmé, échec…). */
  sendStatus?: SendStatus;
  scheduledAt?: string | null;
  scheduledTo?: string | null;
  sendError?: string | null;
  tone: "brand" | "warn" | "good" | "neutral";
}

export function buildTimeline(
  messages: Message[],
  reminders: Reminder[],
  deals: Deal[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const message of messages) {
    const label = MESSAGE_TYPE_LABELS[message.type];
    const sent = message.status === "sent";
    const scheduled = !sent && message.send_status === "scheduled";
    events.push({
      id: `message-${message.id}`,
      at: sent ? (message.sent_at ?? message.created_at) : message.created_at,
      kind: sent ? "sent" : "draft",
      title: sent ? `${label} envoyée` : scheduled ? `${label} programmée` : `${label} en brouillon`,
      subject: message.subject,
      body: message.body,
      messageId: message.id,
      sendStatus: message.send_status ?? (sent ? "sent" : "draft"),
      scheduledAt: message.scheduled_at ?? null,
      scheduledTo: message.scheduled_to ?? null,
      sendError: message.send_error ?? null,
      tone: sent ? "brand" : "warn",
    });
  }

  for (const reminder of reminders) {
    events.push({
      id: `reminder-${reminder.id}`,
      at: reminder.due_at,
      kind: reminder.done ? "reminder-done" : "reminder",
      title: reminder.done ? "Relance soldée" : "Relance programmée",
      tone: reminder.done ? "neutral" : "warn",
    });
  }

  for (const deal of deals) {
    events.push({
      id: `deal-${deal.id}`,
      at: deal.signed_at ?? deal.created_at,
      kind: "deal",
      title: deal.status === "gagne" ? "Contrat signé" : `Affaire ${deal.status}`,
      tone: deal.status === "gagne" ? "good" : "neutral",
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

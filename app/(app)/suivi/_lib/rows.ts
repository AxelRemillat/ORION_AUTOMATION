import type { Deal, Message, Prospect, ProspectStatus, Reminder } from "@/types";
import { dealValue, type DealValue } from "./estimates";
import { nextAction, type NextAction } from "./next-action";
import { stageOf } from "./stages";

/** Formes aplaties passées du serveur aux composants clients (props sérialisables). */

export interface ProspectRow {
  id: string;
  company_name: string;
  sector: string | null;
  city: string | null;
  status: ProspectStatus;
  /** Colonne du Kanban qui accueille ce prospect. */
  stageKey: string;
  messagesCount: number;
  draftsCount: number;
  /** Dernier envoi (ou création si rien n'est parti). */
  lastActivity: string | null;
  /** Prochaine relance ouverte, si programmée. */
  nextDueAt: string | null;
  value: DealValue;
  action: NextAction;
  /** Prochain envoi programmé (ISO), ou le dernier échec d'envoi. */
  sendState: ProspectSendState | null;
}

export interface ProspectSendState {
  sendStatus: "scheduled" | "failed";
  scheduledAt: string | null;
  sendError: string | null;
}

/**
 * Badge d'envoi d'un prospect : son prochain mail programmé, sinon un envoi en
 * échec (à reprendre). Ignore brouillons ordinaires et mails partis.
 */
export function prospectSendState(own: Message[]): ProspectSendState | null {
  const scheduled = own
    .filter((message) => message.send_status === "scheduled" && message.scheduled_at && !message.deleted_at)
    .sort((a, b) => (a.scheduled_at as string).localeCompare(b.scheduled_at as string))[0];
  if (scheduled) {
    return { sendStatus: "scheduled", scheduledAt: scheduled.scheduled_at ?? null, sendError: scheduled.send_error ?? null };
  }
  const failed = own.find((message) => message.send_status === "failed" && !message.deleted_at);
  return failed ? { sendStatus: "failed", scheduledAt: null, sendError: failed.send_error ?? null } : null;
}

export interface DueReminderRow {
  id: string;
  prospectId: string;
  companyName: string;
  status: ProspectStatus;
  dueAt: string;
}

/** Assemble les lignes du pipeline à partir des quatre tables. */
export function buildRows(
  prospects: Prospect[],
  messages: Message[],
  reminders: Reminder[],
  deals: Deal[],
): ProspectRow[] {
  const messagesByProspect = new Map<string, Message[]>();
  for (const message of messages) {
    const bucket = messagesByProspect.get(message.prospect_id);
    if (bucket) bucket.push(message);
    else messagesByProspect.set(message.prospect_id, [message]);
  }

  const dealsByProspect = new Map<string, Deal[]>();
  for (const deal of deals) {
    const bucket = dealsByProspect.get(deal.prospect_id);
    if (bucket) bucket.push(deal);
    else dealsByProspect.set(deal.prospect_id, [deal]);
  }

  const nextDue = new Map<string, string>();
  for (const reminder of reminders) {
    if (reminder.done) continue;
    const current = nextDue.get(reminder.prospect_id);
    if (!current || reminder.due_at < current) nextDue.set(reminder.prospect_id, reminder.due_at);
  }

  return prospects.map((prospect) => {
    const own = messagesByProspect.get(prospect.id) ?? [];
    const sentDates = own
      .filter((message) => message.status === "sent" && message.sent_at)
      .map((message) => message.sent_at as string)
      .sort();
    // Un programmé partira seul : ce n'est plus un brouillon « à envoyer ».
    const draftsCount = own.filter(
      (message) =>
        message.status === "draft" && message.send_status !== "scheduled" && message.send_status !== "sending",
    ).length;
    const nextDueAt = nextDue.get(prospect.id) ?? null;

    return {
      id: prospect.id,
      company_name: prospect.company_name,
      sector: prospect.sector,
      city: prospect.city,
      status: prospect.status,
      stageKey: stageOf(prospect.status).key,
      messagesCount: own.length,
      draftsCount,
      lastActivity: sentDates.at(-1) ?? prospect.created_at,
      nextDueAt,
      value: dealValue(dealsByProspect.get(prospect.id) ?? []),
      action: nextAction({ status: prospect.status, draftsCount, nextDueAt }),
      sendState: prospectSendState(own),
    };
  });
}

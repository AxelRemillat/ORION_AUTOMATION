import type { Message, Prospect, ProspectStatus, Reminder } from "@/types";

/** Formes aplaties passées du serveur aux composants clients (props sérialisables). */

export interface ProspectRow {
  id: string;
  company_name: string;
  sector: string | null;
  city: string | null;
  status: ProspectStatus;
  messagesCount: number;
  draftsCount: number;
  /** Dernier envoi (ou création si rien n'est parti). */
  lastActivity: string | null;
  /** Prochaine relance ouverte, si programmée. */
  nextDueAt: string | null;
}

export interface DueReminderRow {
  id: string;
  prospectId: string;
  companyName: string;
  status: ProspectStatus;
  dueAt: string;
}

/** Assemble les lignes du pipeline à partir des trois tables. */
export function buildRows(
  prospects: Prospect[],
  messages: Message[],
  reminders: Reminder[],
): ProspectRow[] {
  const byProspect = new Map<string, Message[]>();
  for (const message of messages) {
    const bucket = byProspect.get(message.prospect_id);
    if (bucket) bucket.push(message);
    else byProspect.set(message.prospect_id, [message]);
  }

  const nextDue = new Map<string, string>();
  for (const reminder of reminders) {
    if (reminder.done) continue;
    const current = nextDue.get(reminder.prospect_id);
    if (!current || reminder.due_at < current) nextDue.set(reminder.prospect_id, reminder.due_at);
  }

  return prospects.map((prospect) => {
    const own = byProspect.get(prospect.id) ?? [];
    const sentDates = own
      .filter((message) => message.status === "sent" && message.sent_at)
      .map((message) => message.sent_at as string)
      .sort();

    return {
      id: prospect.id,
      company_name: prospect.company_name,
      sector: prospect.sector,
      city: prospect.city,
      status: prospect.status,
      messagesCount: own.length,
      draftsCount: own.filter((message) => message.status === "draft").length,
      lastActivity: sentDates.at(-1) ?? prospect.created_at,
      nextDueAt: nextDue.get(prospect.id) ?? null,
    };
  });
}

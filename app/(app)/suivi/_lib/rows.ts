import type { Deal, Message, Prospect, ProspectStatus, Reminder } from "@/types";
import { dealValue, type DealValue } from "./estimates";
import { nextAction, type NextAction, type Opposition } from "./next-action";
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
  /** Faits dont dépend la prochaine action, gardés pour la recalculer côté client. */
  actionFacts: ActionFacts;
  /** Prochain envoi programmé (ISO), ou le dernier échec d'envoi. */
  sendState: ProspectSendState | null;
  /** « Non joignable » : trois tentatives sans site ni email (motif), `null` sinon. */
  unreachable: string | null;
  /** Famille du dernier mail d'intro (F1 à F4), `null` si inconnue. */
  family?: string | null;
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

export interface ActionFacts {
  draftsCount: number;
  scheduledAt: string | null;
  lastSentType: Message["type"] | null;
  opposition: Opposition | null;
}

/**
 * Faits d'un prospect pour `nextAction`. Un brouillon d'une étape déjà partie
 * (réécriture, brouillon d'évaluation) n'est pas « à envoyer » : c'est la
 * relance qui compte. Un programmé partira seul : ce n'est plus un brouillon.
 */
export function actionFacts(prospect: Prospect, own: Message[]): ActionFacts {
  const live = own.filter((message) => !message.deleted_at);
  const sent = live
    .filter((message) => message.status === "sent")
    .sort((a, b) => (a.sent_at ?? a.created_at).localeCompare(b.sent_at ?? b.created_at));
  const sentTypes = new Set(sent.map((message) => message.type));
  const draftsCount = live.filter(
    (message) =>
      message.status === "draft" &&
      message.send_status !== "scheduled" &&
      message.send_status !== "sending" &&
      !sentTypes.has(message.type),
  ).length;
  const scheduled = prospectSendState(live);
  const opposition: Opposition | null = prospect.do_not_contact
    ? "do_not_contact"
    : prospect.key_figures?.refuses_prospecting === true
      ? "refuses_prospecting"
      : null;
  return {
    draftsCount,
    scheduledAt: scheduled?.sendStatus === "scheduled" ? scheduled.scheduledAt : null,
    lastSentType: sent.at(-1)?.type ?? null,
    opposition,
  };
}

export interface DueReminderRow {
  id: string;
  prospectId: string;
  companyName: string;
  status: ProspectStatus;
  dueAt: string;
}

/** Famille du mail d'intro le plus récent qui en porte une. */
function familyOfLatestIntro(messages: readonly Message[], families: ReadonlyMap<string, string>): string | null {
  const intros = messages.filter((message) => message.type === "intro");
  if (!intros.length) return null;
  const tagged = intros.filter((message) => families.has(message.id)).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  // Intro écrite avant l'expérience n° 2 (#83) : « non attribué ».
  return tagged[0] ? (families.get(tagged[0].id) ?? null) : "non attribué";
}

/** Assemble les lignes du pipeline à partir des quatre tables. */
export function buildRows(
  prospects: Prospect[],
  messages: Message[],
  reminders: Reminder[],
  deals: Deal[],
  /** Famille de chaque mail (message_variants.family), par id de message. */
  families: ReadonlyMap<string, string> = new Map(),
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
    const facts = actionFacts(prospect, own);
    const nextDueAt = nextDue.get(prospect.id) ?? null;

    return {
      id: prospect.id,
      company_name: prospect.company_name,
      sector: prospect.sector,
      city: prospect.city,
      status: prospect.status,
      stageKey: stageOf(prospect.status).key,
      messagesCount: own.length,
      draftsCount: facts.draftsCount,
      lastActivity: sentDates.at(-1) ?? prospect.created_at,
      nextDueAt,
      value: dealValue(dealsByProspect.get(prospect.id) ?? []),
      action: nextAction({ status: prospect.status, nextDueAt, ...facts }),
      actionFacts: facts,
      sendState: prospectSendState(own),
      unreachable: (prospect.key_figures as { unreachable?: { reason?: string } } | null)?.unreachable?.reason ?? null,
      family: familyOfLatestIntro(own, families),
    };
  });
}

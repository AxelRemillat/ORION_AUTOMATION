import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { unreadBadgeCount } from "@/lib/inbound/read-state";
import type { InboundMessage, Message, MessageType, Prospect, SendStatus } from "@/types";

/**
 * Boîte mail du Cockpit — fonctions PURES : onglets, compteurs, recherche,
 * pagination et fil de conversation. Les pages passent les lignes déjà
 * ramenées à la portée « vivante » (corbeilles exclues, lib/trash/portfolio).
 */

export type MailboxTab = "recus" | "envoyes" | "programmes";
export const MAILBOX_TABS: { key: MailboxTab; label: string }[] = [
  { key: "recus", label: "Reçus" },
  { key: "envoyes", label: "Envoyés" },
  { key: "programmes", label: "Programmés" },
];

export const parseTab = (value: string | undefined): MailboxTab =>
  value === "envoyes" || value === "programmes" ? value : "recus";

/** Famille affichée : l'intro, les relances, les réponses. */
export function typeFamily(type: MessageType): string {
  if (type === "relance_1" || type === "relance_2") return "Relance";
  if (type === "reponse") return "Réponse";
  if (type === "intro") return "Intro";
  return MESSAGE_TYPE_LABELS[type] ?? type;
}

export interface SentItem {
  id: string;
  prospectId: string;
  companyName: string;
  /** Destinataire réel ; `null` pour un mail parti avant son enregistrement. */
  to: string | null;
  subject: string | null;
  excerpt: string;
  body: string;
  type: MessageType;
  typeLabel: string;
  status: "sent" | "failed";
  /** Envoi, ou dernière tentative pour un échec. */
  at: string;
  error: string | null;
}

export interface ScheduledItem {
  id: string;
  prospectId: string;
  companyName: string;
  to: string | null;
  subject: string | null;
  scheduledAt: string;
  sendError: string | null;
  sendStatus: SendStatus;
  /** Texte complet : relisible et modifiable avant le départ. */
  body: string;
  type: MessageType;
}

export const excerptOf = (body: string, max = 160): string => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const names = (prospects: Pick<Prospect, "id" | "company_name">[]) =>
  new Map(prospects.map((prospect) => [prospect.id, prospect.company_name]));

/** Envoyés : partis ou en échec, du plus récent au plus ancien. */
export function sentItems(messages: Message[], prospects: Pick<Prospect, "id" | "company_name" | "email">[]): SentItem[] {
  const byId = names(prospects);
  const emails = new Map(prospects.map((prospect) => [prospect.id, prospect.email]));
  return messages
    .filter((message) => !message.deleted_at && byId.has(message.prospect_id))
    .filter((message) => message.status === "sent" || message.send_status === "failed")
    .map((message): SentItem => {
      const sent = message.status === "sent";
      return {
        id: message.id,
        prospectId: message.prospect_id,
        companyName: byId.get(message.prospect_id) as string,
        to: message.sent_to ?? (sent ? null : message.scheduled_to ?? null) ?? emails.get(message.prospect_id) ?? null,
        subject: message.subject,
        excerpt: excerptOf(message.body),
        body: message.body,
        type: message.type,
        typeLabel: typeFamily(message.type),
        status: sent ? "sent" : "failed",
        at: (sent ? message.sent_at : message.scheduled_at) ?? message.created_at,
        error: sent ? null : message.send_error ?? null,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Programmés : à venir, le plus proche d'abord. */
export function scheduledItems(messages: Message[], prospects: Pick<Prospect, "id" | "company_name">[]): ScheduledItem[] {
  const byId = names(prospects);
  return messages
    .filter(
      (message) =>
        !message.deleted_at &&
        message.status === "draft" &&
        (message.send_status === "scheduled" || message.send_status === "sending" || message.send_status === "blocked") &&
        message.scheduled_at &&
        byId.has(message.prospect_id),
    )
    .map((message) => ({
      id: message.id,
      prospectId: message.prospect_id,
      companyName: byId.get(message.prospect_id) as string,
      to: message.scheduled_to ?? null,
      subject: message.subject,
      scheduledAt: message.scheduled_at as string,
      sendError: message.send_error ?? null,
      sendStatus: message.send_status as SendStatus,
      body: message.body,
      type: message.type,
    }))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export interface MailboxCounts {
  recus: number;
  /**
   * Mails reçus pas encore LUS qui demandent une action : ni absence, ni
   * anti-spam déjà validé (lib/inbound/read-state). « Lu » n'est pas
   * « soldé » : un mail lu reste à traiter dans « Aujourd'hui ».
   */
  nonLus: number;
  envoyes: number;
  programmes: number;
}

export function mailboxCounts(
  inbound: InboundMessage[],
  messages: Message[],
  prospects: (Pick<Prospect, "id" | "company_name" | "email"> & Partial<Pick<Prospect, "key_figures">>)[],
): MailboxCounts {
  const received = inbound.filter((message) => !message.deleted_at);
  return {
    recus: received.length,
    nonLus: unreadBadgeCount(received, prospects as Pick<Prospect, "id" | "key_figures">[]),
    envoyes: sentItems(messages, prospects).length,
    programmes: scheduledItems(messages, prospects).length,
  };
}

/** Recherche insensible à la casse et aux accents, sur l'entreprise et l'objet. */
export function matches(query: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const needle = fold((query ?? "").trim());
  if (!needle) return true;
  return fields.some((field) => field && fold(field).includes(needle));
}

export const PAGE_SIZE = 20;

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
}

export interface ThreadItem {
  id: string;
  who: "moi" | "lui";
  subject: string | null;
  body: string;
  at: string;
  status?: "sent" | "failed";
}

/**
 * Fil d'une conversation : mails partis (et échecs) et mails reçus du même
 * prospect, mêlés dans l'ordre chronologique. Un brouillon n'en fait pas
 * partie : l'interlocuteur ne l'a jamais lu.
 */
export function conversation(prospectId: string, messages: Message[], inbound: InboundMessage[]): ThreadItem[] {
  const mine = messages
    .filter((message) => message.prospect_id === prospectId && !message.deleted_at)
    .filter((message) => message.status === "sent" || message.send_status === "failed")
    .map((message): ThreadItem => ({
      id: message.id,
      who: "moi",
      subject: message.subject,
      body: message.body,
      at: (message.status === "sent" ? message.sent_at : message.scheduled_at) ?? message.created_at,
      status: message.status === "sent" ? "sent" : "failed",
    }));
  const theirs = inbound
    .filter((message) => message.prospect_id === prospectId && !message.deleted_at)
    .map((message): ThreadItem => ({
      id: message.id,
      who: "lui",
      subject: message.subject,
      body: message.body,
      at: message.received_at,
    }));
  return [...mine, ...theirs].sort((a, b) => a.at.localeCompare(b.at));
}

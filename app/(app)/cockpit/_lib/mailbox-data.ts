import type { InboundMessage, Message, Prospect } from "@/types";
import {
  conversation,
  mailboxCounts,
  scheduledItems,
  sentItems,
  type MailboxCounts,
  type ScheduledItem,
  type SentItem,
  type ThreadItem,
} from "@/lib/outbox/mailbox";
import { inboxEntries } from "./compute";
import type { InboxEntry } from "./types";

export interface MailboxData {
  counts: MailboxCounts;
  received: InboxEntry[];
  sent: SentItem[];
  scheduled: ScheduledItem[];
}

/** Les trois onglets, à partir du portefeuille vivant (corbeilles exclues). */
export function buildMailbox(input: { prospects: Prospect[]; messages: Message[]; inbound: InboundMessage[] }): MailboxData {
  return {
    counts: mailboxCounts(input.inbound, input.messages, input.prospects),
    received: inboxEntries(input.inbound, input.prospects, Number.POSITIVE_INFINITY),
    sent: sentItems(input.messages, input.prospects),
    scheduled: scheduledItems(input.messages, input.prospects),
  };
}

/** Fils de conversation des prospects des mails affichés, et d'eux seuls. */
export function threadsFor(
  items: Pick<SentItem, "prospectId">[],
  messages: Message[],
  inbound: InboundMessage[],
): Record<string, ThreadItem[]> {
  const threads: Record<string, ThreadItem[]> = {};
  for (const { prospectId } of items) {
    threads[prospectId] ??= conversation(prospectId, messages, inbound);
  }
  return threads;
}

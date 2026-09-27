import type { Deal, InboundMessage, Message, Prospect, Reminder } from "@/types";
import { activeProspects, scopeToActive, type Db } from "./scope";

/**
 * Chargement commun des écrans Cockpit, Suivi, Prospection et Stats :
 * prospects vivants, et leurs données rattachées ramenées à la même portée.
 */

export type PortfolioPart = "messages" | "deals" | "reminders" | "inbound";

export interface Portfolio {
  prospects: Prospect[];
  messages: Message[];
  deals: Deal[];
  reminders: Reminder[];
  inbound: InboundMessage[];
}

export interface PortfolioOptions {
  /** Tri des prospects, du plus récent au plus ancien. */
  orderBy?: "created_at" | "updated_at";
  /** Relances non soldées seulement, par échéance. */
  openRemindersOnly?: boolean;
}

export async function loadPortfolio(
  db: Db,
  parts: readonly PortfolioPart[],
  options: PortfolioOptions = {},
): Promise<Portfolio & { error: string | null }> {
  const want = (part: PortfolioPart) => parts.includes(part);
  const empty = Promise.resolve({ data: [] as unknown[], error: null });

  let prospects = activeProspects(db);
  if (options.orderBy) prospects = prospects.order(options.orderBy, { ascending: false });

  let reminders = db.from("reminders").select("*");
  if (options.openRemindersOnly) reminders = reminders.eq("done", false).order("due_at");

  const [prospectResult, messages, deals, reminderResult, inbound] = await Promise.all([
    prospects,
    // Un mail à la corbeille disparaît avec la même portée qu'un prospect.
    want("messages") ? db.from("messages").select("*").is("deleted_at", null) : empty,
    want("deals") ? db.from("deals").select("*") : empty,
    want("reminders") ? reminders : empty,
    want("inbound") ? db.from("inbound_messages").select("*").is("deleted_at", null) : empty,
  ]);

  const alive = (prospectResult.data ?? []) as Prospect[];
  const scoped = scopeToActive(alive, {
    messages: (messages.data ?? []) as Message[],
    deals: (deals.data ?? []) as Deal[],
    reminders: (reminderResult.data ?? []) as Reminder[],
    inbound: (inbound.data ?? []) as InboundMessage[],
  });

  return { prospects: alive, ...scoped, error: prospectResult.error?.message ?? null };
}

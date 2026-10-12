import type { Deal, InboundMessage, Message, Prospect, Reminder } from "@/types";
import { activeProspects, scopeToActive, type Db } from "./scope";
import { readAllResult } from "@/lib/supabase/read-all";

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

  // TOUTES les lignes, page par page (Cowork #24) : un `select` sans pagination s'arrêtait
  // sans prévenir à 1 000 lignes. Tri final sur `id` pour des pages stables.
  const prospects = () => {
    const query = activeProspects(db);
    return (options.orderBy ? query.order(options.orderBy, { ascending: false }) : query).order("id");
  };
  const reminders = () => {
    const query = db.from("reminders").select("*");
    return (options.openRemindersOnly ? query.eq("done", false).order("due_at") : query).order("id");
  };

  const [prospectResult, messages, deals, reminderResult, inbound] = await Promise.all([
    readAllResult(prospects),
    // Un mail à la corbeille disparaît avec la même portée qu'un prospect.
    want("messages") ? readAllResult(() => db.from("messages").select("*").is("deleted_at", null).order("id")) : empty,
    want("deals") ? readAllResult(() => db.from("deals").select("*").order("id")) : empty,
    want("reminders") ? readAllResult(reminders) : empty,
    want("inbound") ? readAllResult(() => db.from("inbound_messages").select("*").is("deleted_at", null).order("id")) : empty,
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

import type { Deal, InboundMessage, Message, Prospect, Reminder } from "@/types";
import { readAll } from "@/lib/supabase/read-all";
import { activeProspects, scopeToActive, type Db } from "./scope";

/**
 * Chargement commun des écrans Cockpit, Suivi, Prospection et Stats :
 * prospects vivants, et leurs données rattachées ramenées à la même portée.
 *
 * Lecture COMPLÈTE (pages de 1 000) : PostgREST plafonne chaque réponse à
 * 1 000 lignes quel que soit le `select`, et les lignes manquantes ne font
 * aucun bruit. C'est ce qui avait fait afficher « 0 € » au Cockpit en octobre
 * (`api_usage`, 2 792 lignes) ; `messages` et `inbound_messages` grossissent de
 * la même façon. Tant qu'une table tient sous la page, cela ne coûte qu'un
 * seul aller-retour, comme avant (Cowork #22).
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
  const none = async <T>() => [] as T[];

  // `readAll` ajoute `.range()` : chaque appel doit reconstruire sa requête,
  // déjà triée, pour que les pages ne se chevauchent pas.
  const prospectQuery = () => {
    const query = activeProspects(db);
    return options.orderBy ? query.order(options.orderBy, { ascending: false }).order("id") : query.order("id");
  };
  const reminderQuery = () => {
    const query = db.from("reminders").select("*");
    return options.openRemindersOnly ? query.eq("done", false).order("due_at").order("id") : query.order("id");
  };

  let error: string | null = null;
  const [alive, messages, deals, reminders, inbound] = await Promise.all([
    readAll<Prospect>(prospectQuery as never).catch((reason: unknown) => {
      error = reason instanceof Error ? reason.message : String(reason);
      return [] as Prospect[];
    }),
    // Un mail à la corbeille disparaît avec la même portée qu'un prospect.
    want("messages")
      ? readAll<Message>(() => db.from("messages").select("*").is("deleted_at", null).order("id") as never)
      : none<Message>(),
    want("deals") ? readAll<Deal>(() => db.from("deals").select("*").order("id") as never) : none<Deal>(),
    want("reminders") ? readAll<Reminder>(reminderQuery as never) : none<Reminder>(),
    want("inbound")
      ? readAll<InboundMessage>(() => db.from("inbound_messages").select("*").is("deleted_at", null).order("id") as never)
      : none<InboundMessage>(),
  ]);

  const scoped = scopeToActive(alive, { messages, deals, reminders, inbound });

  return { prospects: alive, ...scoped, error };
}

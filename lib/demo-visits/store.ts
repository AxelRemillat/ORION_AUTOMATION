import { buildDemoRows, parisDay, type DemoRow, type DemoVisit } from "./model";

type Loose = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> };

/** +1 sur le compteur du jour (fonction SQL atomique, clé service). */
export async function recordDemoVisit(db: unknown, visit: DemoVisit, now = new Date()): Promise<boolean> {
  const { error } = await (db as Loose).rpc("increment_demo_visit", { p_day: parisDay(now), p_demo: visit.demo, p_v: visit.v, p_type: visit.type });
  return !error;
}

/** Encart du Cockpit : mails envoyés des 30 derniers jours et compteurs. Erreur ou table absente : aucune ligne. */
export async function loadDemoRows(db: unknown, now = new Date()): Promise<DemoRow[]> {
  try {
    const loose = db as Loose;
    const since = new Date(now.getTime() - 31 * 86_400_000);
    const [{ data: sent }, { data: counters }] = await Promise.all([
      loose.from("messages").select("body, sent_at").eq("status", "sent").is("deleted_at", null).gte("sent_at", since.toISOString()),
      loose.from("demo_visits_daily").select("day, demo, v, type, count").gte("day", parisDay(since)),
    ]);
    return buildDemoRows({ sent: sent ?? [], counters: counters ?? [], now });
  } catch {
    return [];
  }
}

/**
 * Troncature à 1 000 lignes (Cowork #24).
 *
 * PostgREST renvoie au plus 1 000 lignes par requête : un `select` sans pagination
 * s'arrêtait là SANS PRÉVENIR. Ce faux client reproduit exactement cette limite
 * (sans `.range()`, les 1 000 premières lignes seulement) et prouve que les lectures
 * corrigées lisent tout.
 */
import { readAll, readAllResult } from "../lib/supabase/read-all";
import { loadPortfolio } from "../lib/trash/portfolio";
import { knownSirens } from "../lib/trash/exclusions";
import { loadCapacity } from "../lib/today/capacity";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MAX_ROWS = 1000;
type Row = Record<string, unknown>;

/** Client minimal : `.eq/.is/.in/.not/.gte/.order` ignorés sauf `is(col, null)` et `eq`, plafond PostgREST de 1 000. */
function cappedDb(tables: Record<string, Row[]>) {
  const requests: { table: string; ranged: boolean }[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};
    const chain = (fn?: () => void) => () => (fn?.(), builder);
    builder.select = chain();
    builder.order = chain();
    builder.gte = chain();
    builder.not = chain();
    builder.in = chain();
    builder.limit = chain();
    builder.eq = (column: string, value: unknown) => ((rows = rows.filter((row) => !(column in row) || row[column] === value)), builder);
    builder.is = (column: string, value: unknown) => ((rows = rows.filter((row) => (row[column] ?? null) === value)), builder);
    builder.range = (start: number, end: number) => ((range = [start, end]), builder);
    builder.then = (resolve: (value: unknown) => unknown) => {
      requests.push({ table, ranged: range !== null });
      const page = range ? rows.slice(range[0], Math.min(range[1] + 1, range[0] + MAX_ROWS)) : rows.slice(0, MAX_ROWS);
      return Promise.resolve(resolve({ data: page, error: null }));
    };
    return builder;
  };
  return { db: { from } as never, requests };
}

async function main() {
  console.log("\n1. Le faux client reproduit bien la limite de PostgREST");
  {
    const { db } = cappedDb({ prospects: Array.from({ length: 2500 }, (_, index) => ({ id: `p${index}` })) });
    const direct = (await (db as { from: (t: string) => PromiseLike<{ data: Row[] }> }).from("prospects")).data;
    check("un select sans pagination s'arrête à 1 000 (le bug)", direct.length === 1000);
    check("readAll lit les 2 500", (await readAll(() => (db as never as { from: (t: string) => any }).from("prospects").select("*").order("id"))).length === 2500);
    const result = await readAllResult(() => (db as never as { from: (t: string) => any }).from("prospects").select("*").order("id"));
    check("readAllResult : même forme qu'une réponse Supabase, 2 500 lignes", result.error === null && result.data.length === 2500);
  }

  console.log("\n2. Portefeuille (Suivi, Prospection, statistiques) : plus de 1 000 prospects et mails");
  {
    const prospects = Array.from({ length: 1800 }, (_, index) => ({ id: `p${index}`, deleted_at: null, status: "contacte" }));
    const messages = Array.from({ length: 2600 }, (_, index) => ({ id: `m${index}`, prospect_id: `p${index % 1800}`, deleted_at: null, type: "intro" }));
    const reminders = Array.from({ length: 1300 }, (_, index) => ({ id: `r${index}`, prospect_id: `p${index}`, done: false }));
    const { db } = cappedDb({ prospects, messages, reminders, deals: [], inbound_messages: [] });
    const portfolio = await loadPortfolio(db, ["messages", "reminders", "deals"], { orderBy: "updated_at", openRemindersOnly: true });
    check("1 800 prospects lus (plus 1 000)", portfolio.prospects.length === 1800, String(portfolio.prospects.length));
    check("2 600 mails lus", portfolio.messages.length === 2600, String(portfolio.messages.length));
    check("1 300 relances ouvertes lues", portfolio.reminders.length === 1300, String(portfolio.reminders.length));
  }

  console.log("\n3. Dédoublonnage des SIREN (recherche, entonnoir) : rien n'est reproposé au-delà de 1 000");
  {
    const prospects = Array.from({ length: 1500 }, (_, index) => ({ id: `p${index}`, siren: String(100000000 + index) }));
    const { db } = cappedDb({ prospects, favorites: [], scan_history: [], excluded_companies: [] });
    const known = await knownSirens(db);
    check("les 1 500 SIREN connus (le 1 500e compris)", known.size === 1500 && known.has(String(100000000 + 1499)), String(known.size));
  }

  console.log("\n4. Plafond d'envoi du jour : les envois d'aujourd'hui comptent, même après 1 200 envois anciens");
  {
    const now = new Date("2026-10-12T10:00:00Z");
    const old = Array.from({ length: 1200 }, (_, index) => ({ id: `o${index}`, user_id: "u1", status: "sent", type: "intro", gmail_message_id: `g${index}`, sent_at: "2026-09-01T09:00:00Z" }));
    const today = Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, user_id: "u1", status: "sent", type: "intro", gmail_message_id: `gt${index}`, sent_at: "2026-10-12T08:0" + index + ":00Z" }));
    const { db } = cappedDb({ messages: [...old, ...today] });
    const capacity = await loadCapacity(db, "u1", now);
    check("6 envois aujourd'hui comptés (ils étaient au-delà de la 1 000e ligne)", capacity.sentToday === 6, String(capacity.sentToday));
  }

  console.log(failures === 0 ? "\nTous les tests troncature passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

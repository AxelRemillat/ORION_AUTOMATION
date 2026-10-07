/**
 * CONSOMMATION DU JOUR d'un service (lecture seule) — par opération et par
 * heure (Paris), pour savoir QUI a consommé un plafond.
 *
 *   npm run usage:jour -- linkup
 *   npm run usage:jour -- hunter
 */
import { db } from "./quality-live";
import { parisMidnight } from "@/lib/hunter/gate";
import { readAll } from "@/lib/supabase/read-all";
import { utcToParis } from "@/lib/outbox/paris-time";

async function main() {
  const service = (process.argv[2] ?? "linkup") as "linkup" | "hunter" | "pappers" | "openai";
  const since = parisMidnight(new Date()).toISOString();
  type Row = { operation: string | null; units: number | null; cost: number | null; created_at: string; prospect_id: string | null; source?: string | null };
  // Colonne `source` (Cowork #38) ; base pas encore migrée : lecture sans elle.
  const rows = await readAll<Row>(() =>
    db.from("api_usage").select("operation, units, cost, created_at, prospect_id, source").eq("service", service).gte("created_at", since).order("created_at").order("id"),
  ).catch(() =>
    readAll<Row>(() => db.from("api_usage").select("operation, units, cost, created_at, prospect_id").eq("service", service).gte("created_at", since).order("created_at").order("id")),
  );
  const units = (list: typeof rows) => list.reduce((total, row) => total + (Number(row.units) || 0), 0);
  const cost = (list: typeof rows) => list.reduce((total, row) => total + (Number(row.cost) || 0), 0);
  console.log(`${service} depuis minuit (Paris) : ${units(rows)} unité(s), ${cost(rows).toFixed(4)} €, ${rows.length} ligne(s)`);
  const bySource = new Map<string, typeof rows>();
  for (const row of rows) bySource.set(row.source ?? "(avant traçage)", [...(bySource.get(row.source ?? "(avant traçage)") ?? []), row]);
  console.log("Par source :");
  for (const [source, list] of [...bySource].sort((a, b) => units(b[1]) - units(a[1]))) console.log(`  ${source} : ${units(list)} (${cost(list).toFixed(4)} €)`);
  const byOp = new Map<string, typeof rows>();
  for (const row of rows) byOp.set(row.operation ?? "?", [...(byOp.get(row.operation ?? "?") ?? []), row]);
  console.log("Par opération :");
  for (const [op, list] of [...byOp].sort((a, b) => units(b[1]) - units(a[1]))) console.log(`  ${op} : ${units(list)} (${cost(list).toFixed(4)} €)`);
  const byHour = new Map<string, typeof rows>();
  for (const row of rows) {
    const { time } = utcToParis(new Date(row.created_at));
    const hour = `${time.slice(0, 2)}h`;
    byHour.set(hour, [...(byHour.get(hour) ?? []), row]);
  }
  console.log("Par heure (Paris) :");
  for (const [hour, list] of byHour) {
    const ops = [...new Set(list.map((row) => row.operation ?? "?"))].join(", ");
    console.log(`  ${hour} : ${units(list)} — ${ops}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

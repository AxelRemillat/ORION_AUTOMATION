/**
 * CHRONO DU PILOTAGE — le détail des 4 secondes du Cockpit.
 *
 * Chaque lecture de `loadPilotage` est mesurée séparément, avec le nombre de
 * lignes ramenées et le nombre de pages PostgREST qu'il a fallu.
 *
 *   npx tsx scripts/pilotage-chrono.ts [--runs 5]
 *
 * Lecture seule, clé service_role lue dans `.env.local` (hors requête HTTP).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readAll, PAGE_SIZE } from "../lib/supabase/read-all";
import { consumptionSince } from "../lib/usage/consumption";
import { READY_SCORE } from "../lib/usage/readiness";
import { cachedExact, fetchHunterExact, fetchPappersExact } from "../lib/usage/credits";

function loadEnv(): void {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE sont requis (.env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as { from: (table: string) => any };

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function time(label: string, work: () => Promise<string>): Promise<void> {
  await work().catch(() => "");
  const samples: number[] = [];
  let note = "";
  for (let pass = 0; pass < runs; pass += 1) {
    const started = Date.now();
    note = await work().catch((error: unknown) => `échec : ${error instanceof Error ? error.message : String(error)}`);
    samples.push(Date.now() - started);
  }
  console.log(`  ${label.padEnd(42)} ${String(median(samples)).padStart(6)} ms   ${note}`);
}

async function main(): Promise<void> {
  const now = new Date();
  const since = consumptionSince(now);
  console.log(`\nDétail de loadPilotage — médiane de ${runs} passes. Page PostgREST = ${PAGE_SIZE} lignes.\n`);

  await time("api_usage, 30 j (readAll page par page)", async () => {
    const rows = await readAll<{ id: string }>(() =>
      db.from("api_usage").select("service, units, cost, created_at").gte("created_at", since).order("created_at").order("id"),
    );
    return `${rows.length} lignes, ${Math.ceil(rows.length / PAGE_SIZE) + 1} aller-retours`;
  });

  await time("free_api_calls, 30 j (readAll)", async () => {
    const rows = await readAll<{ id: string }>(() =>
      db.from("free_api_calls").select("service, units, created_at").gte("created_at", since).order("created_at").order("id"),
    ).catch(() => []);
    return `${rows.length} lignes`;
  });

  await time("messages notés ≥ 9, 30 j (readAll)", async () => {
    const rows = await readAll<{ id: string }>(() =>
      db
        .from("messages")
        .select("id, created_at, quality_score, origin, type")
        .eq("type", "intro")
        .gte("quality_score", READY_SCORE)
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("id"),
    ).catch(() => []);
    return `${rows.length} lignes`;
  });

  await time("solde Hunter (cache 1 h, plafond 700 ms)", async () => {
    const value = await cachedExact("hunter", fetchHunterExact).catch(() => null);
    return value === null ? "indisponible" : "ok";
  });

  await time("solde Pappers (cache 1 h, plafond 700 ms)", async () => {
    const value = await cachedExact("pappers", fetchPappersExact).catch(() => null);
    return value === null ? "indisponible" : "ok";
  });

  // Ce que coûterait une agrégation faite par la base.
  await time("api_usage AGRÉGÉ par la base (vue)", async () => {
    const { data, error } = await db.from("api_usage_daily").select("day, service, calls, eur, units").gte("day", since.slice(0, 10));
    if (error) return `vue absente (${error.message})`;
    return `${(data ?? []).length} lignes`;
  });

  console.log("");
}

void main();

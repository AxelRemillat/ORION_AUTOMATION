/**
 * CHRONO DU COCKPIT — où partent les secondes.
 *
 * Mesure, contre la VRAIE base, chaque chargement du Cockpit séparément puis
 * leur exécution en parallèle (ce que fait la page). Médiane de 5 passes, après
 * une passe de chauffe non comptée.
 *
 *   npx tsx scripts/cockpit-chrono.ts [--runs 5]
 *
 * Lecture seule : aucun write, aucun envoi. Comme les autres scripts locaux, il
 * lit `.env.local` et parle à Supabase avec la clé service_role (hors requête
 * HTTP, donc hors RLS) — les requêtes sont les mêmes que celles des pages.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadPortfolio } from "../lib/trash/portfolio";
import { loadPilotage } from "../lib/usage/pilotage";
import { readPrefs } from "../lib/funnel/settings";
import { buildMailbox, threadsFor } from "../app/(app)/cockpit/_lib/mailbox-data";
import { buildAllPeriods } from "../app/(app)/cockpit/_lib/series";
import type { Db } from "../lib/trash/scope";

/** Charge `.env.local` sans dépendance : une ligne `CLE=valeur` à la fois. */
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
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as Db;

const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function time<T>(label: string, work: () => Promise<T>): Promise<{ label: string; ms: number; note: string }> {
  await work().catch(() => null); // chauffe (connexion, DNS, plan de requête)
  const samples: number[] = [];
  let note = "";
  for (let pass = 0; pass < runs; pass += 1) {
    const started = Date.now();
    const result = await work().catch((error: unknown) => {
      note = `échec : ${error instanceof Error ? error.message : String(error)}`;
      return null;
    });
    samples.push(Date.now() - started);
    if (!note && pass === 0) note = describe(result);
  }
  return { label, ms: median(samples), note };
}

/** Une ligne de contexte : combien de lignes ce chargement ramène. */
function describe(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const parts: string[] = [];
  for (const [field, value] of Object.entries(result as Record<string, unknown>)) {
    if (Array.isArray(value)) parts.push(`${field}=${value.length}`);
  }
  return parts.join(" ");
}

async function main(): Promise<void> {
  const now = new Date();
  console.log(`Chrono du Cockpit — médiane de ${runs} passes (+1 de chauffe), base réelle.\n`);

  const steps = [
    await time("loadPortfolio(messages, deals, inbound)", () => loadPortfolio(db, ["messages", "deals", "inbound"])),
    await time("loadPilotage (consommation, crédits, plafond)", () => loadPilotage(db, now)),
    await time("readPrefs", async () => ({ prefs: await readPrefs(db as never, "00000000-0000-0000-0000-000000000000").catch(() => null) })),
    await time("opportunities (plateformes)", async () => {
      const { data } = await (db as unknown as { from: (t: string) => any }).from("opportunities").select("*");
      return { rows: (data ?? []) as unknown[] };
    }),
  ];

  // Ce que fait la page : tout en parallèle, puis les agrégats purs.
  const page = await time("PAGE : les 4 lectures en parallèle", async () => {
    const [portfolio, pilotage] = await Promise.all([
      loadPortfolio(db, ["messages", "deals", "inbound"]),
      loadPilotage(db, now).catch(() => null),
    ]);
    const mailbox = buildMailbox(portfolio);
    threadsFor(mailbox.sent.slice(0, 10), portfolio.messages, portfolio.inbound);
    buildAllPeriods({ prospects: portfolio.prospects, messages: portfolio.messages, deals: portfolio.deals, inbound: portfolio.inbound }, now.getTime());
    return { prospects: portfolio.prospects, messages: portfolio.messages, inbound: portfolio.inbound, pilotage: pilotage ? [pilotage] : [] };
  });

  const rows = [...steps, page];
  const width = Math.max(...rows.map((row) => row.label.length));
  for (const row of rows) {
    console.log(`  ${row.label.padEnd(width)}  ${String(row.ms).padStart(6)} ms   ${row.note}`);
  }
  console.log("");
}

void main();

/**
 * MESURE de la page Aujourd'hui (Cowork #25) — LECTURE SEULE.
 *
 * Rejoue les chargeurs de app/(app)/aujourdhui/page.tsx avec un client Supabase connecté
 * comme Axel (RLS), en chronométrant CHAQUE requête (table, durée, lignes) et chaque
 * chargeur. Aucune écriture, aucun appel payant.
 *
 *   npx tsc -p tsconfig.test.json && node -r ./scripts/alias.cjs .test-build/scripts/mesure-aujourdhui.js
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadToday } from "@/lib/today/load";
import { loadCapacity } from "@/lib/today/capacity";
import { readPrefs } from "@/lib/funnel/settings";
import { lastPrepareHealth, livePrepareJob } from "@/lib/today/auto-run";
import { openAiBudget } from "@/lib/usage/budgets-server";
import { loadYieldPlan } from "@/lib/today/yield";
import { flatten } from "@/lib/today/group";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}

type Timing = { table: string; ms: number; rows: number; start: number };

async function main() {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: users } = await admin.auth.admin.listUsers();
  const user = users.users[0];
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: session } = await anon.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const token = session.session!.access_token;

  const origin = Date.now();
  const timings: Timing[] = [];
  // fetch chronométré : chaque requête PostgREST passe par lui.
  const timedFetch: typeof fetch = async (input, init) => {
    const started = Date.now();
    const response = await fetch(input, init);
    const url = new URL(String(input instanceof Request ? input.url : input));
    const table = url.pathname.replace("/rest/v1/", "");
    const range = response.headers.get("content-range");
    const rows = range ? Number(range.split("/")[0].split("-")[1] ?? -1) + 1 - Number(range.split("/")[0].split("-")[0] ?? 0) : -1;
    timings.push({ table, ms: Date.now() - started, rows, start: started - origin });
    return response;
  };
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: timedFetch },
  });

  const time = async <T>(label: string, work: () => Promise<T>) => {
    const started = Date.now();
    const result = await work();
    console.log(`  ${label.padEnd(18)} ${String(Date.now() - started).padStart(5)} ms`);
    return result;
  };

  const started = Date.now();
  console.log("Chargeurs (en parallèle, comme la page) :");
  const [data, capacity] = await Promise.all([
    time("loadToday", () => loadToday(db as never, user.id)),
    time("loadCapacity", () => loadCapacity(db as never, user.id)),
    time("readPrefs", () => readPrefs(db as never, user.id)),
    time("livePrepareJob", () => livePrepareJob(db, user.id)),
    time("lastPrepareHealth", () => lastPrepareHealth(db, user.id).catch(() => null)),
    time("openAiBudget", () => openAiBudget({ db: db as never }).catch(() => null)),
  ]);
  await time("loadYieldPlan", () => loadYieldPlan(db as never, user.id, capacity, flatten(data.groups)).catch(() => null));
  console.log(`TOTAL ${Date.now() - started} ms · ${timings.length} requêtes\n`);
  console.log("Requêtes (départ relatif, durée, lignes) :");
  for (const timing of timings.sort((a, b) => a.start - b.start)) console.log(`  +${String(timing.start).padStart(5)} ms  ${String(timing.ms).padStart(5)} ms  ${String(timing.rows).padStart(5)} l.  ${timing.table}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

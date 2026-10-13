/**
 * DIAGNOSTIC DES ALERTES CODEUR — LECTURE SEULE (Cowork #27).
 *
 * Pour chaque annonce Codeur des N derniers jours : ce qui est en base (statut,
 * état d'analyse, motif du pré-filtre, score) et le verdict que la veille a pu
 * renvoyer à n8n (qui ne notifie que sur « alerte »). Liste ensuite celles qui
 * N'ONT PAS alerté alors qu'elles auraient dû, avec la cause.
 *
 *   npx tsx scripts/codeur-diagnostic.ts [--jours 7] [--ids 491211,491207]
 *
 * Aucune écriture, aucun appel LLM. Comme les autres scripts locaux, il lit
 * `.env.local` et parle à Supabase avec la clé service_role.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { classifyAd } from "../lib/opportunities/prefilter";
import { laneOf } from "../lib/opportunities/lane";
import { ALERT_SCORE } from "../lib/opportunities/ingest";
import { fetchCodeurFeeds } from "../lib/opportunities/codeur-rss";

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
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const days = Number(arg("--jours") ?? 7);
const ids = (arg("--ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean);

type Row = {
  id: string; external_id: string | null; title: string; body: string; budget: string | null; categories: string[] | null;
  status: string; analysis_state: string | null; filter_reason: string | null; fit_score: number | null;
  fit_reasons: string[] | null; created_at: string; published_at: string | null; analyzed_at: string | null; source: string | null;
};

async function main(): Promise<void> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const query = db
    .from("opportunities")
    .select("id, external_id, title, body, budget, categories, status, analysis_state, filter_reason, fit_score, fit_reasons, created_at, published_at, analyzed_at, source")
    .eq("platform", "codeur")
    .order("created_at", { ascending: true });
  const { data, error } = ids.length ? await query.in("external_id", ids) : await query.gte("created_at", since);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  // Analyses du jour (plafond 60/jour) : pour dire si le plafond a joué.
  const perDay = new Map<string, number>();
  for (const row of rows) if (row.analyzed_at) perDay.set(row.analyzed_at.slice(0, 10), (perDay.get(row.analyzed_at.slice(0, 10)) ?? 0) + 1);

  console.log(`\n${rows.length} annonce(s) Codeur ${ids.length ? `(${ids.join(", ")})` : `sur ${days} jours`}\n`);
  // Les flux RSS officiels : le texte des fiches restées « titre seul », s'il y est encore.
  const feeds = await fetchCodeurFeeds();
  const missed: string[] = [];
  const causes = new Map<string, number>();
  for (const row of rows) {
    const feed = row.analysis_state === "titre_seul" ? feeds.get(row.external_id ?? "") : undefined;
    const description = feed?.description ?? row.body;
    const budget = feed?.budget_text ?? row.budget;
    const categories = feed?.categories ?? row.categories ?? [];
    const cls = classifyAd({ title: row.title, description, categories, budgetText: budget });
    const lane = laneOf({ platform: "codeur", title: row.title, description, categories, budget, published_at: row.published_at }, new Date(row.created_at));
    // Alertée sous les anciennes règles : score ≥ 7, ou voie « lancement » (motif enregistré).
    const alerted = (row.fit_score !== null && row.fit_score >= ALERT_SCORE) || (row.fit_reasons ?? []).some((reason) => reason.startsWith("Mission de lancement"));
    // Ce que les règles CORRIGÉES diraient sans LLM (régie, lancement, CMS compris).
    const nowAlert = !cls.reason && (lane === "lancement" || lane === "regie");
    let cause: string | null = null;
    if (row.analysis_state === "titre_seul" && !alerted) cause = nowAlert ? "titre seul (e-mail avant RSS), jamais analysée — alerte par les règles corrigées" : feed ? "titre seul (e-mail avant RSS), jamais analysée — à analyser (texte retrouvé dans le flux)" : "titre seul (e-mail avant RSS), jamais analysée — sortie du flux, texte perdu";
    else if (!alerted && nowAlert && !row.filter_reason) cause = cls.cms ? "CMS : « À voir » sous l'ancienne règle" : lane === "regie" ? "régie sur la stack : pas de règle avant #27" : "dev web : ni score ≥ 7 ni voie « lancement » enregistrée";
    else if (row.analysis_state === "pending" && row.fit_score === null) cause = "analyse inachevée (échéance dépassée)";
    if (!cause) continue;
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
    missed.push(`${row.created_at.slice(0, 16)} | ${row.external_id} | ${row.title.slice(0, 64)} | ${cause}`);
  }
  if (ids.length) return;
  console.log("Analyses par jour :", JSON.stringify(Object.fromEntries(perDay)));
  console.log(`\n${missed.length} annonce(s) ratée(s) ou jamais analysée(s) :\n`);
  for (const line of missed) console.log("  " + line);
  console.log("\nPar cause :");
  for (const [cause, count] of causes) console.log(`  ${String(count).padStart(3)}  ${cause}`);
}

void main();

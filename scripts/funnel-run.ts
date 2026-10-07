/**
 * DIAGNOSTIC d'un run de l'entonnoir (lecture seule) : statuts, motifs et
 * sources des signaux d'un run — par défaut celui du dernier job de préparation.
 *
 *   npm run funnel:run                 → dernier run
 *   npm run funnel:run -- --job <id>   → run d'un job précis
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main() {
  const userId = await ownerId();
  const jobId = value("--job");
  const query = db.from("jobs").select("id, state, created_at").eq("type", "search_signals").order("created_at", { ascending: false }).limit(1);
  const { data: jobs } = jobId ? await db.from("jobs").select("id, state, created_at").eq("id", jobId).limit(1) : await query;
  const job = (jobs ?? [])[0] as { id: string; state: { runId?: string; warnings?: { source?: string; message?: string }[]; harvest?: { collected: number; inserted: number; reopened: number; ft?: { read: number; head?: number; below?: number } } } | null; created_at: string } | undefined;
  const runId = job?.state?.runId;
  if (!runId) throw new Error("run introuvable");
  const rows = await readAll<{ source: string; statut: string; motif_rejet: string | null }>(() =>
    db.from("signal_candidates").select("source, statut, motif_rejet").eq("user_id", userId).eq("run_id", runId).order("id"),
  );
  console.log(`job ${job!.id} (${job!.created_at}) — run ${runId} : ${rows.length} signal(aux)`);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const motif = (row.motif_rejet ?? "").replace(/\d+/g, "N").slice(0, 70);
    const key = `${row.source} · ${row.statut}${motif ? ` · ${motif}` : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${key}`);
  const harvested = job!.state?.harvest;
  if (harvested) console.log(`Moisson : ${harvested.collected} signaux, ${harvested.inserted} nouveaux, ${harvested.collected - harvested.inserted} déjà vus, ${harvested.reopened} repris · France Travail ${harvested.ft?.read ?? 0} lues (tête ${harvested.ft?.head ?? "—"}, sous le curseur ${harvested.ft?.below ?? "—"})`);
  const warnings = job!.state?.warnings ?? [];
  if (warnings.length) console.log(`Avertissements de la moisson (${warnings.length}) :`);
  for (const warning of warnings.slice(0, 12)) console.log(`  · ${warning.source ?? "?"} : ${(warning.message ?? "").slice(0, 160)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

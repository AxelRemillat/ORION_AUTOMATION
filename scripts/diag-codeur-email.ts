/**
 * DIAGNOSTIC (lecture seule) : fiches Codeur créées par e-mail, par jour,
 * avec statut, état d'analyse et motif. Rien n'est écrit, aucun appel au modèle.
 *
 *   npx tsc -p tsconfig.test.json && node -r ./scripts/alias.cjs .test-build/scripts/diag-codeur-email.js 2026-10-08
 */
import { db } from "./quality-live";

async function main() {
  const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const since = process.argv[3] ?? `${day}T00:00:00Z`;
  const until = process.argv[4] ?? `${day}T23:59:59Z`;
  const { data, error } = await (db as never as { from: (t: string) => any })
    .from("opportunities")
    .select("id, title, source, status, analysis_state, filter_reason, fit_score, analyzed_at, created_at, external_id")
    .eq("platform", "codeur")
    .gte("created_at", since)
    .lte("created_at", until)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const key = (row: Record<string, unknown>) => `${row.source}|${row.status}|${row.analysis_state ?? "∅"}|${row.filter_reason ? "filtre" : "pas de filtre"}|${row.fit_score == null ? "score null" : "score"}`;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  console.log(`${rows.length} fiches Codeur créées entre ${since} et ${until}`);
  for (const [k, list] of groups) {
    console.log(`\n${list.length} × ${k}`);
    for (const row of list.slice(0, 40)) console.log(`  - ${String(row.title).slice(0, 70)} · motif : ${row.filter_reason ?? "—"} · score ${row.fit_score ?? "—"} · ${row.created_at}`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

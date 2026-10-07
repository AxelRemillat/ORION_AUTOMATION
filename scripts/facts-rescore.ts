/**
 * RECALCUL de facts_score par les règles déterministes (Cowork #37) — AUCUN
 * appel LLM : on rejoue lib/enrichment/facts-rules.ts sur les faits stockés.
 *
 *   npm run facts:rescore              → simulation : distribution avant / après
 *   npm run facts:rescore -- --apply   → écrit facts + facts_score (fusion, rien d'effacé)
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { rescoreFacts } from "@/lib/enrichment/facts-rules";
import type { SourcedFact } from "@/lib/enrichment/facts";

const APPLY = process.argv.includes("--apply");

type Row = { id: string; company_name: string; sector: string | null; key_figures: Record<string, unknown> | null };

const histogram = (scores: number[]) => [0, 1, 2, 3].map((score) => `${score} : ${scores.filter((value) => value === score).length}`).join(" · ");

async function main() {
  const userId = await ownerId();
  const rows = (await readAll<Row>(() => db.from("prospects").select("id, company_name, sector, key_figures").eq("user_id", userId).is("deleted_at", null).order("id"))).filter((row) =>
    Array.isArray(row.key_figures?.facts),
  );
  const before: number[] = [];
  const after: number[] = [];
  const changed: string[] = [];
  for (const row of rows) {
    const figures = row.key_figures!;
    const facts = figures.facts as SourcedFact[];
    const previous = Number(figures.facts_score ?? 0);
    const next = rescoreFacts(facts, row.sector, row.company_name);
    before.push(previous);
    after.push(next.score);
    if (next.score !== previous) changed.push(`${row.company_name} : ${previous} → ${next.score}`);
    if (APPLY) {
      // Relue juste avant l'écriture : fusion, aucun champ effacé.
      const { data } = await db.from("prospects").select("key_figures").eq("id", row.id).maybeSingle();
      const fresh = ((data as { key_figures?: Record<string, unknown> } | null)?.key_figures ?? figures) as Record<string, unknown>;
      await db.from("prospects").update({ key_figures: { ...fresh, facts: next.facts, facts_score: next.score, facts_rules: 1 } } as never).eq("id", row.id);
    }
  }
  console.log(`Fiches avec faits : ${rows.length}`);
  console.log(`Avant : ${histogram(before)}`);
  console.log(`Après : ${histogram(after)}`);
  console.log(`Changées (${changed.length}) :`);
  for (const line of changed) console.log(`  · ${line}`);
  console.log(APPLY ? "Écrit en base." : "SIMULATION : rien n'est écrit. Relancer avec --apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

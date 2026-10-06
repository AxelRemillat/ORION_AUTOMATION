/**
 * ÉVALUATION DES PROPOSITIONS au double juge (relecteur + client exigeant) sur
 * des annonces Codeur réelles en base (PAYANT, plafond 0,40 €).
 *
 *   npm run eval:proposals -- 8
 *
 * Rien n'est écrit en base. Pour chaque annonce : la proposition actuelle
 * (« avant ») et la nouvelle (« après »), note retenue, essais, coût.
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { analyzeOpportunity } from "@/lib/opportunities/analyze";
import { generateProposal } from "@/lib/opportunities/proposal";
import { freshScore } from "@/lib/opportunities/ingest";
import { proposalLanguage, type Opportunity } from "@/lib/opportunities/types";

const BUDGET_EUR = 0.4;
const count = Math.max(1, Number(process.argv[2]) || 8);

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const { data } = await (db as never as { from: (table: string) => any })
    .from("opportunities")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "codeur")
    .gte("fit_score", 5)
    .order("fit_score", { ascending: false })
    .limit(count * 2);
  const rows = ((data ?? []) as Opportunity[]).filter((row) => row.body && row.body.length > 120).slice(0, count);
  let ready = 0;
  let done = 0;
  for (const row of rows) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.03) break;
    const before = await spentSince(userId, started);
    const body = [row.body, row.categories?.length ? `Catégories : ${row.categories.join(" ; ")}` : ""].filter(Boolean).join("\n\n");
    const analysis = await analyzeOpportunity(liveAsk(null), { title: row.title, body, budget: row.budget, platform: row.platform });
    if (!analysis) continue;
    analysis.score = freshScore(analysis.score, row.published_at);
    const proposal = await generateProposal({ ask: liveAsk(null), platform: row.platform, language: proposalLanguage(row.platform, analysis.language), title: row.title, body, budget: row.budget, need: analysis.need, demo: analysis.demo, kind: analysis.kind });
    const cost = (await spentSince(userId, started)) - before;
    if ("error" in proposal) continue;
    done += 1;
    if (!proposal.needsReview) ready += 1;
    console.log(`\n=== ${row.title} (${row.budget ?? "budget ?"}) · adéquation ${analysis.score} · ${proposal.score ?? "?"}/10 en ${proposal.attempts} essai(s) · ${proposal.text.length} car. · ${proposal.amountEur ?? "?"} € / ${proposal.delayDays ?? "?"} j · ${cost.toFixed(3)} €${proposal.needsReview ? ` · À retravailler : ${proposal.reason}` : " · PRÊTE"}`);
    console.log(`--- AVANT ---\n${row.proposal ?? "(aucune)"}\n--- APRÈS ---\n${proposal.text}`);
  }
  const spent = await spentSince(userId, started);
  console.log(`\nPrêtes (double juge ≥ 9) : ${ready}/${done} · coût ${spent.toFixed(3)} € · ${done ? (spent / done).toFixed(3) : "—"} € par annonce`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

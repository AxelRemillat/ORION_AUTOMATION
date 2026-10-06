/**
 * RATTRAPAGE du périmètre full-stack (Cowork, 06/10/2026) : re-passe au
 * pré-filtre ACTUEL les opportunités Codeur des 14 derniers jours écartées par
 * l'ancien filtre (« Ignorée », analysis_state = filtre). Celles qui passent
 * maintenant sont analysées (LLM) et, si score ≥ 7, reçoivent leur brouillon
 * sur extrait. AUCUNE notification : rien ne passe par la route d'ingestion
 * (seul canal suivi par le workflow n8n) ; les annonces de plus de 24 h sont
 * marquées « vues » pour ne pas remplir les « Nouvelles alertes » d'annonces
 * déjà anciennes.
 *
 *   npm run reanalyze:filtered -- --dry   aperçu, aucune écriture, aucun appel
 *   npm run reanalyze:filtered            exécute (PAYANT, plafond 0,50 €)
 *
 * Aucune suppression, aucun envoi.
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { prefilterReason } from "@/lib/opportunities/prefilter";
import { analyzeOpportunity } from "@/lib/opportunities/analyze";
import { generateProposal } from "@/lib/opportunities/proposal";
import { PROPOSAL_SCORE, TO_REVIEW_SCORE, verdictOf } from "@/lib/opportunities/ingest";
import { proposalLanguage, type Opportunity } from "@/lib/opportunities/types";

const BUDGET_EUR = 0.5;
const DAYS = 14;
const dry = process.argv.includes("--dry");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const table = (db as never as { from: (name: string) => any }).from("opportunities");
  const { data, error } = await table.select("*").eq("user_id", userId).eq("platform", "codeur").eq("status", "ignoree").eq("analysis_state", "filtre").gte("created_at", since);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Opportunity[];
  const report = { examined: rows.length, stillFiltered: 0, reanalyzed: 0, alerte: [] as string[], a_voir: [] as string[], ignore: [] as string[], errors: 0 };

  for (const row of rows) {
    const reason = prefilterReason({ title: row.title, description: row.body, categories: row.categories ?? [], budgetText: row.budget });
    if (reason) {
      report.stillFiltered += 1;
      if (!dry && reason !== row.filter_reason) await (db as never as { from: (name: string) => any }).from("opportunities").update({ filter_reason: reason }).eq("id", row.id);
      continue;
    }
    if (dry) {
      report.a_voir.push(`(à analyser) ${row.title}`);
      continue;
    }
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.03) {
      console.log(`Arrêt : plafond de ${BUDGET_EUR} € atteint.`);
      break;
    }
    const body = [row.body, row.categories?.length ? `Catégories : ${row.categories.join(" ; ")}` : ""].filter(Boolean).join("\n\n");
    const analysis = await analyzeOpportunity(liveAsk(null), { title: row.title, body, budget: row.budget, platform: row.platform });
    if (!analysis) {
      report.errors += 1;
      continue;
    }
    const now = new Date().toISOString();
    const old = Date.now() - Date.parse(row.published_at ?? row.created_at) > 86_400_000;
    await (db as never as { from: (name: string) => any })
      .from("opportunities")
      .update({
        fit_score: analysis.score,
        fit_reasons: analysis.reasons,
        need: analysis.need,
        demo: analysis.demo,
        language: analysis.language,
        analyzed_at: now,
        analysis_state: "ok",
        filter_reason: null,
        status: analysis.score < TO_REVIEW_SCORE ? "ignoree" : "a_repondre",
        ...(old ? { seen_at: now } : {}),
        updated_at: now,
      })
      .eq("id", row.id);
    if (analysis.score >= PROPOSAL_SCORE) {
      const proposal = await generateProposal({
        ask: liveAsk(null),
        platform: row.platform,
        language: proposalLanguage(row.platform, analysis.language),
        title: row.title,
        body,
        budget: row.budget,
        need: analysis.need,
        demo: analysis.demo,
        kind: analysis.kind,
        maxRewrites: 1,
      });
      if (!("error" in proposal)) {
        await (db as never as { from: (name: string) => any })
          .from("opportunities")
          .update({
            proposal: proposal.text,
            proposal_score: proposal.score,
            proposal_reason: proposal.needsReview ? proposal.reason : null,
            proposal_on_excerpt: row.description_truncated === true,
            suggested_amount_eur: proposal.amountEur,
            suggested_delay_days: proposal.delayDays,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
    }
    report.reanalyzed += 1;
    const verdict = verdictOf(analysis.score);
    const label = `${analysis.score}/10 · ${analysis.kind} · ${row.title}`;
    if (verdict === "alerte") report.alerte.push(label);
    else if (verdict === "a_voir") report.a_voir.push(label);
    else report.ignore.push(label);
  }

  console.log(`\nExaminées : ${report.examined} · toujours filtrées : ${report.stillFiltered} · ré-analysées : ${report.reanalyzed} · erreurs : ${report.errors}`);
  console.log(`\nALERTE (${report.alerte.length}) :\n${report.alerte.map((line) => `- ${line}`).join("\n")}`);
  console.log(`\nÀ VOIR (${report.a_voir.length}) :\n${report.a_voir.map((line) => `- ${line}`).join("\n")}`);
  console.log(`\nIGNORÉES après analyse (${report.ignore.length}) :\n${report.ignore.map((line) => `- ${line}`).join("\n")}`);
  console.log(`\nCoût OpenAI : ${(await spentSince(userId, started)).toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

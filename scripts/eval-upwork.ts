/**
 * ESSAI DE BOUT EN BOUT — 3 annonces Upwork collées (PAYANT, plafond 1 $ ≈ 0,90 €).
 *
 *   npm run eval:upwork
 *
 * Même chemin que « Coller une annonce » : analyse, proposition Upwork
 * (accroche, ≤ 1 200 caractères, un prix en dollars, un délai), règles, double
 * juge avec la check-list anglaise. Rien n'est écrit en base hors la
 * comptabilité des appels ; rien n'est envoyé.
 */
import { liveAsk, ownerId, spentSince } from "./quality-live";
import { analyzeOpportunity } from "@/lib/opportunities/analyze";
import { generateProposal } from "@/lib/opportunities/proposal";
import { firstSentence, upworkFailures } from "@/lib/opportunities/platforms";
import { proposalLanguage } from "@/lib/opportunities/types";
import { isPlaceholder, UPWORK_ADS } from "./fixtures/upwork-ads";

const BUDGET_EUR = 0.9;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const table = ["| Annonce | Adéquation | Note | Essais | Car. | Prix | Délai | Prête ? |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  const ready = UPWORK_ADS.filter((ad) => !isPlaceholder(ad));
  if (!ready.length) {
    console.log("Aucune annonce à tester : collez le texte des annonces dans scripts/fixtures/upwork-ads.ts (à la place du marqueur).");
    return;
  }
  for (const ad of ready) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.15) {
      console.log("Plafond de dépense atteint : arrêt.");
      break;
    }
    const before = await spentSince(userId, started);
    const analysis = await analyzeOpportunity(liveAsk(null), { title: ad.title, body: ad.body, budget: ad.budget, platform: "upwork" });
    if (!analysis) {
      console.log(`\n=== ${ad.title} : analyse indisponible`);
      continue;
    }
    const proposal = await generateProposal({ ask: liveAsk(null), platform: "upwork", language: proposalLanguage("upwork", analysis.language), title: ad.title, body: ad.body, budget: ad.budget, need: analysis.need, demo: analysis.demo, kind: analysis.kind });
    const cost = (await spentSince(userId, started)) - before;
    if ("error" in proposal) {
      console.log(`\n=== ${ad.title} : ${proposal.error}`);
      continue;
    }
    const price = proposal.amountEur != null ? `$${proposal.amountEur}${proposal.hourly ? "/hr" : ""}` : "?";
    console.log(`\n=== ${ad.title} (${ad.budget}) · adéquation ${analysis.score} · ${proposal.score ?? "?"}/10 en ${proposal.attempts} essai(s) · ${proposal.text.length} car. · ${price} / ${proposal.delayDays ?? "?"} j · ${cost.toFixed(3)} €${proposal.needsReview ? ` · À retravailler : ${proposal.reason}` : " · PRÊTE"}`);
    console.log(`Aperçu (1re phrase) : ${firstSentence(proposal.text)}`);
    console.log(`--- PROPOSITION ---\n${proposal.text}`);
    const residual = upworkFailures(proposal.text, proposal.text);
    if (residual.length) console.log(`Règles Upwork sur le texte final : ${residual.join(" | ")}`);
    table.push(`| ${ad.title.slice(0, 55)} | ${analysis.score} | ${proposal.score ?? "?"}/10 | ${proposal.attempts} | ${proposal.text.length} | ${price} | ${proposal.delayDays ?? "?"} j | ${proposal.needsReview ? `non — ${(proposal.reason ?? "").slice(0, 80)}` : "OUI"} |`);
  }
  const spent = await spentSince(userId, started);
  console.log(`\n${table.join("\n")}\n\nCoût total : ${spent.toFixed(3)} € (plafond ${BUDGET_EUR} €)`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

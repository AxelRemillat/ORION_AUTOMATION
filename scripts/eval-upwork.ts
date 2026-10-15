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
import { UPWORK_ADS_63 } from "./fixtures/upwork-ads-63";
import { upworkLaunchPrice } from "@/lib/opportunities/upwork-launch";
import { UPWORK_PORTFOLIO } from "@/lib/opportunities/upwork-portfolio";

/** Contrôles de Cowork #63 sur le texte final : titre exact, lien /en + ref=upwork, aucun contact, prix de lancement, 1 question. */
function cowork63(text: string, budget: string): string[] {
  const issues: string[] = [];
  // BLOQUANT (Cowork #64) : tout titre cité appartient à UPWORK_PORTFOLIO et y est PUBLIÉ.
  const cited = [...text.matchAll(/portfolio: "([^"]+)"/g)].map((match) => match[1]);
  if (!cited.length) issues.push("aucun projet du portfolio cité");
  for (const title of cited) {
    const project = UPWORK_PORTFOLIO.find((item) => item.titre === title);
    if (!project) issues.push(`titre absent du portfolio Upwork : « ${title} »`);
    else if (!project.publie) issues.push(`projet non publié cité : « ${title} »`);
    else if (!text.includes(project.lien)) issues.push(`lien de démo de « ${title} » absent (${project.lien})`);
  }
  for (const url of text.match(/(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\/[^\s)]*/gi) ?? []) {
    if (!/^(?:https?:\/\/)?axelremillat\.com\/en\//.test(url) || !/[?&]ref=upwork(&|$)/.test(url)) issues.push(`lien non autorisé : ${url}`);
  }
  if (/@|\+?\d[\d .]{8,}\d|calendly\.com|whatsapp|skype|telegram/i.test(text)) issues.push("contact hors plateforme");
  if (text.length > 1200) issues.push(`${text.length} caractères`);
  if ((text.match(/\?(?!\w)/g) ?? []).length !== 1) issues.push(`${(text.match(/\?(?!\w)/g) ?? []).length} questions`);
  const launch = upworkLaunchPrice(budget);
  if (launch.usd !== null && !text.includes(launch.kind === "hourly" ? `$${launch.usd}/hr` : `$${launch.usd}`)) issues.push(`prix de lancement $${launch.usd} absent`);
  return issues;
}

const BUDGET_EUR = 0.9;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  let blocking = 0;
  const table = ["| Annonce | Adéquation | Note | Essais | Car. | Prix | Délai | Prête ? |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  const ready = (process.argv.includes("63") ? UPWORK_ADS_63 : UPWORK_ADS).filter((ad) => !isPlaceholder(ad));
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
    const issues = cowork63(proposal.text, ad.budget);
    console.log(`Contrôles #63 : ${issues.length ? issues.join(" | ") : "tous OK"}`);
    // Cowork #64 : un titre absent du portfolio Upwork, ou non publié, fait ÉCHOUER l'essai.
    if (issues.some((issue) => /portfolio|non publié|lien de démo/.test(issue))) blocking += 1;
    table.push(`| ${ad.title.slice(0, 55)} | ${analysis.score} | ${proposal.score ?? "?"}/10 | ${proposal.attempts} | ${proposal.text.length} | ${price} | ${proposal.delayDays ?? "?"} j | ${proposal.needsReview ? `non — ${(proposal.reason ?? "").slice(0, 80)}` : "OUI"} |`);
  }
  const spent = await spentSince(userId, started);
  console.log(`\n${table.join("\n")}\n\nCoût total : ${spent.toFixed(3)} € (plafond ${BUDGET_EUR} €)`);
  if (blocking) {
    console.log(`ÉCHEC : ${blocking} proposition(s) citent un projet absent ou non publié du portfolio Upwork.`);
    process.exitCode = 1;
  } else console.log("Portfolio : tous les titres cités sont publiés sur le profil Upwork.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

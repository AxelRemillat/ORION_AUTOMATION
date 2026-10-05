/**
 * CALIBRAGE du juge des propositions + DÉMO sur deux annonces fictives.
 *
 *   npm run calibrate:proposals            juge sur 4 positifs / 4 négatifs (PAYANT, ~0,01 €)
 *   npm run calibrate:proposals -- --demo  + analyse et proposition sur 2 annonces fictives
 *
 * Aucune écriture en base (hors journal de coût), aucun envoi.
 */
import { liveAsk, ownerId, spentSince } from "./quality-live";
import { judgeProposal, generateProposal, PROPOSAL_PASS, assembleProposal } from "@/lib/opportunities/proposal";
import { analyzeOpportunity } from "@/lib/opportunities/analyze";
import { PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "@/lib/opportunities/calibration";
import { proposalLanguage, type Platform } from "@/lib/opportunities/types";

const SIGNATURE = "Axel Remillat\nAutomatisation & IA pour PME · axelremillat.com/pme";

const DEMO_ADS: { platform: Platform; title: string; budget: string | null; body: string }[] = [
  {
    platform: "codeur",
    title: "Automatiser la préparation de nos devis de menuiserie",
    budget: "1 000 à 2 000 €",
    body: "Menuiserie de 12 personnes. Nous recevons chaque semaine une trentaine de demandes de devis par e-mail et via le formulaire du site (fenêtres, portes, volets, avec dimensions et photos). Aujourd'hui notre secrétaire ressaisit tout dans notre tableur de chiffrage, puis le gérant ajuste les prix. Nous voulons gagner du temps : extraction automatique des informations des demandes et préparation d'un brouillon de devis dans notre format, que le gérant valide. Nous utilisons Gmail et Google Sheets. Démarrage souhaité sous un mois.",
  },
  {
    platform: "upwork",
    title: "Automate invoice reminders between QuickBooks and Gmail",
    budget: null,
    body: "We are a small B2B services company (8 people) using QuickBooks Online for invoicing. Overdue invoices are chased manually by our office manager, often late. We want an automation that checks overdue invoices daily, drafts a polite reminder email in Gmail adapted to how late the payment is, and lets us approve before sending. Bonus: a simple weekly summary of outstanding amounts. Please describe your approach and timeline.",
  },
];

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const ask = liveAsk(null);
  let failures = 0;

  console.log("Calibrage du juge des propositions");
  for (const [label, items, expectPass] of [["positif", PROPOSAL_POSITIVES, true], ["négatif", PROPOSAL_NEGATIVES, false]] as const) {
    for (const item of items) {
      const { core } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform, signature: SIGNATURE });
      const verdict = await judgeProposal(ask, { title: item.title, body: item.ad, budget: item.budget, text: core }, "opportunites:calibrage");
      const ok = verdict !== null && (verdict.score >= PROPOSAL_PASS) === expectPass;
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCART"} ${label} ${item.platform} « ${item.title.slice(0, 50)} » : ${verdict?.score ?? "?"}`);
    }
  }
  const calibrationCost = await spentSince(userId, started);

  if (process.argv.includes("--demo")) {
    for (const ad of DEMO_ADS) {
      const before = await spentSince(userId, started);
      const analysis = await analyzeOpportunity(ask, ad);
      if (!analysis) {
        console.log(`\n${ad.title} : analyse indisponible`);
        continue;
      }
      const proposal = await generateProposal({
        ask,
        platform: ad.platform,
        language: proposalLanguage(ad.platform, analysis.language),
        title: ad.title,
        body: ad.body,
        budget: ad.budget,
        need: analysis.need,
        demo: analysis.demo,
        signature: SIGNATURE,
      });
      const cost = (await spentSince(userId, started)) - before;
      console.log(`\n=== ${ad.platform.toUpperCase()} — ${ad.title}`);
      console.log(`Adéquation ${analysis.score}/10 · démo ${analysis.demo} · langue ${analysis.language}`);
      for (const reason of analysis.reasons) console.log(`  - ${reason}`);
      console.log(`Besoin : ${analysis.need}`);
      if ("error" in proposal) console.log(proposal.error);
      else console.log(`Proposition ${proposal.score ?? "?"}/10 en ${proposal.attempts} essai(s)${proposal.needsReview ? ` → À revoir (${proposal.reason})` : ""} · coût ${cost.toFixed(4)} €\n\n${proposal.text}`);
    }
  }
  console.log(`\nCalibrage : ${failures ? `${failures} écart(s)` : "conforme"} · coût calibrage ${calibrationCost.toFixed(4)} € · total ${(await spentSince(userId, started)).toFixed(4)} €`);
  process.exit(failures ? 1 : 0);
}

void main();

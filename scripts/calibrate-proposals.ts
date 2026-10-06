/**
 * CALIBRAGE du juge des propositions + DÉMO sur deux annonces fictives.
 *
 *   npm run calibrate:proposals            juge sur 4 positifs / 4 négatifs (PAYANT, ~0,01 €)
 *   npm run calibrate:proposals -- --demo  + analyse et proposition sur 2 annonces fictives
 *
 * Aucune écriture en base (hors journal de coût), aucun envoi.
 */
import { liveAsk, ownerId, spentSince } from "./quality-live";
import { judgeProposal, judgeProposalClient, combineVerdicts, generateProposal, PROPOSAL_PASS, assembleProposal, checkProposal } from "@/lib/opportunities/proposal";
import { analyzeOpportunity } from "@/lib/opportunities/analyze";
import { AXEL_SENT, PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "@/lib/opportunities/calibration";
import { requestedItems } from "@/lib/opportunities/requests";
import { proposalLanguage, type Platform } from "@/lib/opportunities/types";


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
      const { core, text } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform, kind: item.kind, context: item.ad });
      // En production, le juge ne voit que ce qui passe les règles : un négatif est conforme s'il est refusé par l'un OU l'autre.
      const rules = checkProposal(item, core, { language: item.language, budget: item.budget, platform: item.platform, kind: item.kind, requested: requestedItems(item.ad), ad: item.ad }, text);
      const verdict = await judgeProposal(ask, { title: item.title, body: item.ad, budget: item.budget, text: core, platform: item.platform }, "opportunites:calibrage");
      const judged = verdict !== null && verdict.score >= PROPOSAL_PASS;
      const ok = expectPass ? rules.ok && judged : !rules.ok || !judged;
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCART"} ${label} ${item.platform} « ${item.title.slice(0, 50)} » : juge ${verdict?.score ?? "?"} · règles ${rules.ok ? "OK" : `refus (${rules.failures[0]?.slice(0, 60)})`}`);
    }
  }
  // Les 3 propositions RÉELLEMENT envoyées par Axel (Cowork #31) : les deux juges doivent leur donner 9 ou plus.
  console.log("Propositions envoyées par Axel (double juge)");
  for (const item of AXEL_SENT) {
    const [relecteur, client] = await Promise.all([
      judgeProposal(ask, { title: item.title, body: item.ad, budget: item.budget, text: item.text, platform: "codeur" }, "opportunites:calibrage"),
      judgeProposalClient(ask, { title: item.title, body: item.ad, budget: item.budget, text: item.text, platform: "codeur" }, "opportunites:calibrage-client"),
    ]);
    const verdict = combineVerdicts(relecteur, client);
    const ok = verdict !== null && verdict.score >= PROPOSAL_PASS;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "ok  " : "ÉCART"} « ${item.title.slice(0, 50)} » (${item.text.length} car.) : relecteur ${relecteur?.score ?? "?"} · client ${client?.score ?? "?"}${ok ? "" : ` — ${verdict?.reasons.slice(1, 3).join(" ; ")}`}`);
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

/**
 * Opportunités (Codeur, Upwork…) : saisie, analyse, proposition, suivi, stats.
 * Fixtures uniquement, aucun appel réel.
 */
import { parseNewOpportunity, buildOpportunityPatch } from "../lib/opportunities/input";
import { opportunityDemoUrl, parseAnalysis } from "../lib/opportunities/analyze";
import { assembleProposal, checkProposal, generateProposal, parseProposalVerdict, PROPOSAL_WORDS } from "../lib/opportunities/proposal";
import { PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "../lib/opportunities/calibration";
import { platformStats } from "../lib/opportunities/stats";
import { proposalLanguage } from "../lib/opportunities/types";
import { countWords } from "../lib/emails/quality/template";
import type { AskFn } from "../lib/ai/chat";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SIGNATURE = "Axel Remillat\nAutomatisation & IA pour PME · axelremillat.com/pme";

async function main() {
  console.log("\n1. Saisie");
  {
    const ok = parseNewOpportunity({ platform: "codeur", title: "Tri des e-mails", body: "Nous recevons 80 e-mails de commande par jour à recopier dans un tableur.", url: "https://www.codeur.com/projects/1", budget: "500 €", deadline: "2026-10-20" });
    check("annonce valide acceptée", ok.ok);
    check("plateforme inconnue refusée", !parseNewOpportunity({ platform: "fiverr", title: "x", body: "y".repeat(50) }).ok);
    check("texte trop court refusé", !parseNewOpportunity({ platform: "codeur", title: "x", body: "court" }).ok);
    check("URL sans http refusée", !parseNewOpportunity({ platform: "codeur", title: "x", body: "y".repeat(50), url: "codeur.com" }).ok);
  }

  console.log("\n2. Suivi : envoyée, réponse, montant");
  {
    const now = new Date("2026-10-05T12:00:00Z");
    const sent = buildOpportunityPatch({ status: "envoyee" }, { status: "a_repondre", sent_at: null, replied_at: null }, now);
    check("« Marquer envoyée » pose sent_at", sent.ok && sent.patch.status === "envoyee" && sent.patch.sent_at === now.toISOString());
    const replied = buildOpportunityPatch({ status: "reponse" }, { status: "envoyee", sent_at: "2026-10-04T10:00:00Z", replied_at: null }, now);
    check("une réponse pose replied_at, sent_at gardé", replied.ok && replied.patch.replied_at === now.toISOString() && !("sent_at" in replied.patch));
    const ignored = buildOpportunityPatch({ status: "ignoree" }, { status: "a_repondre", sent_at: null, replied_at: null }, now);
    check("ignorée : jamais comptée envoyée", ignored.ok && !("sent_at" in ignored.patch));
    const amount = buildOpportunityPatch({ amount_eur: "1 200,50" }, { status: "gagnee", sent_at: "x", replied_at: "x" }, now);
    check("montant signé « 1 200,50 » → 1200.5", amount.ok && amount.patch.amount_eur === 1200.5);
    check("statut inconnu refusé", !buildOpportunityPatch({ status: "envoye" }, { status: "a_repondre", sent_at: null, replied_at: null }).ok);
  }

  console.log("\n3. Langue et lien de démo");
  check("Codeur → FR, Upwork → EN, Autre → langue de l'annonce", proposalLanguage("codeur", "en") === "fr" && proposalLanguage("upwork", "fr") === "en" && proposalLanguage("autre", "en") === "en");
  check("lien suivi &src=codeur", opportunityDemoUrl("emails", "codeur") === "axelremillat.com/automatisations?demo=email&src=codeur");
  check("lien suivi ?src=upwork sur /agent", opportunityDemoUrl("devis", "upwork") === "axelremillat.com/agent?src=upwork");
  const analysis = parseAnalysis(JSON.stringify({ score: 12, reasons: ["a", "b", "c", "d"], need: "Trier les e-mails", demo: "inconnue", language: "en" }));
  check("analyse : score borné à 10, 3 raisons, démo inconnue → générale", analysis?.score === 10 && analysis.reasons.length === 3 && analysis.demo === "general" && analysis.language === "en");
  check("analyse illisible → null", parseAnalysis("pas du JSON") === null);

  console.log("\n4. Règles : les positifs du calibrage passent, les négatifs sont attrapés");
  for (const item of PROPOSAL_POSITIVES) {
    const { core, text } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform, signature: SIGNATURE });
    const rules = checkProposal(item, core, { language: item.language, budget: item.budget });
    check(`positif ${item.platform} « ${item.title.slice(0, 40)} » (${countWords(core)} mots)`, rules.ok && text.endsWith(SIGNATURE) && core.includes(`src=${item.platform}`), rules.failures.join(" | "));
  }
  const caught = PROPOSAL_NEGATIVES.map((item) => {
    const { core } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform, signature: SIGNATURE });
    return checkProposal(item, core, { language: item.language, budget: item.budget });
  });
  check("négatifs : tous refusés par les règles (longueur, flatterie, chiffres inventés, jargon, prix sans budget)", caught.every((rules) => !rules.ok), caught.map((rules) => rules.failures[0]).join(" | "));
  check("chiffres inventés attrapés (« 30 PME », « 40 % »)", caught[1].failures.some((line) => /non prouvés/.test(line)));
  check("prix sans budget attrapé", caught[1].failures.some((line) => /Budget absent/.test(line)));
  check("jargon attrapé (leverage)", caught[2].failures.some((line) => /Jargon/.test(line)));
  check("flatterie attrapée (« Super projet »)", caught[0].failures.some((line) => /Flatterie/.test(line)));

  console.log("\n5. Boucle : juge ≥ 9, 2 réécritures au plus, meilleur essai gardé");
  {
    const good = PROPOSAL_POSITIVES[0];
    const goodJson = JSON.stringify({ reading: good.reading, steps: good.steps, framing: good.framing, question: good.question });
    const verdict = (score: number) => JSON.stringify({ criteria: { lecture: Math.min(3, score - 7 + 0), approche: 3, cadrage: 2, ton: 2 }, reasons: score >= 9 ? [] : ["reformulation générique"], fix: score >= 9 ? null : "Reprends les éléments de l'annonce." });
    const scripted = (writer: string[], judge: string[]) => {
      const calls: string[] = [];
      const ask: AskFn = async (role) => {
        calls.push(role);
        return role === "writer" ? writer.shift() ?? "" : judge.shift() ?? "";
      };
      return { ask, calls };
    };
    const base = { platform: "codeur" as const, language: "fr" as const, title: good.title, body: good.ad, budget: good.budget, need: "Trier les commandes", demo: "emails" as const, signature: SIGNATURE };
    {
      const { ask, calls } = scripted([goodJson], [verdict(10)]);
      const outcome = await generateProposal({ ...base, ask });
      check("10/10 du premier coup : prête, un seul appel de rédaction", "text" in outcome && !outcome.needsReview && outcome.attempts === 1 && calls.join(",") === "writer,judge", calls.join(","));
    }
    {
      const flattering = JSON.stringify({ reading: `Super projet ! ${good.reading}`, steps: good.steps, framing: good.framing, question: good.question });
      const { ask, calls } = scripted([flattering, goodJson], [verdict(9)]);
      const outcome = await generateProposal({ ...base, ask });
      check("règle cassée → réécrite sans payer le juge", calls.join(",") === "writer,writer,judge" && "text" in outcome && !outcome.needsReview, calls.join(","));
    }
    {
      const { ask } = scripted([goodJson, goodJson, goodJson], [verdict(7), verdict(8), verdict(7)]);
      const outcome = await generateProposal({ ...base, ask });
      check("toujours < 9 : 3 essais, meilleur gardé (8), « À revoir » avec la raison", "text" in outcome && outcome.needsReview && outcome.attempts === 3 && outcome.score === 8 && /Note 8\/10/.test(outcome.reason ?? ""), JSON.stringify("text" in outcome ? { s: outcome.score, r: outcome.reason } : outcome));
    }
    check("juge : note bornée par la grille", parseProposalVerdict(JSON.stringify({ criteria: { lecture: 9, approche: 3 } }))?.score === 6);
    check(`longueur : ${PROPOSAL_WORDS.min} à ${PROPOSAL_WORDS.max} mots`, PROPOSAL_WORDS.min === 120 && PROPOSAL_WORDS.max === 180);
  }

  console.log("\n6. Statistiques par plateforme");
  {
    const stats = platformStats([
      { platform: "codeur", status: "envoyee", sent_at: "x", replied_at: null, amount_eur: null },
      { platform: "codeur", status: "gagnee", sent_at: "x", replied_at: "x", amount_eur: 1200 },
      { platform: "codeur", status: "perdue", sent_at: "x", replied_at: "x", amount_eur: null },
      { platform: "codeur", status: "a_repondre", sent_at: null, replied_at: null, amount_eur: null },
      { platform: "upwork", status: "ignoree", sent_at: null, replied_at: null, amount_eur: null },
    ]);
    const codeur = stats.find((row) => row.platform === "codeur");
    check("Codeur : 3 envoyées, 2 réponses (perdue après réponse comprise), 1 gagnée, 1 200 €", codeur?.sent === 3 && codeur.replies === 2 && codeur.won === 1 && codeur.revenueEur === 1200, JSON.stringify(codeur));
    check("Upwork : ignorée → 0 envoyée", stats.find((row) => row.platform === "upwork")?.sent === 0);
    check("plateformes sans saisie : absentes", !stats.some((row) => row.platform === "malt"));
  }

  console.log(failures === 0 ? "\nTous les tests opportunités passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

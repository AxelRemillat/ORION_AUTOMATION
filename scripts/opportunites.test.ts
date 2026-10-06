/**
 * Opportunités (Codeur, Upwork…) : saisie, analyse, proposition, suivi, stats.
 * Fixtures uniquement, aucun appel réel.
 */
import { parseNewOpportunity, buildOpportunityPatch } from "../lib/opportunities/input";
import { analyzeOpportunity, opportunityDemoUrl, parseAnalysis } from "../lib/opportunities/analyze";
import { assembleProposal, buildProposalJudgePrompt, checkProposal, contactFailures, demoLine, generateProposal, parseProposalVerdict, proposalSignature, PROPOSAL_WORDS } from "../lib/opportunities/proposal";
import { PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "../lib/opportunities/calibration";
import { platformStats } from "../lib/opportunities/stats";
import { proposalLanguage } from "../lib/opportunities/types";
import { countWords } from "../lib/emails/quality/template";
import type { AskFn } from "../lib/ai/chat";
import { FakeDb } from "./fake-supabase";
import { ingestOpportunity, parseIngestBody, type IngestBody } from "../lib/opportunities/ingest";
import { prefilterReason } from "../lib/opportunities/prefilter";
import { requestedItems } from "../lib/opportunities/requests";
import { ageLabel, bucketOf, unseenAlerts } from "../lib/opportunities/view";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}


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
    const { core, text } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform });
    const rules = checkProposal(item, core, { language: item.language, budget: item.budget, platform: item.platform, kind: item.kind, requested: requestedItems(item.ad), ad: item.ad }, text);
    const shape =
      item.platform === "codeur"
        ? text.endsWith(`\n\nAxel Remillat`) && core.includes("visible dans mon portfolio Codeur (") && !/axelremillat|https?:/.test(text)
        : text.endsWith("Axel Remillat · AI & automation for small businesses") && core.includes(`src=${item.platform}`);
    check(`positif ${item.platform} « ${item.title.slice(0, 40)} » (${countWords(core)} mots)`, rules.ok && shape, rules.failures.join(" | "));
  }
  const caught = PROPOSAL_NEGATIVES.map((item) => {
    const { core, text } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform });
    return checkProposal(item, core, { language: item.language, budget: item.budget, platform: item.platform, kind: item.kind, requested: requestedItems(item.ad), ad: item.ad }, text);
  });
  check("négatifs : tous refusés par les règles (coordonnées Codeur, longueur, flatterie, chiffres inventés, jargon, prix sans budget)", caught.every((rules) => !rules.ok), caught.map((rules) => rules.failures[0]).join(" | "));
  check("Codeur : URL et e-mail dans la proposition attrapés", caught[1].failures.some((line) => /Codeur : aucune URL/.test(line)) && caught[1].failures.some((line) => /Adresse e-mail/.test(line)), caught[1].failures.join(" | "));
  check("chiffres inventés attrapés (« 30 PME », « 40 % »)", caught[3].failures.some((line) => /non prouvés/.test(line)));
  check("prix sans budget attrapé", caught[3].failures.some((line) => /Budget absent/.test(line)));
  check("jargon attrapé (leverage)", caught[4].failures.some((line) => /Jargon/.test(line)));
  check("flatterie attrapée (« Super projet »)", caught[2].failures.some((line) => /Flatterie/.test(line)));

  console.log("\n4b. Coordonnées et signatures par plateforme (CGU Codeur)");
  {
    check("Codeur : signature = nom seul", proposalSignature("codeur", "fr") === "Axel Remillat");
    check("Upwork : signature anglaise, sans site ni téléphone", proposalSignature("upwork", "en") === "Axel Remillat · AI & automation for small businesses");
    check("Malt et ComeUp : signature = nom seul", proposalSignature("malt", "fr") === "Axel Remillat" && proposalSignature("comeup", "fr") === "Axel Remillat");
    check("« Autre » (FR) : lien /pme, sans téléphone", proposalSignature("autre", "fr").endsWith("axelremillat.com/pme") && !/\d{2}\s?\d{2}\s?\d{2}/.test(proposalSignature("autre", "fr")));
    check("Codeur : démo factures citée par son titre exact, sans lien", demoLine("codeur", "fr", "factures") === "Une démo d'un cas proche est visible dans mon portfolio Codeur (Extraction automatique de factures).");
    check("Malt : même règle, portfolio Malt", demoLine("malt", "fr", "devis") === "Une démo d'un cas proche est visible dans mon portfolio Malt (Agent IA de devis par métier).");
    check("fichier clients sans e-mail : aucune démo citée (jamais ORION)", demoLine("codeur", "fr", "fichier", "Nettoyer un export CSV de 20 000 clients avant migration") === null);
    check("fichier clients reçu par e-mail : tri des e-mails", demoLine("codeur", "fr", "fichier", "Dédoublonner les contacts reçus par e-mail chaque jour") === "Une démo d'un cas proche est visible dans mon portfolio Codeur (Tri automatique des e-mails entrants).");
    const noDemo = assembleProposal(PROPOSAL_POSITIVES[4], { language: "fr", demo: "fichier", platform: "comeup", context: "Nettoyer un export CSV" });
    check("sans démo : la proposition s'assemble sans ligne vide ni lien", !/portfolio|axelremillat/.test(noDemo.text) && !/\n\s*\n\s*\n/.test(noDemo.core));
    check("ComeUp : URL refusée comme sur Codeur", contactFailures("voir axelremillat.com", "comeup").some((line) => /ComeUp : aucune URL/.test(line)));
    const codeur = (text: string) => contactFailures(text, "codeur");
    check("Codeur : URL refusée (https://…)", codeur("Voir https://exemple.fr").length > 0);
    check("Codeur : domaine nu refusé (axelremillat.com)", codeur("Ma démo sur axelremillat.com").length > 0);
    check("Codeur : www refusé", codeur("www.monsite.fr").length > 0);
    check("Codeur : e-mail refusé", codeur("écrivez à axel@exemple.fr").some((line) => /e-mail/.test(line)));
    check("Codeur : téléphone refusé (07 49 72 71 92)", codeur("Appelez le 07 49 72 71 92").some((line) => /Téléphone/.test(line)));
    check("Codeur : téléphone international refusé (+33 7 49 72 71 92)", codeur("+33 7 49 72 71 92").some((line) => /Téléphone/.test(line)));
    check("Codeur : texte propre accepté", codeur("Une démo d'un cas proche est visible dans mon portfolio Codeur (Agent IA de devis par métier).").length === 0);
    const upwork = (text: string) => contactFailures(text, "upwork");
    check("Upwork : lien de démo autorisé", upwork("A one-minute demo: axelremillat.com/agent?src=upwork").length === 0);
    check("Upwork : e-mail, téléphone et calendrier refusés", upwork("mail me at axel@exemple.fr").length > 0 && upwork("call +33 7 49 72 71 92").length > 0 && upwork("book here: calendly.com/axel").length > 0);
    // Positionnement de prix (06/10/2026) : UN montant, plafonds, délai, coûts mensuels.
    const base = PROPOSAL_POSITIVES[1];
    const price = (framing: string, options: { budget?: string | null; kind?: "automatisation" | "fullstack"; ad?: string; amountEur?: number } = {}) => {
      const parts = { ...base, framing, amountEur: options.amountEur };
      const { core, text } = assembleProposal(parts, { language: "fr", demo: "emails", platform: "codeur", kind: options.kind });
      return checkProposal(parts, core, { language: "fr", budget: options.budget === undefined ? "1 000 à 2 000 €" : options.budget, platform: "codeur", kind: options.kind, ad: options.ad }, text).failures;
    };
    check("fourchette de prix refusée (« entre 600 et 950 € »)", price("Délai : deux semaines. Entre 600 et 950 €.").some((line) => /Fourchette/.test(line)));
    check("prix unique accepté (900 €, 15 jours)", !price("Prix : 900 €. Délai : 15 jours.").some((line) => /Fourchette|positionnement|workflow complet|Délai/.test(line)));
    check("1 500 € sans projet multi-systèmes → refusé", price("Prix : 1 500 €. Délai : 15 jours.").some((line) => /workflow complet/.test(line)));
    check("1 500 € pour un projet ERP / Sage → accepté", !price("Prix : 1 500 €. Délai : 15 jours.", { ad: "Intégration avec Sage 100 et lecture de sites avec connexion" }).some((line) => /workflow complet|positionnement/.test(line)));
    check("4 000 € en automatisation → refusé (3 000 € au plus)", price("Prix : 4 000 €. Délai : 15 jours.", { ad: "Sage" }).some((line) => /positionnement/.test(line)));
    check("application web : 3 500 € accepté, 5 000 € refusé", !price("Prix : 3 500 €. Délai : 30 jours.", { kind: "fullstack" }).some((line) => /positionnement|Délai/.test(line)) && price("Prix : 5 000 €. Délai : 30 jours.", { kind: "fullstack" }).some((line) => /positionnement/.test(line)));
    check("délai « 4 à 6 semaines » refusé en automatisation", price("Prix : 900 €. Délai : 4 à 6 semaines.").some((line) => /Délai de 42/.test(line)));
    check("montant suggéré au-delà du plafond refusé", price("Prix : 900 €. Délai : 15 jours.", { amountEur: 6000 }).some((line) => /positionnement/.test(line)));
    check("coûts mensuels « 100 à 250 €/mois » refusés", price("Prix : 900 €. Délai : 15 jours. Maintenance : 100 à 250 €/mois.").some((line) => /irréalistes/.test(line)));
    check("coûts mensuels réalistes (15 €, 10 à 30 €, 90 €/mois) acceptés, sans fausse fourchette", !price("Prix : 900 €. Coûts mensuels : hébergement 15 €, API IA 10 à 30 € selon le volume, maintenance en option 90 €/mois. Délai : 15 jours.").some((line) => /irréalistes|Fourchette/.test(line)));
    check("toujours « Bonjour, » en tête (FR), « Hello, » (EN)", assembleProposal(base, { language: "fr", demo: "emails", platform: "codeur" }).text.startsWith("Bonjour,") && assembleProposal(PROPOSAL_POSITIVES[3], { language: "en", demo: "sav", platform: "upwork" }).text.startsWith("Hello,"));
  }

  console.log("\n4c. Éléments demandés par l'annonce (Sage 100, cas réel)");
  {
    const sage = PROPOSAL_POSITIVES[0];
    check("éléments demandés détectés dans l'ordre", requestedItems(sage.ad).join(",") === "approche,prix,couts_mensuels,delai,references", requestedItems(sage.ad).join(","));
    check("annonce sans liste : rien d'imposé", requestedItems(PROPOSAL_POSITIVES[1].ad).length === 0);
    const negative = caught[0].failures.join(" | ");
    check("Sage (proposition actuelle) : fourchette, délai, coûts mensuels et références sans réponse attrapés", /Fourchette/.test(negative) && /Délai de 42/.test(negative) && /irréalistes/.test(negative) && /références/.test(negative), negative);
    const { core, text } = assembleProposal(sage, { language: "fr", demo: sage.demo, platform: "codeur", kind: sage.kind, context: sage.ad });
    check(`Sage (version d'Axel, 2 400 € / 15 j) : règles OK, ${text.length} caractères`, checkProposal(sage, core, { language: "fr", budget: sage.budget, platform: "codeur", kind: sage.kind, requested: requestedItems(sage.ad), ad: sage.ad }, text).ok);
    const dishonest = { ...sage, references: "J'ai déjà réalisé plusieurs intégrations Sage 100 pour des distributeurs." };
    const dishonestText = assembleProposal(dishonest, { language: "fr", demo: "emails", platform: "codeur" });
    check("références inventées refusées", !checkProposal(dishonest, dishonestText.core, { language: "fr", budget: sage.budget, platform: "codeur", requested: requestedItems(sage.ad), ad: sage.ad }, dishonestText.text).ok);
    const missing = { ...sage, references: undefined };
    const missingText = assembleProposal(missing, { language: "fr", demo: "emails", platform: "codeur" });
    check("références demandées mais absentes → refusé", checkProposal(missing, missingText.core, { language: "fr", budget: sage.budget, platform: "codeur", requested: requestedItems(sage.ad), ad: sage.ad }, missingText.text).failures.some((line) => /références/.test(line)));
    check("juge : un élément demandé sans réponse → 6 au plus (règle dans la consigne)", buildProposalJudgePrompt().includes("6 au plus"));
  }

  console.log("\n4d. Périmètre full-stack (décision d'Axel)");
  {
    const passes = (title: string, description: string, categories: string[] = []) => prefilterReason({ title, description, categories, budgetText: "1 000 € à 10 000 €" });
    check("app RH React / Supabase → dans le périmètre", passes("Application web RH en React et Supabase", "Gestion des congés et des entretiens annuels, back-office et tableau de bord", ["Développement web", "Application web"]) === null);
    check("CRM sur mesure Next.js → dans le périmètre", passes("CRM sur mesure en Next.js", "Outil interne pour suivre nos clients et nos devis, base PostgreSQL", ["Développement web"]) === null);
    check("app iOS native → filtrée", /native/.test(passes("Application iOS native en Swift", "Application iPhone de suivi de chantier", ["Application mobile"]) ?? ""));
    check("site WordPress → filtré", /CMS/.test(passes("Refonte de notre site WordPress", "Site vitrine de 8 pages avec blog", ["Site internet"]) ?? ""));
    check("site e-commerce Shopify → filtré", /CMS/.test(passes("Boutique Shopify", "Création d'une boutique en ligne Shopify", ["E-commerce"]) ?? ""));
    check("Laravel / PHP → filtré", /PHP/.test(passes("Développeur Laravel", "Maintenance d'une application Laravel / PHP 8", ["Développement web"]) ?? ""));
    check("Java → filtré, JavaScript non", /Java/.test(passes("Développeur Java Spring Boot", "API Java", []) ?? "") && passes("Développeur JavaScript Node.js", "API REST Node.js et PostgreSQL", []) === null);
    check("jeu vidéo → filtré", /jeu/.test(passes("Jeu vidéo Unity", "Développement d'un jeu mobile sous Unity", []) ?? ""));
    // Cas réels du rattrapage (06/10/2026) : pas d'exclusion sur un simple mot.
    check("entreprise « Wi-Fi, vidéo et alarme » cherchant une interface IoT → passe", passes("Recherche développeur pour interface IoT", "Nous sommes une société travaillant dans le Wifi, la vidéo et l'alarme sans fil pour des campings", ["IoT"]) === null);
    check("créer une IA qui appelle les prospects → passe (automatisation)", passes("Prospection telephonique avec IA", "Nous recherchons une société pouvant nous créer une IA qui pourra appeler en automatique des prospects", ["Télémarketing", "Chatbot"]) === null);
    check("téléprospecteur humain → filtré, même pour un produit IA", /télémarketing/.test(passes("Logiciel de recrutement IA", "Nous recherchons un téléprospecteur B2B pour prendre des rendez-vous autour d'une solution de recrutement propulsée par IA", ["Télémarketing"]) ?? ""));
    check("site e-commerce « sans Shopify » sur mesure → passe", passes("Recherche développeur", "Création d'un site e-commerce sur mesure, sans Shopify, à partir de ma maquette", ["Site E-commerce", "Développement spécifique"]) === null);
    check("plateforme web ET mobile → passe (l'analyse décide)", passes("Application de location immobilière", "Plateforme web et mobile de location immobilière avec paiement", ["Application mobile", "Marketplace"]) === null);
    check("application Apple → filtrée", /native/.test(passes("Recherche développeur mobile", "Je cherche quelqu'un pour créer mon application apple", ["Application mobile", "iOS"]) ?? ""));
    check("React Native → pas filtré (plafonné à 6 par l'analyse)", passes("Application React Native", "Application mobile multiplateforme React Native et Supabase", ["Application mobile"]) === null);
    const nineAsk: AskFn = async () => JSON.stringify({ score: 9, reasons: ["a", "b", "c"], need: "App", demo: "general", language: "fr", kind: "fullstack" });
    const capped = await analyzeOpportunity(nineAsk, { title: "Application React Native", body: "App multiplateforme", budget: null, platform: "codeur" });
    check("React Native : score plafonné à 6 (à voir)", capped?.score === 6 && capped.kind === "fullstack");
    check("full-stack : démo de référence ORION sur Codeur", demoLine("codeur", "fr", "general", "", "fullstack") === "Une démo d'un cas proche est visible dans mon portfolio Codeur (ORION : application de prospection B2B par IA).");
  }

  console.log("\n5. Boucle : juge ≥ 9, 2 réécritures au plus, meilleur essai gardé");
  {
    const good = PROPOSAL_POSITIVES[1];
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
    const base = { platform: "codeur" as const, language: "fr" as const, title: good.title, body: good.ad, budget: good.budget, need: "Trier les commandes", demo: "emails" as const };
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

  console.log("\n7. Veille Codeur automatique (flux RSS → /api/opportunities/ingest)");
  {
    // Cinq items réels anonymisés, tels que le workflow n8n les envoie.
    const item = (over: Record<string, unknown>) => ({
      platform: "codeur",
      url: "https://www.codeur.com/projects/000000-exemple",
      description_truncated: true,
      budget_text: "500 € à 1 000 €",
      published_at: "2026-10-06T08:53:13.000Z",
      ...over,
    });
    const SAGE = item({
      external_id: "490001",
      title: "Agent IA pour traiter les e-mails de commande et les saisir dans Sage 100",
      description: "PME de négoce : nous recevons chaque jour des dizaines d'e-mails de commande à ressaisir dans Sage 100 Gestion commerciale. Nous voulons un agent qui lit les e-mails, extrait les lignes et prépare la saisie…",
      categories: ["Intelligence artificielle", "Automatisation", "ERP"],
    });
    const IOS = item({
      external_id: "490002",
      title: "Développement d'une application mobile iOS de réservation",
      description: "Nous souhaitons créer une application iPhone pour réserver des créneaux dans nos salles, avec paiement en ligne…",
      categories: ["Application mobile", "iOS"],
    });
    const VIDEO = item({
      external_id: "490003",
      title: "Création de vidéos IA pour nos réseaux",
      description: "Nous cherchons un créateur pour produire 20 vidéos courtes générées par IA pour TikTok et Instagram…",
      categories: ["Vidéo", "Intelligence artificielle"],
      budget_text: "Moins de 500 €",
    });
    const ZOHO = item({
      external_id: "490004",
      title: "Expert Zoho CRM certifié — références Zoho exigées",
      description: "Paramétrage avancé de Zoho CRM (Deluge, blueprints). Merci de joindre trois références de projets Zoho similaires, profil certifié uniquement…",
      categories: ["CRM", "Admin système, sécurité"],
    });

    for (const [name, raw] of [["Sage 100", SAGE], ["iOS", IOS], ["vidéo IA", VIDEO], ["Zoho", ZOHO]] as const) {
      check(`corps n8n lisible (${name})`, parseIngestBody(raw as Record<string, unknown>).ok);
    }
    check("corps sans external_id refusé", !parseIngestBody({ platform: "codeur", title: "x" }).ok);
    check("extrait détecté (« … » final)", (parseIngestBody({ ...SAGE, description_truncated: undefined }) as { ok: true; value: IngestBody }).value.description_truncated);

    const analysisOf = (score: number, demo = "emails") => JSON.stringify({ score, reasons: ["raison 1", "raison 2", "raison 3"], need: "Automatiser la saisie des commandes reçues par e-mail.", demo, language: "fr" });
    const proposalJson = JSON.stringify({
      reading: "Vous recevez chaque jour des dizaines d'e-mails de commande à ressaisir dans Sage 100 Gestion commerciale, et vous voulez qu'un agent lise ces e-mails et prépare la saisie.",
      steps: [
        "Lecture des e-mails de commande et extraction du client, des références et des quantités.",
        "Préparation de la commande dans Sage 100, à valider par votre équipe avant enregistrement.",
        "Essai sur vos vrais e-mails pendant une semaine, puis ajustements et courte notice.",
      ],
      framing: "Délai : environ trois semaines, pour un montant de 900 €.",
      question: "Vos commandes arrivent-elles dans le corps du mail ou en pièce jointe PDF ?",
      amount_eur: 900,
      delay_days: 21,
    });
    const verdictJson = JSON.stringify({ criteria: { lecture: 3, approche: 3, cadrage: 2, ton: 2 }, reasons: [], fix: null });
    const calls: string[] = [];
    const ask: AskFn = async (role, _system, user, _temperature, operation) => {
      calls.push(operation);
      if (operation.startsWith("opportunites:analyse")) return /Zoho/.test(user) ? analysisOf(6) : analysisOf(9);
      return role === "writer" ? proposalJson : verdictJson;
    };
    const db = new FakeDb({ opportunities: [] });
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-06T09:00:00Z") };
    const ingest = async (raw: Record<string, unknown>) => ingestOpportunity(deps, (parseIngestBody(raw) as { ok: true; value: IngestBody }).value);

    const sage = await ingest(SAGE);
    check("Sage 100 agent mail → alerte (score 9)", sage.verdict === "alerte" && sage.score === 9 && sage.reasons.length === 3, JSON.stringify(sage));
    check("orion_url pointe sur la fiche", sage.orion_url === `https://orion.axelremillat.com/opportunites?id=${sage.id}`);
    const sageRow = db.rows("opportunities").find((row) => row.id === sage.id) as Record<string, unknown>;
    check("Sage : proposition rédigée (score ≥ 7), « brouillon sur extrait », montant et délai suggérés", typeof sageRow.proposal === "string" && sageRow.proposal_on_excerpt === true && sageRow.suggested_amount_eur === 900 && sageRow.suggested_delay_days === 21, JSON.stringify({ reason: sageRow.proposal_reason, len: String(sageRow.proposal).length }));
    check("Sage : proposition Codeur sans URL ni coordonnée, < 1 000 caractères", !/https?:|axelremillat|@/.test(String(sageRow.proposal)) && String(sageRow.proposal).length < 1000 && sageRow.proposal_score === 10, `${String(sageRow.proposal).length} car., ${String(sageRow.proposal_reason)}`);

    const llmBefore = calls.length;
    const ios = await ingest(IOS);
    check("app mobile iOS → filtre, sans LLM, gardée pour audit", ios.verdict === "ignore" && ios.filtered === true && calls.length === llmBefore && (db.rows("opportunities").find((row) => row.id === ios.id) as Record<string, unknown>).status === "ignoree", JSON.stringify(ios));
    const video = await ingest(VIDEO);
    check("vidéo IA → filtre, sans LLM (même avec la catégorie « Intelligence artificielle »)", video.verdict === "ignore" && video.filtered === true && calls.length === llmBefore, JSON.stringify(video));

    const zoho = await ingest(ZOHO);
    const zohoRow = db.rows("opportunities").find((row) => row.id === zoho.id) as Record<string, unknown>;
    check("Zoho CRM exigeant des références Zoho → à voir (score 6), sans proposition", zoho.verdict === "a_voir" && zoho.score === 6 && !zohoRow.proposal, JSON.stringify(zoho));
    check("catégorie avec virgule interne (« Admin système, sécurité ») : pas de faux filtrage", !zoho.filtered);

    const llmBeforeDuplicate = calls.length;
    const again = await ingest(SAGE);
    check("doublon → duplicate:true, même fiche, aucun appel LLM", again.duplicate === true && again.id === sage.id && calls.length === llmBeforeDuplicate && db.rows("opportunities").length === 4, JSON.stringify(again));

    // Pré-filtre : cas limites.
    check("budget « Moins de 100 € » → filtre", prefilterReason({ title: "Script Python", description: "Petit script", categories: [], budgetText: "Moins de 100 €" }) === "budget inférieur à 150 €");
    check("budget « Moins de 500 € » → pas filtré sur le budget", prefilterReason({ title: "Automatiser des relances", description: "n8n", categories: [], budgetText: "Moins de 500 €" }) === null);
    check("formation en présentiel à Lyon → filtre", /formation/.test(prefilterReason({ title: "Formation ChatGPT", description: "Formation en présentiel dans nos locaux à Lyon pour 10 salariés", categories: [], budgetText: null }) ?? ""));
    check("formation en visio → passe", prefilterReason({ title: "Formation ChatGPT", description: "Formation en visio pour 10 salariés", categories: [], budgetText: null }) === null);
    check("catégorie « Site internet » mais automatisation Shopify → n8n demandée : passe", prefilterReason({ title: "Synchroniser les commandes Shopify avec notre ERP via n8n", description: "Automatisation des commandes", categories: ["Site internet", "E-commerce"], budgetText: null }) === null);
    check("création de site WordPress → filtre", /site/.test(prefilterReason({ title: "Création d'un site WordPress vitrine", description: "Site de 5 pages", categories: ["Site internet"], budgetText: null }) ?? ""));
    check("télémarketing → filtre", /telemarketing|téléphonique/.test(prefilterReason({ title: "Prospection téléphonique B2B", description: "Appels sortants pour prendre des rendez-vous", categories: [], budgetText: null }) ?? ""));

    // Plafond quotidien : au-delà, « À analyser » sans LLM.
    const capped = new FakeDb({ opportunities: [] });
    let cappedCalls = 0;
    const capAsk: AskFn = async () => {
      cappedCalls += 1;
      return analysisOf(9);
    };
    const cap = await ingestOpportunity({ ...deps, db: capped as never, ask: capAsk, llmCap: 0 }, (parseIngestBody({ ...SAGE, external_id: "490100" }) as { ok: true; value: IngestBody }).value);
    check("plafond quotidien atteint → « À analyser », aucun appel LLM", cap.verdict === "a_voir" && cappedCalls === 0 && (capped.rows("opportunities")[0] as Record<string, unknown>).analysis_state === "a_analyser", JSON.stringify(cap));

    // Analyse trop lente : réponse « en cours », fin en arrière-plan.
    const slow = new FakeDb({ opportunities: [] });
    const later: Promise<unknown>[] = [];
    const slowAsk: AskFn = async (role, system, user, temperature, operation) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return ask(role, system, user, temperature, operation);
    };
    const pending = await ingestOpportunity({ ...deps, db: slow as never, ask: slowAsk, deadlineMs: 20, background: (work) => later.push(work) }, (parseIngestBody({ ...SAGE, external_id: "490200" }) as { ok: true; value: IngestBody }).value);
    check("analyse plus lente que l'échéance → { verdict: a_voir, pending: true }", pending.verdict === "a_voir" && pending.pending === true, JSON.stringify(pending));
    await Promise.all(later);
    const finished = slow.rows("opportunities")[0] as Record<string, unknown>;
    check("… puis l'analyse et la proposition se terminent en arrière-plan", finished.fit_score === 9 && finished.analysis_state === "ok" && typeof finished.proposal === "string", JSON.stringify({ score: finished.fit_score, state: finished.analysis_state }));

    // Message privé Codeur : 1 000 caractères au plus.
    const long = { ...PROPOSAL_POSITIVES[1], reading: `${PROPOSAL_POSITIVES[1].reading} ${"Détail supplémentaire sur le besoin. ".repeat(20)}` };
    const longText = assembleProposal(long, { language: "fr", demo: "emails", platform: "codeur" });
    check("Codeur : plus de 1 000 caractères → refusé (message privé)", checkProposal(long, longText.core, { language: "fr", budget: "500 €", platform: "codeur" }, longText.text).failures.some((line) => /1000|1 000/.test(line)));

    // Vue : alertes non vues, âge.
    const rows = [
      { fit_score: 9, status: "a_repondre" as const, seen_at: null, published_at: "2026-10-06T08:50:00Z", created_at: "x" },
      { fit_score: 9, status: "a_repondre" as const, seen_at: "2026-10-06T09:00:00Z", published_at: "2026-10-06T08:40:00Z", created_at: "x" },
      { fit_score: 6, status: "a_repondre" as const, seen_at: null, published_at: null, created_at: "x" },
      { fit_score: null, status: "ignoree" as const, filter_reason: "application mobile (iOS / Android)", seen_at: null, published_at: null, created_at: "x" },
    ];
    check("alertes non vues : seulement score ≥ 8 et pas encore vues", unseenAlerts(rows).length === 1);
    check("classement : alerte / à voir / ignorée (filtre)", bucketOf(rows[0]) === "alertes" && bucketOf(rows[2]) === "a_voir" && bucketOf(rows[3]) === "ignorees" && bucketOf({ fit_score: 3, status: "a_repondre" }) === "ignorees");
    check("âge lisible : « il y a 7 min »", ageLabel("2026-10-06T08:53:00Z", new Date("2026-10-06T09:00:00Z")) === "il y a 7 min");
    check("« vue » enregistrée par le suivi", buildOpportunityPatch({ seen: true }, { status: "a_repondre", sent_at: null, replied_at: null }, new Date("2026-10-06T09:00:00Z")).ok);
    const pasted = buildOpportunityPatch({ body: "Annonce complète collée par Axel, avec tous les détails du besoin et du contexte." }, { status: "a_repondre", sent_at: null, replied_at: null });
    check("annonce complète collée : n'est plus un extrait", pasted.ok && pasted.patch.description_truncated === false);
  }

  console.log(failures === 0 ? "\nTous les tests opportunités passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

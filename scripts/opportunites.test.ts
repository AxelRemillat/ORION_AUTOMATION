/**
 * Opportunités (Codeur, Upwork…) : saisie, analyse, proposition, suivi, stats.
 * Fixtures uniquement, aucun appel réel.
 */
import { UPWORK_PORTFOLIO, upworkProject } from "../lib/opportunities/upwork-portfolio";
import { buildProposalChecklistPrompt, judgeProposalChecklist, proposalChecklistFeedback, proposalCodeChecks, proposalMajority, proposalVerdictOf } from "../lib/opportunities/proposal-checklist";
import { PROPOSAL_CHECKLIST_SAMPLES } from "../lib/opportunities/proposal-checklist";
import { parseNewOpportunity, buildOpportunityPatch } from "../lib/opportunities/input";
import { analyzeOpportunity, opportunityDemoUrl, parseAnalysis } from "../lib/opportunities/analyze";
import { upworkBid, upworkBidPhrase, assembleProposal, buildClientJudgePrompt, buildProposalJudgePrompt, checkProposal, combineVerdicts, contactFailures, portfolioTitle, demoLine, generateProposal, parseProposalVerdict, proposalSignature, PROPOSAL_WORDS, PRIVATE_MESSAGE_MAX_CHARS, SHORTEN_ABOVE_CHARS } from "../lib/opportunities/proposal";
import { AXEL_SENT, PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "../lib/opportunities/calibration";
import { platformStats } from "../lib/opportunities/stats";
import { proposalLanguage } from "../lib/opportunities/types";
import { countWords } from "../lib/emails/quality/template";
import type { AskFn } from "../lib/ai/chat";
import { FakeDb } from "./fake-supabase";
import { freshScore, ingestOpportunity, parseIngestBody, statusAfterAnalysis, verdictOf, type IngestBody } from "../lib/opportunities/ingest";
import { classifyAd, isWebDev, prefilterReason, titleOnlyReason } from "../lib/opportunities/prefilter";
import { CMS_NOTE, isUrgent, LAUNCH_DELAY, laneOf, launchBudget, launchKind, launchPrice, offersCount } from "../lib/opportunities/lane";
import { generateLaunchProposal, launchChecks } from "../lib/opportunities/launch";
import { LAUNCH_REFERENCES } from "../lib/opportunities/calibration";
import { isOutdated, rowsOfBucket, seenAlerts } from "../lib/opportunities/view";
import { PROPOSAL_BUTTON_LABELS, PROPOSAL_FAILED, proposalButtonState } from "../lib/opportunities/proposal-state";
import { clockLabel, comeupKind, platformTheme, priceLabel, statusLabel } from "../lib/opportunities/platform-style";
import { STATUS_LABELS, STATUS_LABELS_EN } from "../lib/opportunities/types";
import { statusAfterEvent } from "../lib/opportunities/email/milestones";
import { analyzeAndPropose } from "../lib/opportunities/run";
import { longestDelayDays, requestedItems } from "../lib/opportunities/requests";
import { ageLabel, bucketOf, staleLabel, unseenAlerts } from "../lib/opportunities/view";
import { bucketFilters, emailsOfTab, formPlatform, initialTab, isBadgeAlert, itemsOfTab, tabBadges, tabHref, tabOf, visibleTabs } from "../lib/opportunities/tabs";
import type { Opportunity, Platform } from "../lib/opportunities/types";

/**
 * Check-list des propositions (Cowork #32) : réponse du modèle scénarisée à
 * partir d'une note — les critères LLM à NON font 10 − note (P1 2, P3 2, P4 1, P6 1).
 */
function checklistKeys(score: number): Record<string, { ok: boolean; citation: string }> {
  const failing = new Set<string>();
  let missing = Math.max(0, 10 - score);
  for (const [id, penalty] of [["P1", 2], ["P3", 2], ["P4", 1], ["P6", 1]] as const) {
    if (missing >= penalty) {
      failing.add(id);
      missing -= penalty;
    }
  }
  return Object.fromEntries(["P1", "P3", "P4", "P6"].map((id) => [id, { ok: !failing.has(id), citation: failing.has(id) ? "reformulation générique" : "ok" }]));
}

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
  check("lien suivi &ref=codeur (lu par le portfolio)", opportunityDemoUrl("emails", "codeur") === "axelremillat.com/automatisations?demo=email&ref=codeur");
  check("Upwork : page anglaise /en/agent?ref=upwork (Cowork #63)", opportunityDemoUrl("devis", "upwork") === "axelremillat.com/en/agent?ref=upwork");
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
        : text.endsWith("Axel Remillat · AI & automation for small businesses") && core.includes(`ref=${item.platform}`);
    check(`positif ${item.platform} « ${item.title.slice(0, 40)} » (${countWords(core)} mots)`, rules.ok && shape, rules.failures.join(" | "));
  }
  const caught = PROPOSAL_NEGATIVES.map((item) => {
    const { core, text } = assembleProposal(item, { language: item.language, demo: item.demo, platform: item.platform });
    return checkProposal(item, core, { language: item.language, budget: item.budget, platform: item.platform, kind: item.kind, requested: requestedItems(item.ad), ad: item.ad }, text);
  });
  check("négatifs : tous refusés par les règles (coordonnées Codeur, longueur, flatterie, chiffres inventés, jargon, prix sans budget)", caught.every((rules) => !rules.ok), caught.map((rules) => rules.failures[0]).join(" | "));
  check("Codeur : URL et e-mail dans la proposition attrapés", caught[2].failures.some((line) => /Codeur : aucune URL/.test(line)) && caught[2].failures.some((line) => /Adresse e-mail/.test(line)), caught[2].failures.join(" | "));
  check("chiffres inventés attrapés (« 30 PME », « 40 % »)", caught[4].failures.some((line) => /non prouvés/.test(line)));
  check("prix sans budget attrapé", caught[4].failures.some((line) => /Budget absent/.test(line)));
  check("jargon attrapé (leverage)", caught[5].failures.some((line) => /Jargon/.test(line)));
  check("flatterie attrapée (« Super projet »)", caught[3].failures.some((line) => /Flatterie/.test(line)));

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
    const noDemo = assembleProposal(PROPOSAL_POSITIVES[5], { language: "fr", demo: "fichier", platform: "comeup", context: "Nettoyer un export CSV" });
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
    check("Upwork : lien de démo autorisé", upwork("A one-minute demo: axelremillat.com/en/agent?ref=upwork").length === 0);
    check("Upwork : e-mail, téléphone et calendrier refusés", upwork("mail me at axel@exemple.fr").length > 0 && upwork("call +33 7 49 72 71 92").length > 0 && upwork("book here: calendly.com/axel").length > 0);
    // Cowork #63 : le nom d'un outil n'est pas un lien de rendez-vous ; projet du portfolio Upwork par son titre exact.
    check("Upwork : « Calendly bookings to Pipedrive » (outil du client) accepté", upwork("Calendly bookings will reach Pipedrive as before.").length === 0);
    check("Upwork : invitation « schedule a call here » refusée", upwork("You can schedule a call here.").length > 0);
    // Cowork #64 : seuls les projets PUBLIÉS du portfolio Upwork, par leur titre exact, avec leur propre démo.
    const line = (context: string) => demoLine("upwork", "en", "general", context) ?? "";
    check("Upwork : e-mails → AI Email Triage, démo demo=email&ref=upwork", line("triage our support inbox in Gmail") === 'Related project in my Upwork portfolio: "AI Email Triage Automation for Small Businesses (n8n + OpenAI)". One-minute demo: axelremillat.com/en/automatisations?demo=email&ref=upwork', line("x"));
    check("Upwork : chatbot OpenAI → RAG AI Chatbot (/en/projets/vega)", upworkProject("OpenAI chatbot answering from our FAQ and product PDFs").titre === "RAG AI Chatbot: Ask Questions to Your Documents, With Sources" && line("chatbot for our FAQ").includes("axelremillat.com/en/projets/vega?ref=upwork"));
    check("Upwork : factures PDF → AI Invoice Extraction", upworkProject("supplier PDF invoices into Google Sheets").titre === "AI Invoice Extraction: PDF or Photo to Structured Data in Seconds");
    check("Upwork : migration Zapier, Typeform → HubSpot → AI Email Triage", upworkProject("Migrate 12 Zapier zaps to Make").id === "email-triage" && upworkProject("new Typeform leads to HubSpot + Slack alert").id === "email-triage");
    check("Upwork : agent de devis NON publié → jamais cité", upworkProject("AI agent that turns a customer request into a priced quote").id !== "quote-agent");
    check("Upwork : titres inexistants supprimés", !UPWORK_PORTFOLIO.some((project) => /Invoice Data Extraction & Automatic|AI Quote Assistant with Voice/.test(project.titre)));
    check("Upwork : chaque lien de démo est en /en et porte ref=upwork", UPWORK_PORTFOLIO.every((project) => project.lien === null || /^axelremillat\.com\/en\/.+[?&]ref=upwork$/.test(project.lien)));
    // Cowork #66 : ORION (projet privé) — prospection seulement, cité SANS lien de démo.
    check("Upwork : lead generation B2B → AI Lead Generation System, sans démo", line("build a lead generation pipeline that finds and scores B2B prospects") === 'Related project in my Upwork portfolio: "AI Lead Generation System: Sourcing, Scoring and Human-Approved Emails".', line("lead generation"));
    check("Upwork : ORION jamais pour un chatbot, du support ou de la facturation", upworkProject("chatbot that finds leads").id !== "lead-generation" && upworkProject("support inbox outreach replies").id !== "lead-generation" && upworkProject("invoice reminders outbound").id !== "lead-generation");
    // Positionnement de prix (06/10/2026) : UN montant, plafonds, délai, coûts mensuels.
    const base = PROPOSAL_POSITIVES[2];
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
    // Upwork (plateformes #1) : la 1re phrase est l'aperçu — l'accroche ouvre, sans « Hello, ».
    check(
      "« Bonjour, » en tête (FR), « Hello, » (EN hors Upwork), accroche directe sur Upwork",
      assembleProposal(base, { language: "fr", demo: "emails", platform: "codeur" }).text.startsWith("Bonjour,") &&
        assembleProposal(PROPOSAL_POSITIVES[4], { language: "en", demo: "sav", platform: "autre" }).text.startsWith("Hello,") &&
        assembleProposal(PROPOSAL_POSITIVES[4], { language: "en", demo: "sav", platform: "upwork" }).text.startsWith(PROPOSAL_POSITIVES[4].reading.slice(0, 20)),
    );
  }

  console.log("\n4c. Éléments demandés par l'annonce (Sage 100, cas réel)");
  {
    const sage = PROPOSAL_POSITIVES[1];
    check("éléments demandés détectés dans l'ordre", requestedItems(sage.ad).join(",") === "approche,prix,couts_mensuels,delai,references", requestedItems(sage.ad).join(","));
    check("annonce sans liste : rien d'imposé", requestedItems(PROPOSAL_POSITIVES[2].ad).length === 0);
    const negative = caught[1].failures.join(" | ");
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
    // 11/10/2026 : CMS imposé → plus jamais « Ignorée », « À voir » avec la mention (classifyAd).
    check("site WordPress → plus filtré : CMS imposé", passes("Refonte de notre site WordPress", "Site vitrine de 8 pages avec blog", ["Site internet"]) === null && classifyAd({ title: "Refonte de notre site WordPress", description: "Site vitrine de 8 pages avec blog", categories: ["Site internet"], budgetText: null }).cms);
    check("site e-commerce Shopify → plus filtré : CMS imposé", passes("Boutique Shopify", "Création d'une boutique en ligne Shopify", ["E-commerce"]) === null);
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
    const good = PROPOSAL_POSITIVES[2];
    const goodJson = JSON.stringify({ reading: good.reading, steps: good.steps, framing: good.framing, question: good.question });
    // Note 9 ou 10 → les 8 critères à OUI ; en dessous, des critères à NON pour 10 − note.
    const verdict = (score: number) => JSON.stringify({ score, criteria: { lecture: Math.min(3, score - 7 + 0), approche: 3, cadrage: 2, ton: 2 }, reasons: score >= 9 ? [] : ["reformulation générique"], fix: score >= 9 ? null : "Reprends les éléments de l'annonce.", ...checklistKeys(score >= 9 ? 10 : score) });
    const scripted = (writer: string[], judge: string[]) => {
      const calls: string[] = [];
      // Les PROPOSAL_CHECKLIST_SAMPLES lectures d'un même essai rendent la même chose (un seul « judge » compté).
      let current = "";
      let reads = 0;
      const ask: AskFn = async (role) => {
        if (role === "writer") {
          calls.push(role);
          return writer.shift() ?? "";
        }
        if (reads % PROPOSAL_CHECKLIST_SAMPLES === 0) {
          calls.push(role);
          current = judge.shift() ?? "";
        }
        reads += 1;
        return current;
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
      check("toujours < 9 : 3 essais, meilleur gardé (8), « À revoir » avec la raison", "text" in outcome && outcome.needsReview && outcome.attempts === 3 && outcome.score === 8 && /critère\(s\) à NON — P1/.test(outcome.reason ?? ""), JSON.stringify("text" in outcome ? { s: outcome.score, r: outcome.reason } : outcome));
    }
    {
      // Cowork #31 : au-delà de 980 caractères, réécriture de raccourcissement dédiée, HORS des essais du juge.
      const padded = JSON.stringify({ reading: `${good.reading} ${"Détail de l'annonce repris en entier. ".repeat(14)}`, steps: good.steps, framing: good.framing, question: good.question });
      const operations: string[] = [];
      const ask: AskFn = async (role, _system, _user, _temperature, operation) => {
        operations.push(operation.replace(/:\d+$/, ""));
        if (role === "writer") return operation === "opportunites:raccourci" ? goodJson : padded;
        return verdict(10);
      };
      const outcome = await generateProposal({ ...base, ask });
      check(
        "trop longue → raccourcie avant le juge, sans compter d'essai",
        "text" in outcome && !outcome.needsReview && outcome.attempts === 1 && outcome.text.length <= SHORTEN_ABOVE_CHARS && operations.join(",") === "opportunites:redaction,opportunites:raccourci,opportunites:checklist,opportunites:checklist:0:lecture-2,opportunites:checklist:0:lecture-3",
        JSON.stringify({ ops: operations, len: "text" in outcome ? outcome.text.length : 0 }),
      );
    }
    {
      // Le raccourcissement échoue : rien au-dessus de 1 000 caractères n'est « prêt », même à 10/10.
      const padded = JSON.stringify({ reading: `${good.reading} ${"Détail de l'annonce repris en entier. ".repeat(14)}`, steps: good.steps, framing: good.framing, question: good.question });
      const { ask } = scripted([padded, padded, padded, padded, padded, padded, padded, padded, padded], [verdict(10), verdict(10), verdict(10)]);
      const outcome = await generateProposal({ ...base, ask });
      check("raccourcissement raté : jamais « prête » au-delà de 1 000 caractères", "text" in outcome && outcome.needsReview && outcome.text.length > PRIVATE_MESSAGE_MAX_CHARS, JSON.stringify("text" in outcome ? { n: outcome.needsReview, len: outcome.text.length } : outcome));
    }
    {
      const assembled = assembleProposal(good, { language: "fr", demo: "emails", platform: "codeur" }).text;
      check("Codeur : approche en un paragraphe « Approche : … » (structure des propositions d'Axel)", /\n\nApproche : \S/.test(assembled) && !/\n1\. /.test(assembled), assembled);
      check("Codeur : chaque étape après la 1re commence par une majuscule (jamais « . créer »)", !/\. [a-zà-ÿ]/.test(assembleProposal({ ...good, steps: ["un agent lit le dossier", "recenser les formats", "produire le fichier"] }, { language: "fr", demo: "emails", platform: "codeur" }).text.split("Approche :")[1].split("\n\n")[0]));
      check("Upwork : liste numérotée conservée", /\n1\. /.test(assembleProposal(PROPOSAL_POSITIVES[4], { language: "en", demo: "sav", platform: "upwork" }).text));
      check("propositions envoyées par Axel : 3 repères, P1 à 988 caractères, toutes ≤ 1 000", AXEL_SENT.length === 3 && AXEL_SENT[0].text.length === 988 && AXEL_SENT.every((item) => item.text.length <= PRIVATE_MESSAGE_MAX_CHARS));
      check("les deux juges ont les propositions d'Axel pour repères", buildProposalJudgePrompt().includes(AXEL_SENT[0].text) && buildClientJudgePrompt().includes(AXEL_SENT[2].text));
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
    const verdictJson = JSON.stringify({ score: 10, criteria: { lecture: 3, approche: 3, cadrage: 2, ton: 2 }, reasons: [], fix: null, ...checklistKeys(10) });
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
    check("création de site WordPress → plus filtrée (CMS imposé : à voir)", prefilterReason({ title: "Création d'un site WordPress vitrine", description: "Site de 5 pages", categories: ["Site internet"], budgetText: null }) === null);
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
    const long = { ...PROPOSAL_POSITIVES[2], reading: `${PROPOSAL_POSITIVES[2].reading} ${"Détail supplémentaire sur le besoin. ".repeat(20)}` };
    const longText = assembleProposal(long, { language: "fr", demo: "emails", platform: "codeur" });
    check("Codeur : plus de 1 000 caractères → refusé (message privé)", checkProposal(long, longText.core, { language: "fr", budget: "500 €", platform: "codeur" }, longText.text).failures.some((line) => /1000|1 000/.test(line)));

    // Vue : alertes non vues, âge.
    const rows = [
      { fit_score: 9, status: "a_repondre" as const, seen_at: null, published_at: "2026-10-06T08:50:00Z", created_at: "x" },
      { fit_score: 9, status: "a_repondre" as const, seen_at: "2026-10-06T09:00:00Z", published_at: "2026-10-06T08:40:00Z", created_at: "x" },
      { fit_score: 6, status: "a_repondre" as const, seen_at: null, published_at: null, created_at: "x" },
      { fit_score: null, status: "ignoree" as const, filter_reason: "application mobile (iOS / Android)", seen_at: null, published_at: null, created_at: "x" },
    ];
    // `now` figé : sans lui, la fraîcheur de 7 jours écartait ces annonces du 06/10
    // à partir du 13/10, et le test échouait quel que soit le code (Cowork #23).
    check("alertes non vues : seulement score ≥ 8 et pas encore vues", unseenAlerts(rows, new Date("2026-10-06T09:00:00Z")).length === 1);
    check("classement : alerte / à voir / ignorée (filtre)", bucketOf(rows[0]) === "alertes" && bucketOf(rows[2]) === "a_voir" && bucketOf(rows[3]) === "ignorees" && bucketOf({ fit_score: 3, status: "a_repondre" }) === "ignorees");
    check("âge lisible : « il y a 7 min »", ageLabel("2026-10-06T08:53:00Z", new Date("2026-10-06T09:00:00Z")) === "il y a 7 min");
    check("« vue » enregistrée par le suivi", buildOpportunityPatch({ seen: true }, { status: "a_repondre", sent_at: null, replied_at: null }, new Date("2026-10-06T09:00:00Z")).ok);
    const pasted = buildOpportunityPatch({ body: "Annonce complète collée par Axel, avec tous les détails du besoin et du contexte." }, { status: "a_repondre", sent_at: null, replied_at: null });
    check("annonce complète collée : n'est plus un extrait", pasted.ok && pasted.patch.description_truncated === false);
  }

  console.log("\n8. Relecture du 06/10 (propositions, fraîcheur, statut, filtre OuiGlass)");
  {
    // Proposition « Crer des agent ia autonome » : prix du texte ≠ champ, démo ORION.
    const agentsNegative = caught[0].failures.join(" | ");
    check("prix du texte (400 à 480 €) ≠ montant à saisir (450 €) → refusé", /diffère du montant à saisir/.test(agentsNegative) || /Fourchette/.test(agentsNegative), agentsNegative);
    const exact = { ...PROPOSAL_POSITIVES[0] };
    const exactText = assembleProposal(exact, { language: "fr", demo: exact.demo, platform: "codeur", context: exact.ad });
    check("version ORION de Cowork : règles OK, prix du texte = champ (450 €)", checkProposal(exact, exactText.core, { language: "fr", budget: exact.budget, platform: "codeur", requested: requestedItems(exact.ad), ad: exact.ad }, exactText.text).ok, checkProposal(exact, exactText.core, { language: "fr", budget: exact.budget, platform: "codeur", ad: exact.ad }, exactText.text).failures.join(" | "));
    check("besoin de prospection → démo ORION", exactText.text.includes("(ORION : application de prospection B2B par IA)"));
    check("démo ORION aussi pour « envoi de mails commerciaux »", portfolioTitle("emails", "Nous voulons automatiser l'envoi de mails commerciaux à nos leads") === "ORION : application de prospection B2B par IA");
    check("nettoyage de fichier : jamais ORION", portfolioTitle("fichier", "Nettoyer un export CSV clients") === null);
    check("toute proposition commence par « Bonjour, »", PROPOSAL_POSITIVES.filter((item) => item.language === "fr").every((item) => assembleProposal(item, { language: "fr", demo: item.demo, platform: item.platform }).text.startsWith("Bonjour,\n\n")));
    check("délai du texte ≠ délai à saisir → refusé", checkProposal({ ...exact, framing: "Prix : 450 €. Délai : 10 jours." }, assembleProposal({ ...exact, framing: "Prix : 450 €. Délai : 10 jours." }, { language: "fr", demo: "emails", platform: "codeur" }).core, { language: "fr", budget: exact.budget, platform: "codeur" }).failures.some((line) => /délai à saisir/.test(line)));
    check("double juge : un verdict manquant → pas « prête »", combineVerdicts({ score: 10, reasons: [], fix: null }, null) === null && combineVerdicts({ score: 10, reasons: [], fix: null }, { score: 8, reasons: ["prix flou"], fix: "x" })?.score === 8);
    check("juge client : persona « 80 offres, 30 secondes » et grille d'Axel", /80 offres/.test(buildClientJudgePrompt()) && /Bonjour/.test(buildClientJudgePrompt()));

    // Fraîcheur : annonce de plus de 7 jours → jamais d'alerte.
    const now = new Date("2026-10-06T16:00:00Z");
    check("annonce de 14 jours notée 9 → plafonnée à 6 (à voir)", freshScore(9, "2026-09-22T08:42:00Z", now) === 6 && verdictOf(freshScore(9, "2026-09-22T08:42:00Z", now)) === "a_voir");
    check("annonce du jour notée 9 → reste en alerte", freshScore(9, "2026-10-06T13:29:41Z", now) === 9);
    check("bandeau « Ancienne annonce (14 j) : faible chance de réponse »", staleLabel("2026-09-22T08:42:00Z", now) === "Ancienne annonce (14 j) : faible chance de réponse" && staleLabel("2026-10-05T08:00:00Z", now) === null);
    check("âge affiché = publication, pas la ré-analyse", ageLabel("2026-10-06T13:29:41Z", now) === "il y a 3 h");

    // Statut après (ré)analyse.
    check("« Ignorée » re-notée 8 → « À répondre »", statusAfterAnalysis("ignoree", 8) === "a_repondre");
    check("« Ignorée » re-notée 4 → inchangée", statusAfterAnalysis("ignoree", 4) === null);
    check("« Envoyée » jamais modifiée par une ré-analyse", statusAfterAnalysis("envoyee", 2) === null && statusAfterAnalysis("envoyee", 9) === null);

    // Non-régression : « Agent IA, et refonte site web » (Codeur 490837, OuiGlass) — intranet métier + agents IA.
    const OUIGLASS = {
      platform: "codeur",
      external_id: "490837",
      url: "https://www.codeur.com/projects/490837-agent-ia-et-refonte-site-web",
      title: "Agent IA , et refonte site web",
      description:
        "Bonjour, Je me présente : Alexandre Bernard, gérant de la société OuiGlass. Je détiens aujourd'hui 8 agences de vitrage automobile et j'ai développé en interne, il y a maintenant plusieurs mois, un intranet métier (planning, stock, flotte, SAV) que je souhaite refondre, avec des agents IA pour les factures et les dossiers assureurs…",
      description_truncated: true,
      budget_text: "1 000 € à 10 000 €",
      categories: ["Création de site internet", "Développement spécifique", "Migration ou refonte de site", "SaaS", "ChatGPT"],
      published_at: "2026-10-06T13:29:41.000Z",
    };
    check("OuiGlass : le pré-filtre ne l'écarte plus (intranet, agents IA)", prefilterReason({ title: OUIGLASS.title, description: OUIGLASS.description, categories: OUIGLASS.categories, budgetText: OUIGLASS.budget_text }) === null);
    check("site vitrine sans aucun signal métier : accepté (développement web, 11/10/2026)", prefilterReason({ title: "Refonte de site", description: "Refonte de notre site vitrine de 6 pages", categories: ["Migration ou refonte de site"], budgetText: null }) === null);
    const ouiDb = new FakeDb({ opportunities: [] });
    const ouiAsk: AskFn = async (_role, system) =>
      /Tu es le CLIENT/.test(system)
        ? JSON.stringify({ score: 9, reasons: [], fix: null, ...checklistKeys(10) })
        : /analyses une annonce/.test(system)
          ? JSON.stringify({ score: 9, reasons: ["Intranet métier à refondre", "Agents IA factures et assureurs", "Budget adapté"], need: "Refondre l'intranet et ajouter des agents IA.", demo: "factures", language: "fr", kind: "fullstack" })
          : JSON.stringify({ score: 10, criteria: { lecture: 3, approche: 3, cadrage: 2, ton: 2 }, reasons: [], fix: null });
    const oui = await ingestOpportunity({ db: ouiDb as never, userId: "u1", ask: ouiAsk, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-06T13:35:00Z") }, (parseIngestBody(OUIGLASS) as { ok: true; value: IngestBody }).value);
    check("OuiGlass → alerte (texte exact du flux, catégories « refonte de site » comprises)", oui.verdict === "alerte" && !oui.filtered, JSON.stringify(oui));
  }

  console.log("\n9a. Délais en anglais (agent4)");
  check("« $30 monthly » n'est pas un délai de 30 mois", longestDelayDays("Hosting about $30 monthly, maintenance optional.") === null);
  check("« 10 days, then $90 monthly » → 10 jours", longestDelayDays("Delivery in 10 days, then $90 monthly for maintenance.") === 10);
  check("« 2 months » reste 60 jours, « 3 weeks » 21", longestDelayDays("about 2 months") === 60 && longestDelayDays("within 3 weeks") === 21);
  check("français inchangé : « 15 jours », « 4 à 6 semaines », « 3 j »", longestDelayDays("Délai : 15 jours.") === 15 && longestDelayDays("4 à 6 semaines") === 42 && longestDelayDays("en 3 j.") === 3);

  console.log("\n9. Check-list des propositions (Cowork #32)");
  {
    const ctx = (item: (typeof AXEL_SENT)[number]) => ({ platform: "codeur" as const, ad: item.ad, budget: item.budget, amountEur: item.amountEur, delayDays: item.delayDays });
    for (const item of AXEL_SENT) {
      const code = proposalCodeChecks(item.text, ctx(item));
      check(`envoyée par Axel « ${item.title.slice(0, 40)} » : critères du code à 100 %`, code.length === 4 && code.every((criterion) => criterion.ok), JSON.stringify(code.filter((criterion) => !criterion.ok)));
    }
    const allYes: AskFn = async () => JSON.stringify(checklistKeys(10));
    const verdicts = await Promise.all(AXEL_SENT.map((item) => judgeProposalChecklist(allYes, { title: item.title, text: item.text, ...ctx(item) })));
    check("P1, P2, P3 : les 8 critères à OUI → prêtes, 10/10", verdicts.every((verdict) => verdict?.ready && verdict.score === 10 && verdict.items.length === 8), JSON.stringify(verdicts.map((verdict) => verdict?.score)));
    const sage = AXEL_SENT[0];
    const wrongPrice = proposalCodeChecks(sage.text, { ...ctx(sage), amountEur: 2600 });
    check("prix du texte ≠ champ → P5 NON, en code", wrongPrice.find((criterion) => criterion.id === "P5")?.ok === false);
    const wrongDelay = proposalCodeChecks(sage.text, { ...ctx(sage), delayDays: 20 });
    check("délai du texte ≠ champ → P5 NON", wrongDelay.find((criterion) => criterion.id === "P5")?.ok === false);
    const long = sage.text.replace("Combien de demandes", `${"Détail. ".repeat(10)}Combien de demandes`);
    check("plus de 1 000 caractères sur Codeur → P7 NON", proposalCodeChecks(long, ctx(sage)).find((criterion) => criterion.id === "P7")?.ok === false);
    const withUrl = sage.text.replace("(ORION)", "(orion.axelremillat.com)");
    check("coordonnée ou URL → P8 NON", proposalCodeChecks(withUrl, ctx(sage)).find((criterion) => criterion.id === "P8")?.ok === false);
    const noMonthly = sage.text.replace(/Mensuel : [^\n]*\n/, "");
    check("coûts mensuels demandés mais absents → P2 NON", proposalCodeChecks(noMonthly, ctx(sage)).find((criterion) => criterion.id === "P2")?.ok === false);
    let judgeCalls = 0;
    const counting: AskFn = async () => {
      judgeCalls += 1;
      return JSON.stringify(checklistKeys(10));
    };
    const refused = await judgeProposalChecklist(counting, { title: sage.title, text: long, ...ctx(sage) });
    check("un critère du code à NON → pas d'appel au modèle", judgeCalls === 0 && refused?.ready === false);
    const split = proposalMajority([checklistKeys(10), checklistKeys(8), checklistKeys(8)].map((value) => value as never));
    check("majorité par critère : 2 NON sur 3 → NON (P1)", split?.find((criterion) => criterion.id === "P1")?.ok === false && split.find((criterion) => criterion.id === "P3")?.ok === true);
    const down: AskFn = async () => {
      throw new Error("429 quota");
    };
    check("modèle indisponible (quota) → relecture indisponible, pas de verdict inventé", (await judgeProposalChecklist(down, { title: sage.title, text: sage.text, ...ctx(sage) })) === null);
    const failed = proposalVerdictOf([...proposalCodeChecks(sage.text, ctx(sage)), ...(proposalMajority([checklistKeys(8) as never]) ?? [])]);
    check("réécriture ciblée : seuls les critères à NON, avec leur citation", proposalChecklistFeedback(failed) === "- P1 NON — Lecture précise du besoin (ses outils, ses documents, son résultat attendu) : « reformulation générique »", proposalChecklistFeedback(failed));
    check("fichiers de prix Excel à importer → démo « Extraction automatique de factures » (choix d'Axel, P2)", portfolioTitle("fichier", "fichiers de prix fournisseurs Excel à importer dans Sage") === "Extraction automatique de factures" && portfolioTitle("fichier", "Nettoyer un export CSV") === null);
    const sageParts = { ...PROPOSAL_POSITIVES[1], reading: `${PROPOSAL_POSITIVES[1].reading} Vous gardez la main sur chaque envoi.` };
    const sageText = assembleProposal(sageParts, { language: "fr", demo: "emails", platform: "codeur", context: sageParts.ad });
    const sageRules = checkProposal(sageParts, sageText.core, { language: "fr", budget: sageParts.budget, platform: "codeur", requested: requestedItems(sageParts.ad), ad: sageParts.ad }, sageText.text);
    check("Codeur : plus de 150 mots mais < 1 000 caractères → pas refusée pour les mots", !sageRules.failures.some((line) => /mots : la proposition/.test(line)), sageRules.failures.join(" | "));
    check("prompt du modèle figé (aucune donnée variable)", buildProposalChecklistPrompt() === buildProposalChecklistPrompt() && buildProposalChecklistPrompt().includes(AXEL_SENT[2].text));
  }

  console.log("\nOnglets par plateforme (Cowork #19)");
  {
    const row = (id: string, platform: Platform, extra: Partial<Opportunity> = {}) =>
      ({ id, platform, fit_score: null, status: "a_repondre", seen_at: null, sent_at: null, replied_at: null, followed_up_at: null, filter_reason: null, analysis_state: null, ...extra }) as Opportunity;
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const items = [
      row("c1", "codeur", { fit_score: 9 }),
      row("c2", "codeur", { fit_score: 9, seen_at: daysAgo(0) }),
      row("u1", "upwork", { fit_score: 8 }),
      row("u2", "upwork", { fit_score: 9, status: "ignoree" }),
      row("k1", "comeup", { status: "envoyee", sent_at: daysAgo(4) }),
    ];
    check("Codeur par défaut", initialTab({ items }) === "codeur");
    check("?p=upwork → Upwork, ?p=comeup → ComeUp", initialTab({ p: "upwork", items }) === "upwork" && initialTab({ p: "comeup", items }) === "comeup");
    check("?p= inconnu → Codeur", initialTab({ p: "malt", items }) === "codeur");
    check("?id= d'une fiche Upwork (notification) → onglet Upwork, même avec ?p=codeur", initialTab({ id: "u1", p: "codeur", items }) === "upwork");
    check("?id= d'une fiche Malt → onglet « Autres »", initialTab({ id: "m1", items: [...items, row("m1", "malt")] }) === "autres");
    check("?id= inconnu → ?p= ou Codeur", initialTab({ id: "zz", p: "comeup", items }) === "comeup");
    check("?filtre=relances sans ?p= → premier onglet avec une relance due (ComeUp, 3 j)", initialTab({ filter: "relances", items }) === "comeup");
    check("?filtre=a_trier sans ?p= → premier onglet avec un e-mail à trier", initialTab({ filter: "a_trier", items, toSort: [{ platform: "upwork" }] }) === "upwork");

    check("« Autres » absent sans fiche Malt ni Autre", visibleTabs(items).join(",") === "codeur,upwork,comeup");
    check("« Autres » présent dès une fiche Malt", visibleTabs([...items, row("m1", "malt")]).join(",") === "codeur,upwork,comeup,autres");
    check("?p=autres sans fiche → Codeur (l'onglet n'existe pas)", initialTab({ p: "autres", items }) === "codeur");
    check("une fiche « autre » va dans « Autres »", tabOf("autre") === "autres" && itemsOfTab([...items, row("a1", "autre")], "autres").length === 1);

    const badges = tabBadges(items);
    check("badge par onglet = règle de la barre (≥ 8, non vue, pas ignorée)", badges.codeur === 1 && badges.upwork === 1 && badges.comeup === 0 && badges.autres === 0, JSON.stringify(badges));
    check("somme des badges = badge de la barre", Object.values(badges).reduce((a, b) => a + b, 0) === items.filter((item) => isBadgeAlert(item)).length);

    check("formulaire pré-réglé sur l'onglet (Codeur, Upwork, ComeUp ; Autres → Malt)", formPlatform("codeur") === "codeur" && formPlatform("upwork") === "upwork" && formPlatform("comeup") === "comeup" && formPlatform("autres") === "malt");
    check("Codeur garde « Ignorées » même vide ; Upwork sans « Ignorées » si vide", bucketFilters("codeur", []).includes("ignorees") && !bucketFilters("upwork", itemsOfTab(items, "upwork").filter((item) => item.status !== "ignoree")).includes("ignorees") && bucketFilters("upwork", itemsOfTab(items, "upwork")).includes("ignorees"));
    const mails = [{ platform: "upwork" as Platform }, { platform: "comeup" as Platform }, { platform: "malt" as Platform }, { platform: null }];
    check("e-mails à trier : Upwork et ComeUp les leurs, Codeur tous les autres (rien ne disparaît)", emailsOfTab(mails, "upwork").length === 1 && emailsOfTab(mails, "comeup").length === 1 && emailsOfTab(mails, "codeur").length === 2);
    check("lien d'onglet", tabHref("upwork") === "/opportunites?p=upwork");
  }

  console.log("\nMissions de lancement Codeur (Cowork #20, 11/10/2026)");
  {
    const ad = (title: string, description = "", budgetText: string | null = null, categories: string[] = []) => ({ title, description, categories, budgetText });
    // Les 3 cas réels (alertes e-mail à titre seul, budget non indiqué).
    for (const title of ["Creation site web + base SEO", "Site d'affiliation", "Application éducative en français pour lycéens et étudiants"]) {
      check(`cas réel « ${title} » : accepté (titre seul et annonce), développement web`, titleOnlyReason(title) === null && prefilterReason(ad(title)) === null && classifyAd(ad(title)).webDev, String(titleOnlyReason(title)));
      check(`cas réel « ${title} » : mission de lancement`, laneOf({ platform: "codeur", title, body: title, budget: null }, new Date()) === "lancement");
    }
    check("« Campagne Google Ads pour site WordPress » : reste ignorée (Ads sans création de site)", /Ads/.test(prefilterReason(ad("Campagne Google Ads pour site WordPress", "Gérer nos annonces Google Ads pour notre site WordPress", "Moins de 500 €")) ?? "") && titleOnlyReason("Campagne Google Ads pour site WordPress") !== null);
    const cms = ad("Création d'un site vitrine WordPress", "Site de 5 pages sous WordPress avec Elementor", "Moins de 500 €", ["Site internet"]);
    // Cowork #27 : un CMS est du dev web au sens large → mission de lancement, alerte.
    check("CMS : jamais ignoré, mission de lancement (Cowork #27)", prefilterReason(cms) === null && classifyAd(cms).cms && laneOf({ platform: "codeur", title: cms.title, body: cms.description, budget: cms.budgetText, categories: cms.categories }) === "lancement");
    check("CMS : bucket « Alertes », même avec un score de 2", bucketOf({ platform: "codeur", title: cms.title, body: cms.description, budget: cms.budgetText, fit_score: 2, status: "a_repondre" } as never) === "alertes");
    check("« Prestahop » (faute de frappe) reconnu comme CMS", classifyAd(ad("Site Prestahop 1.7.8.11 : mise à jour")).cms);
    check("toujours ignorés : app mobile native, graphisme, vidéo, Magento, catalogue > 100 produits, data science lourde", [
      ad("Application iOS native en Swift", "App iPhone de réservation"),
      ad("Création de logo", "Logo et charte graphique"),
      ad("Montage vidéo YouTube", "Montage de vidéos YouTube"),
      ad("Boutique Magento 2", "Refonte de notre boutique Magento"),
      ad("Création d'une boutique en ligne", "Catalogue de 350 produits à intégrer"),
      ad("Modèle de machine learning", "Entraînement d'un modèle prédictif sur nos ventes"),
    ].every((item) => prefilterReason(item) !== null));
    check("SEO ou rédaction SANS site : ignorés ; site + SEO de base : accepté", prefilterReason(ad("Rédaction d'articles SEO", "10 articles de blog optimisés")) !== null && prefilterReason(ad("Besoin d'aide sur la partie SEO de mon site", "Mon site existe, il faut le référencer")) !== null && prefilterReason(ad("Création site vitrine + SEO", "Site de 5 pages avec référencement de base")) === null);
    check("paramétrage Zoho, « beta testeur » : pas du développement web", !isWebDev("Intégration et paramétrage avancé de Zoho CRM") && !isWebDev("Besoin d'un beta testeur pour mon site"));
    check("campagne Meta avec la catégorie « Landing page » : pas du développement web", !isWebDev("Création et gestion d'une campagne Meta", ["Publicité", "Landing page"]));

    check("budget de lancement : ≤ 1 000 € ou non indiqué", launchBudget("Moins de 500 €") && launchBudget("500 € à 1 000 €") && launchBudget(null) && !launchBudget("1 000 € à 10 000 €") && !launchBudget("10 000 € et plus"));
    check("prix de lancement : 300 € sous 500 €, sinon 400 €", launchPrice("Moins de 500 €") === 300 && launchPrice("300 €") === 300 && launchPrice("500 € à 1 000 €") === 400 && launchPrice(null) === 400);
    check("délai : 7 jours pour un site, 3 semaines pour une application", launchKind("Site d'affiliation") === "site" && launchKind("Application éducative") === "app" && LAUNCH_DELAY.site.days === 7 && LAUNCH_DELAY.app.days === 21);
    check("annonce de plus de 7 jours : plus une mission de lancement", laneOf({ platform: "codeur", title: "Site vitrine", body: "Site vitrine", budget: null, published_at: "2026-09-20T10:00:00Z" }, new Date("2026-10-11T10:00:00Z")) === null);
    check("Upwork : jamais de mission de lancement (Codeur seulement)", laneOf({ platform: "upwork", title: "Landing page", body: "Landing page", budget: null }) === null);

    const launchRow = { id: "l1", platform: "codeur", title: "Site d'affiliation", body: "Site d'affiliation", budget: "Moins de 500 €", fit_score: 4, status: "a_repondre", seen_at: null, filter_reason: null, published_at: new Date().toISOString() } as never;
    check("lancement : ALERTE même avec un score de 4", bucketOf(launchRow) === "alertes");
    check("lancement non vu : compte dans le badge ; vu : non", isBadgeAlert(launchRow) && !isBadgeAlert({ ...(launchRow as object), seen_at: new Date().toISOString() } as never));
    check("« Urgent » : publiée il y a moins de 2 h", isUrgent(new Date(Date.now() - 30 * 60_000).toISOString()) && !isUrgent(new Date(Date.now() - 3 * 3_600_000).toISOString()));
    check("offres déjà déposées : lues si le texte les donne, sinon rien", offersCount("Projet publié · 12 offres déposées") === 12 && offersCount("Nombre d'offres : 3") === 3 && offersCount("Site vitrine 5 pages") === null);

    // Propositions de référence (validées par Axel) : elles passent la check-list de lancement.
    for (const item of LAUNCH_REFERENCES) {
      const failures = launchChecks(item.text, { price: item.price, kind: item.kind, budget: item.budget, exceeds: item.exceeds });
      check(`référence « ${item.title} » (${item.price} €) : check-list OK, ${item.text.length} caractères`, failures.length === 0, failures.join(" | "));
    }
    const ref = LAUNCH_REFERENCES[0];
    const frame = { price: ref.price, kind: ref.kind, budget: ref.budget };
    check("check-list : une URL est refusée", launchChecks(ref.text.replace("Pour cadrer", "Voir axelremillat.com. Pour cadrer"), frame).some((line) => /URL/.test(line)));
    check("check-list : sans « avis honnête », refusée", launchChecks(ref.text.replace("en échange d'un avis honnête à la fin de la mission", "sans engagement"), frame).length > 0);
    check("check-list : deux questions, refusée", launchChecks(ref.text.replace("Mise en ligne", "Un logo ? Mise en ligne"), frame).some((line) => /question/.test(line)));
    check("check-list : cahier des charges dépassé sans phase 2, refusée", launchChecks(LAUNCH_REFERENCES[2].text.replace(/Le forum à points[^\n]*\n\n/, ""), { ...LAUNCH_REFERENCES[2], exceeds: true }).some((line) => /phase 2/.test(line)));

    // Rédaction : le code pose le prix, le délai, l'avis et la signature.
    const parts = { reading: "Vous voulez un site d'affiliation clé en main sur votre niche, à enrichir ensuite vous-même.", proof: "", items: ["Un site rapide : accueil, catégories, modèle d'article.", "Un espace d'édition simple pour vos liens.", "La base SEO : titres, plan du site, Search Console."], exceeds: false, phase2: "", question: "Quelle niche visez-vous ?" };
    let writes = 0;
    const launchAsk: AskFn = async () => ((writes += 1), JSON.stringify(parts));
    const out = await generateLaunchProposal({ ask: launchAsk, title: "Site d'affiliation", body: "Site d'affiliation", budget: "Moins de 500 €" });
    check("proposition de lancement : 300 €, 7 jours, avis honnête, signature, prête en un essai", "text" in out && !out.needsReview && out.amountEur === 300 && out.delayDays === 7 && /tarif de lancement de 300 € à prix fixe, livré en 7 jours, en échange d'un avis honnête/.test(out.text) && out.text.endsWith("\n\nAxel Remillat") && writes === 1, JSON.stringify(out));

    // Ingestion : alerte quel que soit le score ; CMS imposé jamais en alerte ni ignoré.
    const lowAsk: AskFn = async (role, system) =>
      /Tu analyses une annonce/.test(system) ? JSON.stringify({ score: 3, reasons: ["site", "petit budget", "simple"], need: "Un site d'affiliation.", demo: "general", language: "fr", kind: "fullstack" }) : role === "writer" ? JSON.stringify(parts) : "";
    const ldb = new FakeDb({ opportunities: [] });
    const ldeps = { db: ldb as never, userId: "u1", ask: lowAsk, baseUrl: "https://orion.axelremillat.com", now: () => new Date() };
    const base = { platform: "codeur", url: "https://www.codeur.com/projects/1", description_truncated: false, categories: [], published_at: new Date().toISOString() };
    const launch = await ingestOpportunity(ldeps, (parseIngestBody({ ...base, external_id: "l-1", title: "Site d'affiliation", description: "Création d'un site d'affiliation clé en main.", budget_text: "Moins de 500 €" }) as { ok: true; value: IngestBody }).value);
    const launchStored = ldb.rows("opportunities").find((row) => row.id === launch.id) as Record<string, unknown>;
    check("ingestion lancement : verdict « alerte » avec un score de 3, pas « Ignorée », proposition 300 €", launch.verdict === "alerte" && launch.lane === "lancement" && launchStored.status !== "ignoree" && launchStored.suggested_amount_eur === 300 && /avis honnête/.test(String(launchStored.proposal)), JSON.stringify({ launch, status: launchStored.status }));
    const cmsIn = await ingestOpportunity(ldeps, (parseIngestBody({ ...base, external_id: "l-2", title: "Site vitrine WordPress", description: "Site de 5 pages sous WordPress.", budget_text: "Moins de 500 €" }) as { ok: true; value: IngestBody }).value);
    const cmsStored = ldb.rows("opportunities").find((row) => row.id === cmsIn.id) as Record<string, unknown>;
    check("ingestion CMS : alerte « lancement » avec un score de 3, jamais ignorée (Cowork #27)", cmsIn.verdict === "alerte" && cmsIn.lane === "lancement" && cmsIn.reasons[0] !== CMS_NOTE && /^Mission de lancement/.test(cmsIn.reasons[0]) && cmsStored.status !== "ignoree", JSON.stringify(cmsIn));
    const ads = await ingestOpportunity(ldeps, (parseIngestBody({ ...base, external_id: "l-3", title: "Campagne Google Ads pour site WordPress", description: "Gérer nos campagnes Google Ads.", budget_text: "Moins de 500 €" }) as { ok: true; value: IngestBody }).value);
    check("ingestion « Campagne Google Ads pour site WordPress » : ignorée", ads.verdict === "ignore" && ads.filtered === true);
  }

  console.log("\nAlertes plus nettes et identités (Cowork #21)");
  {
    const now = new Date("2026-10-12T08:00:00Z");
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    const alert = (id: string, extra: Partial<Opportunity> = {}) =>
      ({ id, platform: "codeur", title: "Agent IA de tri des devis", body: "Agent IA de tri des devis", budget: "1 000 € à 10 000 €", fit_score: 9, status: "a_repondre", seen_at: null, filter_reason: null, analysis_state: "ok", published_at: hoursAgo(3), created_at: hoursAgo(3), ...extra }) as Opportunity;

    // « Vu » : seen_at posé par le PATCH, la carte quitte « Nouvelles alertes » et va dans « Alertes vues ».
    const built = buildOpportunityPatch({ seen: true }, { status: "a_repondre", sent_at: null, replied_at: null }, now);
    check("« Vu » : le PATCH pose seen_at (persistant après rechargement)", built.ok && built.patch.seen_at === now.toISOString());
    const seenRow = alert("a2", { seen_at: now.toISOString() });
    check("vue : hors « Nouvelles alertes », dans « Alertes vues » et dans « Toutes »", unseenAlerts([alert("a1"), seenRow], now).map((row) => row.id).join() === "a1" && seenAlerts([alert("a1"), seenRow], now).map((row) => row.id).join() === "a2" && rowsOfBucket([seenRow], "toutes", now).length === 1);
    check("badge : seulement les non vues", isBadgeAlert(alert("a1"), now) && !isBadgeAlert(seenRow, now));
    const sent = buildOpportunityPatch({ status: "envoyee", seen: true }, { status: "a_repondre", sent_at: null, replied_at: null }, now);
    check("« Marquer envoyée » marque aussi comme vue", sent.ok && sent.patch.status === "envoyee" && sent.patch.seen_at === now.toISOString());

    // Fraîcheur : plus de 7 jours → hors alertes et « À voir », seulement dans « Toutes ».
    const old = alert("o1", { published_at: hoursAgo(24 * 8), created_at: hoursAgo(24 * 8) });
    check("annonce de 8 jours : « trop tard », hors alertes, badge et « À voir »", isOutdated(old, now) && unseenAlerts([old], now).length === 0 && !isBadgeAlert(old, now) && rowsOfBucket([old], "alertes", now).length === 0);
    check("annonce de 8 jours : toujours dans « Toutes » (rien supprimé)", rowsOfBucket([old], "toutes", now).length === 1);
    check("annonce ancienne où Axel a postulé : pas « trop tard » (son suivi continue)", !isOutdated({ ...old, status: "envoyee" }, now));
    const aVoir = alert("v1", { fit_score: 6, published_at: hoursAgo(24 * 9), created_at: hoursAgo(24 * 9) });
    check("« À voir » de 9 jours : masquée de « À voir »", rowsOfBucket([aVoir], "a_voir", now).length === 0);

    // Fermée : projet fermé / attribué / annulé avant toute proposition.
    check("clôture d'un projet auquel Axel n'a pas répondu → « Fermée » ; après envoi → « Perdue »", statusAfterEvent("a_repondre", "perdue") === "fermee" && statusAfterEvent("envoyee", "perdue") === "perdue" && statusAfterEvent("fermee", "perdue") === null);
    const closed = alert("f1", { status: "fermee" });
    check("« Fermée » : hors alertes, badge et « À voir », gardée dans « Toutes »", isOutdated(closed, now) && unseenAlerts([closed], now).length === 0 && !isBadgeAlert(closed, now) && rowsOfBucket([closed], "toutes", now).length === 1);
    check("statut « Fermée » : libellé FR et EN", STATUS_LABELS.fermee === "Fermée" && STATUS_LABELS_EN.fermee === "Closed");

    // Tri : la plus récente en haut.
    check("alertes : la plus récente en haut", rowsOfBucket([alert("x1", { published_at: hoursAgo(20) }), alert("x2", { published_at: hoursAgo(1) })], "alertes", now)[0].id === "x2");

    // Bouton de proposition : jamais « en cours » sans rédaction réelle.
    check("bouton : proposition prête → « Copier »", proposalButtonState({ proposal: "Bonjour" }) === "copier");
    check("bouton : aucune rédaction lancée (rattrapage, titre seul) → « Rédiger », pas « en cours »", proposalButtonState({ proposal: null, analysis_state: "titre_seul" }, false, now) === "rediger" && proposalButtonState({ proposal: null, analysis_state: null }, false, now) === "rediger");
    check("bouton : clic en cours → « en cours »", proposalButtonState({ proposal: null }, true, now) === "en_cours");
    check("bouton : analyse « pending » récente → « en cours » ; vieille de 30 min → « Échec — réessayer »", proposalButtonState({ proposal: null, analysis_state: "pending", updated_at: hoursAgo(0.05) }, false, now) === "en_cours" && proposalButtonState({ proposal: null, analysis_state: "pending", updated_at: hoursAgo(0.5) }, false, now) === "echec");
    check("bouton : rédaction ratée ou crédit épuisé → « Échec — réessayer »", proposalButtonState({ proposal: null, proposal_reason: `${PROPOSAL_FAILED} : quota` }) === "echec" && proposalButtonState({ proposal: null, analysis_state: "non_analysee" }) === "echec" && PROPOSAL_BUTTON_LABELS.echec === "Échec — réessayer");

    // Rédaction réelle : un échec est écrit sur la fiche ; une mission de lancement à titre seul est rédigée sans analyse.
    const failDb = new FakeDb({ opportunities: [{ ...alert("r1"), title: "Agent IA devis", body: "Automatiser la préparation de nos devis à partir des e-mails.", platform: "codeur" }] });
    const failing = await analyzeAndPropose(failDb as never, "u1", "r1", async () => {
      throw new Error("429 quota");
    });
    const failRow = failDb.rows("opportunities")[0] as Record<string, unknown>;
    check("rédaction impossible : « Échec » écrit sur la fiche (le bouton le dit)", !failing.ok && String(failRow.proposal_reason).startsWith(PROPOSAL_FAILED), JSON.stringify(failRow.proposal_reason));
    const parts = { reading: "Vous voulez une application de commandes qui met en relation clients et vendeurs.", proof: "", items: ["Comptes client et vendeur.", "Catalogue et passage de commande.", "Suivi des commandes."], exceeds: false, phase2: "", question: "Combien de vendeurs au départ ?" };
    const operations: string[] = [];
    const titleDb = new FakeDb({ opportunities: [{ ...alert("t1"), title: "Application pour les commandes", body: "Application pour les commandes", budget: "Moins de 500 €", fit_score: null, analysis_state: "titre_seul", published_at: new Date().toISOString(), created_at: new Date().toISOString() }] });
    const titled = await analyzeAndPropose(titleDb as never, "u1", "t1", async (_role, _system, _user, _temperature, operation) => (operations.push(operation), JSON.stringify(parts)));
    const titleRow = titleDb.rows("opportunities")[0] as Record<string, unknown>;
    check("lancement à titre seul : proposition rédigée SANS analyse, « titre seul » gardé, 300 €", titled.ok && !operations.some((op) => op.includes("analyse")) && titleRow.analysis_state === "titre_seul" && titleRow.suggested_amount_eur === 300 && /avis honnête/.test(String(titleRow.proposal)), JSON.stringify({ titled, operations }));

    // Identités : montants, statuts anglais, horloge.
    check("Codeur : 1 200 € à espaces fines", priceLabel(1200, "EUR") === "1 200 €" && priceLabel(400, "EUR") === "400 €");
    check("Upwork : $ et statuts courts en anglais", priceLabel(900, "USD") === "$900" && statusLabel("a_repondre", "upwork") === "New" && statusLabel("envoyee", "upwork") === "Sent" && statusLabel("envoyee", "codeur") === "Envoyée");
    check("horloge : New York 6 h plus tôt que Paris en octobre", clockLabel("America/New_York", now) === "04:00" && clockLabel("Europe/Paris", now) === "10:00", `${clockLabel("America/New_York", now)} / ${clockLabel("Europe/Paris", now)}`);
    check("thèmes : une classe par plateforme, badges d'Aujourd'hui compris", platformTheme("codeur") === "pf-codeur" && platformTheme("upwork") === "pf-upwork" && platformTheme("comeup") === "pf-comeup" && platformTheme("malt") === "pf-autres");
    check("ComeUp : commande ou demande", comeupKind("gagnee") === "Commande" && comeupKind("a_repondre") === "Demande");
  }

  console.log("\nPrix de lancement Upwork branché sur la proposition (Cowork #22)");
  {
    check("fixe : 17,5 % sous le budget, arrondi à 5 $", upworkBid("upwork", "$400 fixed")?.usd === 330 && upworkBid("upwork", "$1,000")?.usd === 825);
    check("fixe : plancher 100 $", upworkBid("upwork", "$50 fixed")?.usd === 100);
    check("horaire : 25 $/h", upworkBid("upwork", "$30.00-$45.00 /hr")?.kind === "hourly" && upworkBid("upwork", "$30.00-$45.00 /hr")?.usd === 25);
    check("budget illisible ou autre plateforme : pas de prix imposé", upworkBid("upwork", null) === null && upworkBid("codeur", "$400 fixed") === null);
    const refs = PROPOSAL_POSITIVES.filter((item) => item.title.startsWith("n8n automation") || item.title.startsWith("AI agent to qualify"));
    check("calibrage : les 2 positifs Upwork citent exactement le prix de lancement", refs.length === 2 && refs.every((item) => item.amountEur === upworkBid("upwork", item.budget)?.usd && item.framing.includes(upworkBidPhrase(upworkBid("upwork", item.budget)!))));

    // Rédaction : le prompt impose le prix, et le montant à saisir est celui de lancement même si le modèle en écrit un autre.
    const ref = refs[0];
    const prompts: string[] = [];
    const bidAsk: AskFn = async (role, system) => {
      if (role === "writer") {
        prompts.push(system);
        return JSON.stringify({ reading: ref.reading, steps: ref.steps, framing: ref.framing, question: ref.question, amount_eur: 900, delay_days: 7 });
      }
      return JSON.stringify({ score: 10, criteria: {}, reasons: [], fix: null, ...checklistKeys(10) });
    };
    const out = await generateProposal({ ask: bidAsk, platform: "upwork", language: "en", title: ref.title, body: ref.ad, budget: ref.budget, need: ref.reading, demo: ref.demo, kind: "automatisation", maxRewrites: 0 });
    check("prompt Upwork : prix de lancement imposé (« Fixed price: $330. »)", prompts.some((prompt) => prompt.includes("Fixed price: $330.")), prompts[0]?.slice(0, 120));
    check("montant à saisir sur Upwork = $330 (pas les $900 du modèle)", "text" in out && out.amountEur === 330 && out.currency === "USD" && !out.hourly, JSON.stringify(out));
    check("affichage « À saisir sur Upwork » : $330 ; horaire : $25/hr", priceLabel(330, "USD") === "$330" && priceLabel(25, "USD", true) === "$25/hr");
  }

  console.log(failures === 0 ? "\nTous les tests opportunités passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

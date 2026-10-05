/**
 * Qualité des mails (03/10/2026) — objectif « envoyable sans retouche ».
 * Fixtures uniquement : aucun réseau, aucun crédit (le modèle est un double).
 *
 * Exécution : `npm run test:mails-qualite`.
 */
import { FakeDb } from "./fake-supabase";
import { thirdPartyEmployer } from "../lib/emails/quality/third-party";
import { offTargetReason } from "../lib/funnel/off-target";
import { filterSignal } from "../lib/funnel/filter";
import { buildQualityGreeting, unknownFirstName } from "../lib/emails/quality/greeting";
import { ALLOWED_DEMO_URLS, demoFor, demoForProposal } from "../lib/emails/quality/demo-links";
import { checkMail, unsourcedTerms } from "../lib/emails/quality/rules";
import { assemble, countWords, ctaFor, CTA_VARIANTS } from "../lib/emails/quality/template";
import { generateQualityDraft, type QualityOutcome } from "../lib/emails/quality/generate";
import { subjectArm, subjectArmProblem } from "../lib/emails/quality/experiment";
import { buildWriterPrompt, parseParts } from "../lib/emails/quality/writer";
import { recordDraftVariant } from "../lib/emails/quality/variant";
import { avecAllowed, hookOfBody, isBlockedReason, mailReadiness, nameFact, opensWithAvec } from "../lib/emails/quality/readiness";
import { candidateDomains, findSiteFree, siteIdentity } from "../lib/contact-finder/free-site";
import { bySite } from "../lib/funnel/site-priority";
import { repeatedGroups } from "../lib/emails/quality/rules";
import { buildJudgePrompt, parseVerdict } from "../lib/emails/quality/judge";
import { allowedFamilies, assembleFamily, bareDemoUrl, F2_INTRO, F4_WHO, familyFor } from "../lib/emails/quality/families";
import { DEMO_LINKS } from "../lib/emails/quality/demo-links";
import { FOND_NEGATIVES, VALIDATED_POSITIVES } from "../lib/emails/quality/calibration-set";
import { numbersIn } from "../lib/emails/validate";
import { replaceDraft } from "../lib/emails/quality/versions";
import { tagsOf, isComplete } from "../lib/today/tags";
import { contactConfirmed, contactDomainMismatch, registrableDomain } from "../lib/today/contact-domain";
import { saveDraft } from "../lib/today/actions-core";
import type { AskFn } from "../lib/ai/chat";
import type { DerivedFact } from "../lib/emails/derived-facts";
import type { StrategyBrief } from "../lib/emails/strategist";
import type { Db } from "../lib/trash/scope";
import type { Prospect } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BELLEDONNE_HOOK =
  "Avec quatre fournils et des clients en restauration, chaque commande doit être saisie, vérifiée puis confirmée au bon site. C'est souvent là que les délais se perdent.";
const BELLEDONNE_PROPOSAL =
  "J'automatise ce type de tâche pour des PME : la commande reçue par mail est saisie dans votre outil et la confirmation part après votre validation.";
const GREETING = "Bonjour Monsieur Anquetil,";
const demo = demoFor("saisie et confirmation des commandes des restaurants");
const cta = CTA_VARIANTS[0];
const ruleContext = { greeting: GREETING, facts: [] as DerivedFact[], prospectText: "boulangerie bio", companyName: "Le Pain de Belledonne" };
const parts = (over: Partial<{ subject: string; hook: string; proposal: string }> = {}) => ({
  subject: "Commandes des restaurants",
  hook: BELLEDONNE_HOOK,
  proposal: BELLEDONNE_PROPOSAL,
  ...over,
});
const verdictJson = (score: number, reason = "accroche générique") =>
  JSON.stringify({
    // Grille de fond pleine (10), moins ce qui manque : retiré de la proposition, puis de la conséquence, puis du fait.
    criteria: {
      fait: Math.max(0, 2 - Math.max(0, 10 - score - 5)),
      consequence: Math.max(0, 2 - Math.max(0, 10 - score - 3)),
      proposition: Math.max(0, 3 - (10 - score)),
      clarte: 2,
      naturel: 1,
    },
    reasons: score >= 9 ? [] : [reason],
    fix: score >= 9 ? null : "Pars d'un fait plus concret.",
  });

async function main() {
  console.log("\n1. Exclusion amont : offres publiées pour des clients");
  check("1PACT : temps partagé (profil)", Boolean(thirdPartyEmployer({ naf: "70.22Z", names: ["1PACT"], activity: "Mise à disposition de salariés en CDI, à temps plein ou en temps partagé entre plusieurs entreprises." })));
  check("NEW NET 3D : Groupe Talents Handicap (nom)", Boolean(thirdPartyEmployer({ naf: "62.02A", names: ["NEW NET 3D (GROUPE TALENTS HANDICAP)"], website: "https://talents-handicap.com" })));
  check("Comptalents, Assistalents", Boolean(thirdPartyEmployer({ names: ["Comptalents"] })) && Boolean(thirdPartyEmployer({ names: ["Assistalents"] })));
  check("NAF 78.20Z", Boolean(thirdPartyEmployer({ naf: "78.20Z", names: ["X"] })));
  check("offre « pour notre client »", Boolean(thirdPartyEmployer({ names: ["ACME"], signalText: "Pour notre client, acteur de la logistique, nous recherchons…" })));
  for (const [name, naf, activity] of [
    ["KOMAKS FRANCE", "46.51Z", null],
    ["LE PAIN DE BELLEDONNE", "10.71A", "Fabrication et vente de pains, biscuits, cakes, chocolats et confiseries bio."],
    ["AKTID", "71.12B", null],
    ["ARTFLEX", "46.74B", "Distribution de robinetterie industrielle et d’accessoires de tuyauterie."],
    ["HUMAN SIGHT", "70.22Z", "Conseil SIRH, paie, GTA."],
  ] as const) {
    check(`${name} : pas exclu`, thirdPartyEmployer({ naf, names: [name], activity }) === null, String(thirdPartyEmployer({ naf, names: [name], activity })));
  }
  const pact = { company_name: "1PACT", website: "https://1pact.com", size_range: null, key_figures: { naf_code: "70.22Z" }, business_profile: { offer: "Mise à disposition de salariés en CDI, à temps plein ou en temps partagé." } } as unknown as Prospect;
  check("fiche existante 1PACT → hors cible, sans suppression", offTargetReason(pact)?.startsWith("signal pour un client") === true, String(offTargetReason(pact)));
  const verdict = filterSignal(
    { source: "france-travail", date: "2026-09-30", text: "Préparateur de commandes", url: null, siren: "1", companyName: "COMPTALENTS", facts: { label: "Offre", jobTitle: "Comptable" }, hash: "h" } as never,
    { siren: "1", name: "COMPTALENTS", naf: "70.22Z", effectifCode: "12", diffusion: "O" } as never,
  );
  check("entonnoir : rejeté avec le badge « signal pour un client »", verdict.status === "rejeté" && verdict.badges.includes("signal pour un client"), JSON.stringify(verdict));

  console.log("\n2. Salutation");
  const lebreton = { email: "silouane.lebreton@1pact.com", leaderPerson: "Silouane Lebreton", contactName: "Silouane Lebreton" };
  check("1PACT : prénom inconnu → demandé au modèle", unknownFirstName(lebreton) === "Silouane");
  check("1PACT nominatif → « Bonjour Monsieur Lebreton, »", buildQualityGreeting(lebreton, { silouane: "M" }) === "Bonjour Monsieur Lebreton,");
  const ivanov = { email: "contact@komaks.fr", leaderPerson: "Gradimir Ivanov" };
  check("KOMAKS générique + dirigeant → « Bonjour Monsieur Ivanov, »", buildQualityGreeting(ivanov, { gradimir: "M" }) === "Bonjour Monsieur Ivanov,", buildQualityGreeting(ivanov, { gradimir: "M" }));
  check("BELLEDONNE → « Bonjour Monsieur Anquetil, »", buildQualityGreeting({ email: "contact@belledonnebio.shop", leaderPerson: "Bruno Vincent Anquetil" }) === GREETING);
  check("AKTID (aktid@aktid.fr, pas de dirigeant) → « Bonjour, »", buildQualityGreeting({ email: "aktid@aktid.fr" }) === "Bonjour,");
  check("prénom mixte ou inconnu (« ? ») → « Bonjour, »", buildQualityGreeting(ivanov, { gradimir: "?" }) === "Bonjour,");
  check("nominatif sans prénom (j.benes@) → « Bonjour, »", buildQualityGreeting({ email: "j.benes@briol-diffusion.fr", leaderPerson: "Séverine Nassif" }) === "Bonjour,");
  // Noms composés, à trait d'union, à particule : jamais tronqués (FONDERIE DE LA BRUCHE, 05/10/2026).
  const fonderie = { email: "contact@fonderiebruche.fr", leaderPerson: "Virginie Danancher-(attard)", contactName: "Virginie Danancher-(attard)" };
  check("FONDERIE : « Danancher-(attard) » → « Bonjour Madame, », jamais « Danancher- »", buildQualityGreeting(fonderie) === "Bonjour Madame,", buildQualityGreeting(fonderie));
  check("nom finissant par « - » → civilité seule", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Virginie Danancher-" }) === "Bonjour Madame,");
  check("registre « Marie VACHERAND-GRANGER » → nom entier", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Marie VACHERAND-GRANGER" }) === "Bonjour Madame Vacherand-Granger,");
  check("adresse « marie.vacherand-granger@ » → nom entier", buildQualityGreeting({ email: "marie.vacherand-granger@x.fr" }) === "Bonjour Madame Vacherand-Granger,", buildQualityGreeting({ email: "marie.vacherand-granger@x.fr" }));
  check("« Jean de La Fontaine » → « Monsieur de La Fontaine »", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Jean de La Fontaine" }) === "Bonjour Monsieur de La Fontaine,", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Jean de La Fontaine" }));
  check("« Jean DE LA FONTAINE » (registre) → « Monsieur de La Fontaine »", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Jean DE LA FONTAINE" }) === "Bonjour Monsieur de La Fontaine,");
  check("« Yann LE GALL » reste « Le Gall »", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Yann LE GALL" }) === "Bonjour Monsieur Le Gall,");
  check("« Danancher-Attard » complet → gardé", buildQualityGreeting({ email: "contact@x.fr", leaderPerson: "Virginie DANANCHER-ATTARD" }) === "Bonjour Madame Danancher-Attard,");

  console.log("\n3. Preuve : une démo par pain, URL vérifiée");
  check("devis → /agent", demoFor("préparer les devis de menuiserie").path === "/agent");
  check("commandes → tri des e-mails", demoFor("saisie des commandes reçues par mail").path === "/automatisations?demo=email");
  check("factures, relances → factures", demoFor("facturation clients et relances de paiement").path === "/automatisations?demo=invoice");
  check("reporting → compte rendu", demoFor("reporting hebdomadaire des chantiers").path === "/automatisations?demo=meeting");
  check("SAV → service client", demoFor("réclamations du service après-vente").path === "/automatisations?demo=sav");
  check("sinon → toutes les démos", demoFor("autre chose").path === "/automatisations");
  check("aucune route /agent/<métier> (404 sur le site)", ALLOWED_DEMO_URLS.every((url) => !/\/agent\//.test(url)));

  console.log("\n4. Garde-fou déterministe");
  const target = assemble(parts(), { greeting: GREETING, demo, cta });
  const ok = checkMail(parts(), target, ruleContext);
  check("le mail cible (9/10) passe", ok.ok, ok.failures.join(" | "));
  check("60 à 90 mots", countWords(target) >= 60 && countWords(target) <= 90, String(countWords(target)));
  check("la ligne de preuve porte l'URL", target.includes(`Exemple testable en une minute : axelremillat.com/automatisations?demo=email`));
  const fail = (name: string, over: Partial<{ subject: string; hook: string; proposal: string }>, pattern: RegExp) => {
    const mail = parts(over);
    const result = checkMail(mail, assemble(mail, { greeting: GREETING, demo, cta }), ruleContext);
    check(name, !result.ok && result.failures.some((line) => pattern.test(line)), result.failures.join(" | "));
  };
  fail("KOMAKS : citer l'offre d'emploi → refusé", { hook: "Votre offre de préparateur publiée en septembre montre un besoin. Les commandes s'accumulent." }, /Offre d'emploi/);
  fail("« vous recrutez » → refusé", { hook: "Vous recrutez un comptable fournisseurs. Les factures s'empilent." }, /Offre d'emploi/);
  fail("« flux » → refusé", { proposal: "J'automatise ce type de tâche pour des PME : un flux saisit la commande dans votre outil." }, /Mots interdits.*flux/);
  fail("sigle RHD inconnu du prospect → refusé", { hook: "Vos clients RHD commandent chaque matin. Chaque commande est ressaisie à la main." }, /Sigles.*RHD/);
  fail("jargon « pièces de mission » → refusé", { hook: "Chaque mission génère ses pièces de mission. Elles sont classées à la main." }, /pièces de mission/);
  fail("phrase à rallonge → refusée", { hook: "Avec quatre fournils, des boutiques, des clients en restauration et des épiceries fines partout dans la région, chaque commande passe par plusieurs mains avant la livraison." }, /Phrase de \d+ mots/);
  fail("point-virgule (AKTID) → refusé", { hook: "Vos études couvrent la structure et les fluides ; chaque dossier circule entre plusieurs ingénieurs. Les versions se croisent." }, /Point-virgule/);
  fail("proposition = liste d'étapes → refusée", { proposal: "J'automatise ce type de tâche pour des PME : lecture du mail, extraction des lignes, contrôle du stock, saisie, puis envoi de la confirmation." }, /liste d'étapes/);
  fail("donnée de registre → refusée", { hook: "Avec 45 salariés et 11,6 M€ de chiffre d'affaires, vos factures s'accumulent. Le suivi prend du temps." }, /registre/);
  fail("« exemples testables sur mon site » → refusé", { proposal: "J'automatise ce type de tâche pour des PME, avec des exemples testables sur mon site." }, /exemples testables/);
  const noLink = checkMail(parts(), target.replace(/Exemple testable.*\n/, ""), ruleContext);
  check("lien de démo absent → refusé", !noLink.ok && noLink.failures.some((line) => /Lien de démo/.test(line)));

  console.log("\n5. Boucle : juge, 2 réécritures au plus, « À revoir »");
  const brief = {
    companyName: "Le Pain de Belledonne",
    angle: { type: "metier", hookFactIds: [], insight: "Quatre fournils et des clients en restauration" },
    pain: { task: "saisie et confirmation des commandes des restaurants", whyThem: [], automationIdea: "commande reçue par mail saisie dans l'outil" },
    rankedFacts: [],
    avoid: [],
    cta: "",
    proofId: null,
    targetingWarning: null,
    excludedAngles: [],
  } as unknown as StrategyBrief;
  const OWN_FACT = { id: "F1", key: "business_locations", label: "Implantations", value: "quatre fournils", source: "Site officiel", hookTier: 1, bodyUsable: true } as unknown as DerivedFact;
  const isDraft = (outcome: unknown): outcome is QualityOutcome => Boolean(outcome && typeof outcome === "object" && "body" in outcome);
  const base = { brief, facts: [OWN_FACT], prospectId: "p-belledonne", companyName: "Le Pain de Belledonne", activity: "Boulangerie bio", prospectText: "boulangerie bio", greeting: GREETING, signature: "Axel Remillat\nAutomatisation & IA pour PME · axelremillat.com/pme", family: "F1" as const };
  const scripted = (writer: string[], judge: string[]): { ask: AskFn; calls: string[] } => {
    const calls: string[] = [];
    const ask: AskFn = async (role) => {
      calls.push(role);
      return role === "writer" ? writer.shift() ?? "" : judge.shift() ?? "";
    };
    return { ask, calls };
  };
  const good = JSON.stringify(parts());
  {
    const { ask, calls } = scripted([good], [verdictJson(10)]);
    const outcome = await generateQualityDraft({ ...base, ask });
    check("9/10 du premier coup : retenu, pas « À revoir »", isDraft(outcome) && !outcome.needsReview && outcome.score === 10 && outcome.attempts === 1, JSON.stringify(calls));
    check("mention « stop » et signature gardées", isDraft(outcome) && outcome.body.includes("stop") && outcome.body.trimEnd().endsWith("axelremillat.com/pme"));
  }
  {
    const { ask, calls } = scripted([good, good, good], [verdictJson(7), verdictJson(8), verdictJson(7)]);
    const outcome = await generateQualityDraft({ ...base, ask });
    check("toujours < 9 : 3 essais (2 réécritures), puis « À revoir »", isDraft(outcome) && outcome.needsReview && outcome.attempts === 3, JSON.stringify(calls));
    check("la raison est donnée", isDraft(outcome) && /Note 8\/10/.test(outcome.reviewReason ?? ""), isDraft(outcome) ? String(outcome.reviewReason) : "");
    check("le meilleur essai est gardé (8/10)", isDraft(outcome) && outcome.score === 8);
  }
  {
    const bad = JSON.stringify(parts({ hook: "Vous recrutez un préparateur. Les commandes s'accumulent." }));
    const { ask, calls } = scripted([bad, good], [verdictJson(9)]);
    const outcome = await generateQualityDraft({ ...base, ask });
    check("règle cassée → réécrit sans payer le juge", calls.join(",") === "writer,writer,judge" && isDraft(outcome) && !outcome.needsReview, calls.join(","));
  }
  check("demande : une variante stable par prospect", ctaFor("p1") === ctaFor("p1") && CTA_VARIANTS.includes(ctaFor("p2") as never));
  check("juge : note bornée par la grille (fond seulement)", parseVerdict(JSON.stringify({ criteria: { fait: 9, proposition: 2, preuve: 1, demande: 1 }, reasons: [] }))?.score === 4);

  console.log("\n5b. Règles Cowork (itération 1)");
  {
    const rule = (name: string, over: Partial<{ subject: string; hook: string; proposal: string }>, pattern: RegExp, used: string[] = []) => {
      const mail = parts(over);
      const result = checkMail(mail, assemble(mail, { greeting: GREETING, demo, cta }), { ...ruleContext, usedCliches: used });
      check(name, !result.ok && result.failures.some((line) => pattern.test(line)), result.failures.join(" | "));
    };
    rule("« Dans le commerce de gros… » → refusé", { hook: "Dans le commerce de gros, une demande de prix réunit plusieurs références. Le client attend votre retour." }, /Accroche descriptive/);
    rule("« Spi Energie travaille dans… » → refusé", { hook: "Spi Energie travaille dans le génie climatique et le froid. Un article manquant retarde le chantier." }, /Accroche descriptive/);
    rule("« Vous fabriquez… » → refusé", { hook: "Vous fabriquez des équipements électriques. Une confirmation fournisseur oubliée retarde l'expédition." }, /Accroche descriptive/);
    rule("« prend du temps » → refusé", { hook: "Avec quatre fournils, chaque commande est vérifiée à la main. Cette vérification prend du temps." }, /Conséquence molle/);
    rule("hypothèse visible « si vos demandes » → refusée", { proposal: "J'automatise ce type de tâche pour des PME : si vos demandes arrivent par mail, elles sont triées pour validation." }, /Hypothèse visible/);
    rule("deux clichés → refusé", { proposal: "J'automatise ce type de tâche pour des PME : les commandes sont saisies dans votre outil, sans ressaisie ni oubli." }, /clichés de fin/);
    rule("cliché déjà servi aujourd'hui → refusé", { proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par mail sont saisies dans votre outil, sans ressaisie." }, /déjà dans un autre mail/, ["sans ressaisie"]);
    const komaks =
      "Avec un catalogue qui mêle consommables d'impression et matériel informatique, chaque commande demande de vérifier le stock référence par référence. Quand un article manque, le client attend votre retour.";
    const ref = parts({
      hook: komaks,
      proposal: "J'automatise ce type de tâche pour des PME : chaque commande reçue par e-mail est lue, les références disponibles partent en liste de prélèvement et les manquantes vous sont signalées.",
    });
    const refResult = checkMail(ref, assemble(ref, { greeting: "Bonjour Monsieur Ivanov,", demo, cta }), { ...ruleContext, greeting: "Bonjour Monsieur Ivanov," });
    check("la référence KOMAKS 10/10 de Cowork passe le garde-fou", refResult.ok, refResult.failures.join(" | "));
    const empty = mailReadiness({ facts: [], brief });
    check("aucun fait propre → « profil insuffisant », aucun appel", !empty.ok && empty.reason.startsWith("profil insuffisant"));
    const doubtful = { ...brief, pain: { ...brief.pain, task: "qualifier les demandes de prix, si ces tâches font partie du poste" } } as typeof brief;
    const unsure = mailReadiness({ facts: [OWN_FACT], brief: doubtful });
    check("pain au conditionnel → « pain incertain »", !unsure.ok && unsure.reason.startsWith("pain incertain"));
    const { ask, calls } = scripted([], []);
    const blocked = await generateQualityDraft({ ...base, facts: [], activity: null, ask });
    check("bloqué : aucun appel au modèle", "blocked" in blocked && calls.length === 0, JSON.stringify(blocked));
  }
  {
    const blockedTags = tagsOf({ email: "a@b.fr", emailDoubtful: false, oppositionUnverified: false, website: "x", hasBusinessProfile: false, hasDraft: false, draftPending: false, qualityReview: true });
    check("fiche bloquée : « À revoir », pas « Brouillon manquant » (pas de relance en boucle)", blockedTags.includes("À revoir") && !blockedTags.includes("Brouillon manquant"));
  }

  console.log("\n5c. Décisions Cowork (itération 2)");
  {
    const rule2 = (name: string, over: Partial<{ subject: string; hook: string; proposal: string }>, pattern: RegExp) => {
      const mail = parts(over);
      const result = checkMail(mail, assemble(mail, { greeting: GREETING, demo, cta }), ruleContext);
      check(name, !result.ok && result.failures.some((line) => pattern.test(line)), result.failures.join(" | "));
    };
    // Site trouvé gratuitement : domaines du nom, jamais Linkup ni Hunter.
    const domains = candidateDomains(["ACTUEL VERANDA ET MENUISERIE"]);
    check("domaines du nom : actuel-veranda.fr en tête", domains[0] === "actuel-veranda.fr", domains.join(","));
    check("sigle : « C.T.A. » → cta.fr", candidateDomains(["C.T.A."]).includes("cta.fr"), candidateDomains(["C.T.A."]).join(","));
    check("forme juridique retirée", !candidateDomains(["SARL BONNIN FRERES"]).some((domain) => domain.includes("sarl")));
    const paid: string[] = [];
    const fakeDeps = {
      fetchHtml: async (url: string) =>
        url.includes("actuel-veranda.fr")
          ? { url, html: "<html><body>Actuel Véranda et Menuiserie — vérandas, menuiseries. Mentions légales : ACTUEL VERANDA ET MENUISERIE, SIREN 123 456 789</body></html>" }
          : null,
      webSearch: async () => (paid.push("linkup"), []),
      hunterDomainSearch: async () => (paid.push("hunter"), []),
      hunterFinder: async () => (paid.push("hunter"), null),
      hunterVerify: async () => (paid.push("hunter"), null),
    };
    const site = await findSiteFree(siteIdentity({ name: "ACTUEL VERANDA ET MENUISERIE", siren: "123456789" }), fakeDeps as never);
    check("site validé par les mentions légales", site?.domain === "actuel-veranda.fr", JSON.stringify(site));
    check("aucun appel payant (Linkup, Hunter)", paid.length === 0, paid.join(","));
    const none = await findSiteFree(siteIdentity({ name: "BLANCHARD ET BLAZQUEZ", siren: "1" }), { ...fakeDeps, fetchHtml: async () => null } as never);
    check("aucun site validé → null, jamais un domaine deviné", none === null);

    // Exception étroite : la raison sociale nomme au moins deux activités.
    check("ACTUEL VERANDA ET MENUISERIE → fait propre", nameFact("ACTUEL VERANDA ET MENUISERIE")?.value === "vérandas, menuiserie");
    check("BLANCHARD ET BLAZQUEZ (deux noms) → pas un fait", nameFact("BLANCHARD ET BLAZQUEZ") === null);
    check("PRAT SERVICE DEPANNAGE (une activité) → pas un fait", nameFact("PRAT SERVICE DEPANNAGE") === null);
    const byName = mailReadiness({ facts: [], brief, hasSite: false, companyName: "ACTUEL VERANDA ET MENUISERIE" });
    check("sans site mais deux activités nommées : mail possible", byName.ok);
    const noSite = mailReadiness({ facts: [], brief, hasSite: false, companyName: "PRAT SERVICE DEPANNAGE" });
    check("sans site ni exception : « À revoir — sans site »", !noSite.ok && noSite.reason.startsWith("À revoir — sans site"));

    // Répétitions : un groupe nominal au plus deux fois.
    check("« commandes de consommables » ×3 → signalé", repeatedGroups("Commandes de consommables. Chaque commandes de consommables reçue. Les commandes de consommables sont triées.").includes("commandes de consommables"));
    check("deux fois : permis", repeatedGroups("Commandes de consommables. Les commandes de consommables sont triées.").length === 0);
    rule2("répétition dans le mail → refusée", { subject: "Commandes de consommables", hook: "Avec quatre fournils, les commandes de consommables arrivent chaque matin. Une commande de consommables oubliée retarde la livraison.", proposal: "J'automatise ce type de tâche pour des PME : les commandes de consommables reçues par e-mail sont lues et les manquantes signalées." }, /revient plus de deux fois/);

    // Entonnoir : site trouvé d'abord, sans changer le plafond.
    const row = (id: string, contact: Record<string, unknown> | null, website: string | null = null) =>
      ({ row: { id, identity: { base: { company_name: id, website } }, contact } as never });
    const ordered = bySite([row("sans-site", { site_free: { website: null, checked_at: "x" } }), row("pas-vu", null), row("avec-site", { site_free: { website: "https://a.fr", checked_at: "x" } }), row("annuaire", null, "https://b.fr")]);
    check("ordre : site trouvé, puis à chercher, puis sans site", ordered.map((item) => (item.row as { id: string }).id).join(",") === "avec-site,annuaire,pas-vu,sans-site", ordered.map((item) => (item.row as { id: string }).id).join(","));
  }

  console.log("\n5d. Finition (Cowork #5)");
  {
    const spi = parts({
      subject: "Devis de maintenance",
      hook: "Chez vous, les demandes de maintenance des réseaux d'air comprimé arrivent par e-mail. Une demande mal aiguillée retarde le devis au client.",
      proposal: "J'automatise ce type de tâche pour des PME : les demandes et commandes reçues par e-mail sont triées et transmises à la bonne personne.",
    });
    const incoherent = checkMail(spi, assemble(spi, { greeting: GREETING, demo: demoFor("devis"), cta }), { ...ruleContext, demo: "devis" });
    check("SPI : phrase « tri des e-mails » + lien agent devis → refusé", incoherent.failures.some((line) => /Démo incohérente/.test(line)), incoherent.failures.join(" | "));
    const coherent = checkMail(spi, assemble(spi, { greeting: GREETING, demo: demoFor("commandes reçues par e-mail"), cta }), { ...ruleContext, demo: "emails" });
    check("même phrase + démo e-mails → cohérent", !coherent.failures.some((line) => /Démo incohérente/.test(line)), coherent.failures.join(" | "));
    const devis = parts({ proposal: "J'automatise ce type de tâche pour des PME : chaque demande reçue est transformée en devis prêt à vérifier." });
    const devisOk = checkMail(devis, assemble(devis, { greeting: GREETING, demo: demoFor("devis"), cta }), { ...ruleContext, demo: "devis" });
    check("phrase « devis » + agent devis → cohérent", !devisOk.failures.some((line) => /Démo incohérente/.test(line)), devisOk.failures.join(" | "));
    const sortsQuotes = "J'automatise ce type de tâche pour des PME : les e-mails de demande de devis et de commande sont triés et orientés vers la bonne personne.";
    check("SPI : « demandes de devis… triées et orientées » → démo e-mails (l'action décide)", demoForProposal(sortsQuotes).key === "emails", demoForProposal(sortsQuotes).key);
    check("« prépare un devis chiffré » → agent devis", demoForProposal("J'automatise ce type de tâche pour des PME : chaque demande reçue est lue et un devis chiffré est préparé pour validation.").key === "devis");
    check("« factures » sans action de tri → table habituelle", demoForProposal("J'automatise ce type de tâche pour des PME : les factures fournisseurs sont saisies dans votre comptabilité.").key === "factures");

    const avec = parts({ hook: "Avec quatre fournils et des clients en restauration, chaque commande est vérifiée à la main. Une erreur retarde la livraison." });
    const second = checkMail(avec, assemble(avec, { greeting: GREETING, demo, cta }), { ...ruleContext, dayOpenings: { total: 1, avec: 1 } });
    check("2e « Avec » sur 2 mails → refusé", second.failures.some((line) => /Ouverture « Avec… »/.test(line)), second.failures.join(" | "));
    const fourth = checkMail(avec, assemble(avec, { greeting: GREETING, demo, cta }), { ...ruleContext, dayOpenings: { total: 3, avec: 1 } });
    check("2e « Avec » sur 4 mails → permis (1 sur 3)", !fourth.failures.some((line) => /Ouverture « Avec… »/.test(line)));
    check("1er mail du jour en « Avec » → permis", avecAllowed({ total: 0, avec: 0 }));
    check("accroche lue dans un corps stocké", opensWithAvec(hookOfBody("Bonjour,\n\nAvec vos fournils, …\n\nJ'automatise …")));

    check("blocage reconnu (profil insuffisant)", isBlockedReason("profil insuffisant : aucun fait propre lu sur le site"));
    check("blocage reconnu (sans site)", isBlockedReason("À revoir — sans site : aucun site trouvé"));
    check("note du juge : pas un blocage", !isBlockedReason("Note 8/10 : accroche générique"));
  }

  console.log("\n5e. Expérience n° 1 : style d'objet (50/50)");
  {
    const ids = Array.from({ length: 2000 }, (_, index) => `prospect-${index}-${index * 7919}`);
    const questions = ids.filter((id) => subjectArm(id) === "question").length;
    check("répartition proche de 50/50 sur 2 000 fiches", questions > 900 && questions < 1100, String(questions));
    check("bras stable pour une même fiche (régénération)", subjectArm("p-belledonne") === subjectArm("p-belledonne"));
    check("bras « question » : « Vos confirmations de délai ? » accepté", subjectArmProblem("Vos confirmations de délai ?", "question") === null);
    check("bras « question » : un sujet sans « ? » refusé", subjectArmProblem("Confirmations de délai", "question") !== null);
    check("bras « métier » : « Commandes de consommables » accepté", subjectArmProblem("Commandes de consommables", "metier") === null);
    check("bras « métier » : une question refusée", subjectArmProblem("Vos commandes ?", "metier") !== null);
    const prompt = buildWriterPrompt({ brief, facts: [], own: [OWN_FACT], activity: null, companyName: "ACME", demo, greeting: GREETING, cta, subjectArm: "question" });
    check("consigne d'objet du bras transmise au rédacteur", prompt.includes("UNE QUESTION COURTE"));
    const mail = parts({ subject: "Commandes des restaurants" });
    const armCheck = checkMail(mail, assemble(mail, { greeting: GREETING, demo, cta }), { ...ruleContext, subjectArm: "question" });
    check("garde-fou : l'objet doit suivre son bras", armCheck.failures.some((line) => /bras « question »/.test(line)), armCheck.failures.join(" | "));

    const { ask } = scripted([JSON.stringify(parts({ subject: "Vos commandes des restaurants ?" }))], [verdictJson(10)]);
    const outcome = await generateQualityDraft({ ...base, ask, subjectArm: "question" });
    check("la génération rend le bras retenu", isDraft(outcome) && outcome.subjectStyle === "question");

    const rows: Record<string, unknown>[] = [];
    const writer = { from: () => ({ upsert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }) }) };
    if (isDraft(outcome)) await recordDraftVariant(writer, { messageId: "m1", userId: "u1", brief, outcome });
    check("variante enregistrée : bras, démo, demande, premier mot, longueur", rows[0]?.subject_style === "question" && rows[0]?.demo === "emails" && rows[0]?.cta === "rdv-15-min" && Boolean(rows[0]?.opening_word) && Number(rows[0]?.length) > 0, JSON.stringify(rows[0]));
  }

  console.log("\n6. Historique et « modifié à la main »");
  {
    const db = new FakeDb({ messages: [{ id: "m1", user_id: "u", status: "draft", send_status: "draft", subject: "Ancien", body: "Ancien texte", quality_score: null, edited_by_hand: false, deleted_at: null }], message_versions: [] });
    const saved = await replaceDraft({ db: db as unknown as Db, userId: "u" }, "m1", { subject: "Nouveau", body: "Nouveau texte", quality_score: 9.5 }, { auto: true, reason: "régénération automatique" });
    check("ancienne version rangée avant le remplacement", saved === "saved" && db.rows("message_versions")[0]?.body === "Ancien texte");
    check("brouillon remplacé, note posée", db.rows("messages")[0]?.body === "Nouveau texte" && db.rows("messages")[0]?.quality_score === 9.5);
  }
  {
    const db = new FakeDb({ messages: [{ id: "m2", user_id: "u", status: "draft", send_status: "draft", subject: "Mien", body: "Retouché par Axel", edited_by_hand: true, deleted_at: null }], message_versions: [] });
    const saved = await replaceDraft({ db: db as unknown as Db, userId: "u" }, "m2", { subject: "Généré", body: "Généré" }, { auto: true, reason: "régénération automatique" });
    check("retouché à la main : jamais réécrit automatiquement", saved === "edited" && db.rows("messages")[0]?.body === "Retouché par Axel" && db.rows("message_versions").length === 0);
  }
  for (const [label, lock] of [["validé", { validated_at: "2026-10-05T09:45:00Z" }], ["programmé", { scheduled_at: "2026-10-05T10:05:00Z" }]] as const) {
    const db = new FakeDb({ messages: [{ id: "m4", user_id: "u", status: "draft", send_status: "draft", subject: "Vu par Axel", body: "Texte validé", edited_by_hand: false, deleted_at: null, ...lock }], message_versions: [] });
    const saved = await replaceDraft({ db: db as unknown as Db, userId: "u" }, "m4", { subject: "Généré", body: "Généré" }, { auto: true, reason: "régénération automatique" });
    check(`${label} par Axel : jamais réécrit automatiquement`, saved === "locked" && db.rows("messages")[0]?.body === "Texte validé" && db.rows("message_versions").length === 0);
  }
  {
    const db = new FakeDb({ messages: [{ id: "m3", user_id: "u", status: "draft", send_status: "draft", subject: "Objet", body: "Bonjour,\n\nTexte.", edited_by_hand: false, deleted_at: null }] });
    await saveDraft(db as unknown as Db, "u", { messageId: "m3", subject: "Objet", core: "Bonjour,\n\nTexte.", optOut: false, signature: null }, true);
    check("Valider sans changer le texte : pas « modifié à la main »", db.rows("messages")[0]?.edited_by_hand === false);
    await saveDraft(db as unknown as Db, "u", { messageId: "m3", subject: "Objet", core: "Bonjour,\n\nTexte retouché.", optOut: false, signature: null });
    check("texte retouché : « modifié à la main »", db.rows("messages")[0]?.edited_by_hand === true);
  }

  console.log("\n7. Note < 9 : « À revoir », pas « Nouveaux »");
  const tags = tagsOf({ email: "a@b.fr", emailDoubtful: false, oppositionUnverified: false, website: "x", hasBusinessProfile: true, hasDraft: true, draftPending: false, qualityReview: true });
  check("étiquette « À revoir »", tags.includes("À revoir"));
  check("bloquante : la fiche ne va pas dans « Nouveaux »", !isComplete(tags, true));
  check("note ≥ 9 : rien ne change", isComplete(tagsOf({ email: "a@b.fr", emailDoubtful: false, oppositionUnverified: false, website: "x", hasBusinessProfile: true, hasDraft: true, draftPending: false, qualityReview: false }), true));

  console.log("\nFamilles de mails (expérience n° 2)");
  {
    // Attribution : stable, uniforme, F1/F3 exclues sans fait solide.
    const counts: Record<string, number> = { F1: 0, F2: 0, F3: 0, F4: 0 };
    for (let index = 0; index < 400; index += 1) counts[familyFor(`prospect-${index}`)] += 1;
    check("attribution stable par prospect", familyFor("p-x") === familyFor("p-x"));
    check("attribution ~uniforme sur 4 familles (400 prospects)", Object.values(counts).every((count) => count > 70 && count < 130), JSON.stringify(counts));
    const thin = new Set(Array.from({ length: 100 }, (_, index) => familyFor(`p-${index}`, allowedFamilies(false))));
    check("sans fait solide : F2 ou F4 seulement", [...thin].every((family) => family === "F2" || family === "F4") && thin.size === 2, [...thin].join(","));

    // Gabarits et lien suivi.
    const emails = DEMO_LINKS.emails;
    const f2 = assembleFamily("F2", { subject: "Demandes de prix", hook: "Pour une boulangerie qui livre la restauration, les commandes arrivent chaque matin par e-mail. Une commande non confirmée laisse le client sans réponse.", proposal: "Je mets en place le tri de chaque commande reçue et je prépare sa confirmation, que vous validez." }, { greeting: GREETING, demo: emails, cta });
    check("F2 : présentation imposée en tête", f2.split("\n\n")[1] === F2_INTRO);
    check("F2 : démo « proche de ce que vous pourriez avoir chez vous » + &v=2 discret (jamais « F2 » en clair)", f2.includes("Une démo proche de ce que vous pourriez avoir chez vous : axelremillat.com/automatisations?demo=email&v=2") && !/F[1-4]/.test(f2));
    const f4 = assembleFamily("F4", { subject: "Devis de tôlerie", hook: "Elle lit une demande de coffret sur mesure et prépare un brouillon de devis à vérifier.", proposal: F4_WHO }, { greeting: GREETING, demo: DEMO_LINKS.devis, cta });
    check("F4 : le lien en première ligne, ?v=4 sur /agent", f4.split("\n\n")[1] === "Une démo testable en une minute : axelremillat.com/agent?v=4");
    check("F4 : qui je suis en une ligne, posé par le code", f4.split("\n\n")[3] === F4_WHO);
    check("URL suivie reconnue par la liste blanche", ALLOWED_DEMO_URLS.includes(bareDemoUrl("axelremillat.com/automatisations?demo=email&v=3")) && ALLOWED_DEMO_URLS.includes(bareDemoUrl("axelremillat.com/agent?v=4")));

    // Règles par famille.
    const f3Parts = { subject: "Vos délais de commande ?", hook: "Qui confirme aujourd'hui les délais des commandes de vos clients en restauration ?", proposal: "J'automatise ce suivi : chaque commande reçue par e-mail est repérée et sa confirmation préparée." };
    const f3Body = assembleFamily("F3", f3Parts, { greeting: GREETING, demo: emails, cta });
    const f3 = checkMail(f3Parts, f3Body, { ...ruleContext, family: "F3", subjectArm: "question", demo: "emails" });
    check(`F3 : question d'ouverture permise, ≤ 55 mots (${countWords(f3Body)})`, f3.ok, f3.failures.join(" | "));
    const f3Long = checkMail({ ...f3Parts, proposal: `${f3Parts.proposal.slice(0, -1)}, puis rangée dans votre suivi des commandes avec les références, les quantités et la date de livraison prévue.` }, assembleFamily("F3", { ...f3Parts, proposal: `${f3Parts.proposal.slice(0, -1)}, puis rangée dans votre suivi des commandes avec les références, les quantités et la date de livraison prévue.` }, { greeting: GREETING, demo: emails, cta }), { ...ruleContext, family: "F3", subjectArm: "question", demo: "emails" });
    check("F3 : au-delà de 55 mots → refusé", !f3Long.ok && f3Long.failures.some((line) => /55 au plus/.test(line)), f3Long.failures.join(" | "));
    const f1Question = checkMail(f3Parts, assemble(f3Parts, { greeting: GREETING, demo: emails, cta }), { ...ruleContext, demo: "emails" });
    check("F1 : une question dans l'accroche reste refusée", !f1Question.ok && f1Question.failures.some((line) => /Aucune question/.test(line)));
    const f2Parts = { subject: "Commandes de restauration", hook: "Dans une boulangerie qui livre la restauration, les commandes arrivent chaque matin par e-mail. Une commande non confirmée laisse le client sans réponse.", proposal: "Je mets en place le tri de chaque commande reçue et je prépare sa confirmation, que vous validez." };
    const f2Check = checkMail(f2Parts, assembleFamily("F2", f2Parts, { greeting: GREETING, demo: emails, cta }), { ...ruleContext, family: "F2", subjectArm: "metier", demo: "emails" });
    check("F2 : partir de l'activité (« Dans une boulangerie qui… ») est permis", f2Check.ok, f2Check.failures.join(" | "));

    // Relecture Cowork + Axel (05/10) : démo honnête (F4), première personne active (F2), faits sourcés.
    const f4Rule = (hook: string) =>
      checkMail({ subject: "Factures clients", hook, proposal: F4_WHO }, assembleFamily("F4", { subject: "Factures clients", hook, proposal: F4_WHO }, { greeting: GREETING, demo: DEMO_LINKS.factures, cta }), {
        ...ruleContext,
        prospectText: "vêtements professionnels",
        family: "F4",
        subjectArm: "metier",
        demo: "factures",
        knownText: "Fabrication de vêtements professionnels",
      });
    const dishonest = f4Rule("Elle lit une commande de vêtements professionnels et prépare la facture client à valider.");
    check("F4 : démo présentée comme faite sur leur métier → refusée (DUPONT-BEAUDEUX)", !dishonest.ok && dishonest.failures.some((line) => /démo honnête/.test(line)), dishonest.failures.join(" | "));
    const honest = f4Rule("Elle lit une commande type et prépare la facture à valider ; le même principe s'appliquerait à vos commandes de vêtements professionnels.");
    check("F4 : cas type + « le même principe s'appliquerait » → accepté", honest.ok, honest.failures.join(" | "));
    const f2Rule = (proposal: string) =>
      checkMail({ ...f2Parts, proposal }, assembleFamily("F2", { ...f2Parts, proposal }, { greeting: GREETING, demo: emails, cta }), { ...ruleContext, family: "F2", subjectArm: "metier", demo: "emails", knownText: "Boulangerie bio, commandes des restaurants" });
    const passive = f2Rule("Concrètement, les demandes de pièces reçues par e-mail sont triées, puis une commande fournisseur est préparée pour votre validation.");
    check("F2 : passif sans première personne → refusé (AIRPLANE DELIVERY)", !passive.ok && passive.failures.some((line) => /première personne/.test(line)) && passive.failures.some((line) => /voix passive/.test(line)), passive.failures.join(" | "));
    const active = f2Rule("Je mets en place le tri de chaque commande reçue et je prépare sa confirmation, que vous validez.");
    check("F2 : première personne, voix active, faits sourcés → accepté", active.ok, active.failures.join(" | "));
    check("faits non sourcés repérés (« compagnie aéronautique régionale » absente de ce que l'on sait)", unsourcedTerms("Pour une compagnie aéronautique régionale, chaque intervention attend.", "boulangerie bio commandes").length >= 2);
    check("faits sourcés (« avions régionaux » lus sur le site) : rien à signaler", unsourcedTerms("En maintenance d'avions régionaux, chaque pièce compte.", "Maintenance en base, pièces détachées pour avions régionaux").length === 0);
    check("juges F2 et F4 : les cas réels sont montrés en contre-exemples", buildJudgePrompt("F4").includes("commande de vêtements professionnels et prépare la facture") && buildJudgePrompt("F2").includes("revient souvent, avec une intervention qui attend"));

    // Contact à vérifier : e-mail hors du domaine du site (AIRPLANE DELIVERY).
    check("domaine enregistrable : www.shop.exemple.fr → exemple.fr", registrableDomain("https://www.shop.exemple.fr/contact") === "exemple.fr");
    check("AIRPLANE : contact@airplane.aero ≠ airplane-delivery.fr → à vérifier", contactDomainMismatch("contact@airplane.aero", "https://airplane-delivery.fr")?.emailDomain === "airplane.aero");
    check("même domaine (sous-domaine du site) : rien à vérifier", contactDomainMismatch("jean@mail.exemple.fr", "https://www.exemple.fr") === null);
    check("messagerie grand public (gmail) : pas un indice d'erreur", contactDomainMismatch("boulangerie.martin@gmail.com", "https://boulangerie-martin.fr") === null);
    const airplaneFigures = { contact_confirmed: { email: "contact@airplane.aero", at: "2026-10-05" } };
    check("confirmation liée à l'adresse : confirmée", contactConfirmed(airplaneFigures, "Contact@Airplane.aero"));
    check("nouvelle adresse : la confirmation ne vaut plus", !contactConfirmed(airplaneFigures, "ventes@airplane.aero"));
    const toCheck = tagsOf({ email: "contact@airplane.aero", emailDoubtful: false, contactToCheck: true, oppositionUnverified: false, website: "x", hasBusinessProfile: true, hasDraft: true, draftPending: false });
    check("« Contact à vérifier » : bloquant, jamais dans « Nouveaux »", toCheck.includes("Contact à vérifier") && !isComplete(toCheck, true));

    // Rédacteur et juge par famille.
    check("F4 : le modèle n'écrit pas la ligne « qui je suis »", parseParts(JSON.stringify({ subject: "Devis", hook: "Elle lit une demande." }), "F4")?.proposal === F4_WHO);
    check("F3 : grille du juge propre (question 4, phrase 3, clarté 2, naturel 1)", parseVerdict(JSON.stringify({ criteria: { question: 4, phrase: 3, clarte: 2, naturel: 1, fait: 2 } }), "F3")?.score === 10);
    const f2Prompt = buildWriterPrompt({ brief, facts: [OWN_FACT], own: [], activity: "Boulangerie bio", companyName: "Le Pain de Belledonne", demo: emails, greeting: GREETING, cta, family: "F2" });
    check("F2 : le rédacteur voit la présentation imposée et la démo « proche de chez vous »", f2Prompt.includes(F2_INTRO) && f2Prompt.includes("Une démo proche"));

    // Routage : pain incertain → F2 ou F4, jamais F1 ; sans activité → bloqué.
    const doubtful = { ...brief, pain: { ...brief.pain, task: "suivi des commandes, à confirmer" } } as typeof brief;
    const f2Good = JSON.stringify(f2Parts);
    const f4Good = JSON.stringify({ subject: "Commandes de restauration", hook: "Elle lit une commande type et prépare sa confirmation à valider ; le même principe s'appliquerait à vos commandes de pain pour la restauration.", proposal: "" });
    const routed: string[] = [];
    for (const prospectId of ["p-a", "p-b", "p-c", "p-d", "p-e", "p-f"]) {
      const { ask } = scripted([f2Good, f4Good, f2Good, f4Good], [verdictJson(10), verdictJson(10), verdictJson(10)]);
      const outcome = await generateQualityDraft({ ...base, family: undefined, brief: doubtful, prospectId, ask });
      routed.push(isDraft(outcome) ? outcome.family : "blocked" in outcome ? "bloqué" : "erreur");
    }
    check("pain incertain + activité → F2 ou F4, jamais F1/F3", routed.every((family) => family === "F2" || family === "F4"), routed.join(","));
    const { ask: none, calls: noCalls } = scripted([], []);
    const noActivity = await generateQualityDraft({ ...base, family: undefined, brief: doubtful, activity: null, ask: none });
    check("pain incertain sans activité → bloqué, aucun appel", "blocked" in noActivity && noCalls.length === 0);

    // Enregistrement de la famille.
    const variants = new FakeDb({ message_variants: [] });
    await recordDraftVariant(variants, { messageId: "m-fam", userId: "u", outcome: { subject: "Vos délais ?", body: f3Body, demo: emails.path, subjectStyle: "question", family: "F3" } });
    check("famille enregistrée dans message_variants", variants.rows("message_variants")[0]?.family === "F3", JSON.stringify(variants.rows("message_variants")[0]));
  }

  console.log("\nCalibrage : les mails validés par Axel passent les règles du code");
  {
    // Le code ne doit jamais être plus sévère qu'Axel : chaque mail validé le 05/10
    // passe les règles de forme (60 à 90 mots, mots interdits, démo cohérente…).
    for (const mail of VALIDATED_POSITIVES) {
      const demo = demoForProposal(mail.proposal);
      const greeting = "Bonjour Madame Martin,";
      const body = assemble(mail, { greeting, demo, cta: CTA_VARIANTS[0] });
      const result = checkMail(mail, body, { greeting, facts: [], prospectText: `${mail.hook} ${mail.proposal}`, companyName: mail.company, offerNumbers: numbersIn(mail.hook), demo: demo.key });
      check(`validé ${mail.company} (${countWords(body)} mots) : règles OK`, result.ok, result.failures.join(" | "));
    }
    check("jeu de référence : 11 positifs, 6 négatifs de fond", VALIDATED_POSITIVES.length === 11 && FOND_NEGATIVES.length === 6);
  }

  console.log(failures === 0 ? "\nTous les tests qualité passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

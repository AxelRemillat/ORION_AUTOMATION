/**
 * Qualité des mails : profil métier, règles de rédaction vérifiées par code,
 * plafond de 110 mots, salutation, preuve, créneau conseillé, éval aveugle.
 * Aucun appel réseau : fixtures et fausse base.
 *
 *   npm run test:mails
 */
import { FakeDb } from "./fake-supabase";
import {
  extractProfile,
  groundProfile,
  numbersInQuote,
  profileBlock,
  storedProfile,
  type ProfilePage,
  type RawBusinessProfile,
} from "../lib/emails/business-profile";
import { MAX_BODY_WORDS, bodyWordCount, exceedsWordLimit } from "../lib/mail-preflight/words";
import { civilityFor, salutationFor, usagePerson } from "../lib/emails/salutation";
import { hollowParaphrase, oldFactAsRecent, opensOnJobOffer, validateSubject } from "../lib/emails/validate";
import { isPartnerProspect, painGroundedInProfile } from "../lib/emails/strategist";
import { chooseProof, GENERIC_PROOF_SENTENCE, signatureFor } from "../lib/offer/model";
import { defaultOffer } from "../lib/offer/read";
import { suggestSendTime } from "../lib/emails/send-time";
import { buildGreeting } from "../app/api/emails/generate/prompt";
import { latestIntroDraft } from "../lib/jobs/handlers/email";
import { toDomain } from "../lib/contact-finder/domains";
import { buildJudgePrompt, generatedIsA, goalReached, parseVerdict, renderReport } from "./eval-mails-core";
import type { DerivedFact } from "../lib/emails/derived-facts";
import type { Db } from "../lib/jobs/runner";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BRIOL_SITE: ProfilePage[] = [
  {
    url: "https://www.menuiserie-briol.fr/",
    text:
      "Menuiserie Briol, fourniture et pose de fenêtres, portes et cuisines. Nos trois showrooms vous accueillent. " +
      "Une douzaine de commerciaux à votre écoute. Demandez votre devis gratuit en ligne. Pose par nos équipes.",
  },
];

const BRIOL_RAW: RawBusinessProfile = {
  offer: "fourniture et pose de menuiseries et cuisines",
  customers: "B2C",
  customerDetail: "particuliers en rénovation",
  demandChannels: ["formulaire de devis en ligne", "showrooms"],
  counts: [
    { label: "showrooms", count: 3, quote: "Nos trois showrooms vous accueillent" },
    { label: "commerciaux", count: 12, quote: "Une douzaine de commerciaux à votre écoute" },
    { label: "agences", count: 8, quote: "Huit agences partout en France" },
  ],
  services: [
    { name: "pose", quote: "Pose par nos équipes" },
    { name: "livraison", quote: "Livraison offerte" },
  ],
  commercialName: "Menuiserie Briol",
};

console.log("\n1. Profil métier : le code garde seulement ce que le site dit");
{
  check("douzaine = 12", numbersInQuote("Une douzaine de commerciaux").includes(12));
  check("trois = 3", numbersInQuote("Nos trois showrooms").includes(3));
  const profile = groundProfile(BRIOL_RAW, BRIOL_SITE);
  check("les comptes cités restent", profile.counts.map((item) => item.count).join(",") === "3,12");
  check("un compte sans citation est retiré", profile.dropped.some((line) => line.includes("agences")));
  check("un service sans citation est retiré", profile.services.map((item) => item.name).join() === "pose");
  check("le nom commercial présent sur le site est gardé", profile.commercialName === "Menuiserie Briol");
  const wrongNumber = groundProfile({ ...BRIOL_RAW, counts: [{ label: "showrooms", count: 5, quote: "Nos trois showrooms vous accueillent" }] }, BRIOL_SITE);
  check("citation vraie mais nombre faux → retiré", wrongNumber.counts.length === 0);
  check("le bloc stratège dit que le NAF ne décide pas", profileBlock(profile).includes("pas le NAF"));
  check("un profil stocké se relit", storedProfile(JSON.parse(JSON.stringify(profile)))?.counts.length === 2);
  check("un jsonb invalide donne null", storedProfile({ offer: 3 }) === null);
}

console.log("\n2. Profil métier : une reprise si le JSON est mauvais");
void (async () => {
  let calls = 0;
  const profile = await extractProfile(
    async () => (++calls === 1 ? "pas du json" : JSON.stringify(BRIOL_RAW)),
    "BRIOL DIFFUSION",
    BRIOL_SITE,
  );
  check("deux appels au plus", calls === 2);
  check("profil obtenu à la reprise", profile?.offer === BRIOL_RAW.offer);
  check("sans page, aucun appel", (await extractProfile(async () => "{}", "X", [])) === null);

  console.log("\n3. Le pain vient du profil, pas du NAF");
  const grounded = groundProfile(BRIOL_RAW, BRIOL_SITE);
  check("pain devis ancré dans le profil", painGroundedInProfile("relancer les demandes de devis des showrooms", grounded));
  check("pain expéditions non ancré", !painGroundedInProfile("suivre les expéditions palettes vers les chantiers", grounded));
  check("sans profil, on ne bloque pas", painGroundedInProfile("n'importe quoi", null));
  check("70.22Z est un partenaire", isPartnerProspect("70.22Z"));
  check("46.73A n'en est pas un", !isPartnerProspect("46.73A"));

  console.log("\n4. Plafond 110 mots hors signature, compté comme l'UI");
  const offer = defaultOffer();
  const signature = signatureFor(offer);
  // Phrases de 12 mots : ce bloc mesure la LONGUEUR du mail, pas celle des
  // phrases (une phrase de 100 mots echouerait desormais sur l'autre regle).
  const words = (n: number) =>
    Array.from({ length: n }, (_, i) => `mot${i}${(i + 1) % 12 === 0 ? "." : ""}`).join(" ");
  check("plafond à 110", MAX_BODY_WORDS === 110);
  check("la signature ne compte pas", bodyWordCount(`${words(100)}\n\n${signature}`, signature) === 100);
  check("110 passe", !exceedsWordLimit(`${words(110)}\n\n${signature}`, signature));
  check("111 bloque", exceedsWordLimit(`${words(111)}\n\n${signature}`, signature));
  for (const n of [127, 123, 126]) check(`${n} mots (cas constatés) bloquent`, exceedsWordLimit(words(n), signature));

  console.log("\n5. Salutation : Monsieur/Madame + nom d'usage");
  check("registre en capitales", usagePerson("Jean-Marc BRIOL")?.last === "Briol");
  check("nom composé du registre", usagePerson("Yann LE GALL")?.last === "Le Gall");
  check("« née » → nom d'usage", usagePerson("Sophie MARTIN née DUPONT")?.last === "Martin");
  check("« épouse » → nom d'usage", usagePerson("Sophie DUPONT épouse MARTIN")?.last === "Martin");
  check("Monsieur", salutationFor("Philippe BONNIN") === "Bonjour Monsieur Bonnin,");
  check("Madame", salutationFor("Sophie DUPONT épouse MARTIN") === "Bonjour Madame Martin,");
  // Civilité incertaine : neutre. « Bonjour Camille Durand, » a été remplacé par
  // « Bonjour, » — écrire le prénom d'un dirigeant qu'on ne connaît pas sonne
  // faux, et « Bonjour Birama, » est sorti tel quel sur GLOBAL 2F.
  check("prénom mixte → neutre", salutationFor("Camille Durand") === "Bonjour,");
  check("personne → « Bonjour, »", salutationFor(null) === "Bonjour,");
  check("civilité accentuée", civilityFor("Hélène") === "Madame");
  const generic = { email: "contact@briol.fr", full_name: null, position: null, confidence: null };
  check(
    "adresse générique + dirigeant connu → on le nomme",
    buildGreeting("direct", generic, "Jean-Marc BRIOL") === "Bonjour Monsieur Briol,",
    buildGreeting("direct", generic, "Jean-Marc BRIOL"),
  );

  console.log("\n6. Accroche : paraphrase creuse et fait ancien");
  const sign = "Axel";
  check("« rappelle l'importance de » refusé", hollowParaphrase("Bonjour,\n\nVotre offre rappelle l'importance de la qualité.", sign) !== null);
  check("« témoigne de » refusé", hollowParaphrase("Bonjour,\n\nCe recrutement témoigne de votre croissance.", sign) !== null);
  check("un fait simple passe", hollowParaphrase("Bonjour,\n\nAvec trois showrooms, chaque devis est relancé.", sign) === null);
  const now = new Date("2026-09-27T00:00:00Z");
  const fact = (date: string) => ({ id: "F1", date } as unknown as DerivedFact);
  const hook = "Bonjour,\n\nVous venez d'ouvrir une agence à Nantes.";
  check("fait de 2024 présenté comme récent → refusé", oldFactAsRecent(hook, [fact("2024-03-01")], undefined, now));
  check("fait de 2026 → accepté", !oldFactAsRecent(hook, [fact("2026-06-01")], undefined, now));
  check("sans « récent » → accepté", !oldFactAsRecent("Bonjour,\n\nEn mars 2024, une agence a ouvert.", [fact("2024-03-01")], undefined, now));

  check("« Vous recrutez… » en accroche refusé", opensOnJobOffer("Bonjour,\n\nVous recrutez un chauffeur-livreur en Occitanie.", sign));
  check("accroche métier acceptée", !opensOnJobOffer("Bonjour,\n\nAvec trois showrooms, chaque devis est relancé.", sign));

  console.log("\n7. Objet");
  check("objet de référence BRIOL", validateSubject("Demandes de devis chez Menuiserie Briol").length === 0);
  check("objet de référence BONNIN", validateSubject("Commandes des boutiques vers le laboratoire").length === 0);
  check("minuscule initiale refusée", validateSubject("demandes de devis").length > 0);
  check("forme juridique refusée", validateSubject("Devis chez SARL Bonnin").length > 0);

  console.log("\n8. Preuve : la table pain → preuve");
  const bonnin = chooseProof(offer, "regrouper les commandes des boutiques en fiches de production", { sector: "Boulangerie et boulangerie-pâtisserie" });
  check("boulangerie : jamais de démo", bonnin.demo === null && bonnin.proof === null, bonnin.reason);
  check("boulangerie : exemples du site", bonnin.sentence === GENERIC_PROOF_SENTENCE);
  const briol = chooseProof(offer, "qualifier les demandes de devis et proposer un créneau de métré");
  check("devis → agent devis", briol.proof?.id === "agent-devis", String(briol.proof?.id));
  const commande = chooseProof(offer, "préparer les commandes du jour", { sector: "Commerce de gros" });
  check("« commande » seul ne déclenche pas l'agent devis", commande.proof?.id !== "agent-devis", String(commande.proof?.id));
  const cr = chooseProof(offer, "rédiger les comptes rendus de visite");
  check("comptes rendus → démo n8n nommée", cr.demo?.key === "comptes-rendus", String(cr.demo?.key));

  // Éval du 28/09/2026 : trois démos hors sujet, déclenchées par un simple canal.
  const briolReel = chooseProof(offer, "rapprocher les bons de livraison reçus par e-mail des bonnes commandes");
  check("« par e-mail » ne déclenche pas le tri d'e-mails", briolReel.demo?.key !== "emails", String(briolReel.demo?.key));
  const estimation = chooseProof(offer, "préremplir une fiche d'estimation après la visite du bien");
  check("« visite » ne déclenche pas les comptes rendus", estimation.demo?.key !== "comptes-rendus", String(estimation.demo?.key));
  const sirh = chooseProof(offer, "préparer les pièces d'entrée des salariés reçues par e-mail", {
    sector: "Conseil pour les affaires et autres conseils de gestion",
  });
  check("cabinet de conseil : pas de démo tri d'e-mails", sirh.demo?.key !== "emails", String(sirh.demo?.key));
  check("trier les e-mails entrants → démo e-mails", chooseProof(offer, "trier les e-mails entrants du support").demo?.key === "emails");

  console.log("\n9. Créneau d'envoi conseillé");
  check("boulangerie → mardi 14h", suggestSendTime("Boulangerie et boulangerie-pâtisserie").label === "mardi 14h");
  check("restauration (NAF 56.10A) → mardi 14h", suggestSendTime(null, "56.10A").label === "mardi 14h");
  check("défaut → lundi ou mardi 9h", suggestSendTime("Menuiserie").label.includes("9h"));
  const next = suggestSendTime("Boulangerie", null, new Date(2026, 8, 27, 10)).next; // dimanche
  check("prochain mardi 14h", next.getDay() === 2 && next.getHours() === 14, next.toString());

  console.log("\n10. Un mail programmé n'est jamais réécrit par une génération");
  const db = new FakeDb({
    messages: [
      { id: "m-sched", user_id: "u", prospect_id: "p", type: "intro", status: "draft", send_status: "scheduled", deleted_at: null, created_at: "2026-09-27T20:00:00Z" },
      { id: "m-old", user_id: "u", prospect_id: "p", type: "intro", status: "draft", send_status: "draft", deleted_at: null, created_at: "2026-09-26T10:00:00Z" },
      { id: "m-trash", user_id: "u", prospect_id: "p", type: "intro", status: "draft", send_status: "draft", deleted_at: "2026-09-27T00:00:00Z", created_at: "2026-09-27T21:00:00Z" },
    ],
  });
  const ctx = { db: db as unknown as Db, userId: "u" };
  check("le brouillon libre le plus récent est repris", (await latestIntroDraft(ctx, "p")) === "m-old");
  db.tables.messages = db.tables.messages.filter((row) => row.id !== "m-old");
  check("seul un programmé reste → nouveau brouillon", (await latestIntroDraft(ctx, "p")) === null);

  console.log("\n11. Contrat contact-finder (module réel de main)");
  // Le stub qui vivait ici est remplacé par le vrai module (#37) : son
  // comportement complet est couvert par `npm run test:contact`. On ne garde
  // ici que ce dont la rédaction dépend — savoir tirer un domaine d'une URL.
  check("domaine nu", toDomain("https://www.menuiserie-briol.fr/contact") === "menuiserie-briol.fr");
  check("sans site, pas de domaine", toDomain(null) === null);
  check("adresse IP refusée", toDomain("http://192.168.1.10/") === null);

  console.log("\n12. Éval aveugle : position, verdict, rapport");
  check("position reproductible", generatedIsA("briol") === generatedIsA("briol"));
  const prompt = buildJudgePrompt({ subject: "A", body: "Bonjour," }, { subject: "B", body: "Bonjour," }, "BRIOL");
  check("le juge ne sait pas qui est la référence", !/main|reference|généré/i.test(prompt.user));
  const signed = { subject: "S", body: `Bonjour,\n\n${words(100)}\n\n${signature}` };
  const judged = buildJudgePrompt(signed, signed, "BRIOL", signature);
  check("le juge compte hors signature", judged.user.includes("(101 mots hors signature)"), judged.user.slice(0, 80));
  check("le juge ne voit pas la signature", !judged.user.includes(signature.split("\n")[1] ?? "§"));
  const report = renderReport(
    [{ id: "b", company: "B", generated: signed, reference: null, verdict: null, diagnostics: ["Profil métier : ABSENT"] }],
    { date: "d", judgeModel: "m", signature },
  );
  check("le rapport compte hors signature", report.includes("| 101 / –") && !report.includes("⚠️"), report.split("\n")[6]);
  check("le rapport montre le diagnostic", report.includes("- Profil métier : ABSENT"));
  const raw = JSON.stringify({ criteres: { accroche: "A", pain: "B" }, global: "égalité", raisons: "proches" });
  const verdict = parseVerdict(raw, true);
  check("égalité lue", verdict?.outcome === "egalite");
  check("critère gagné par le généré (A)", verdict?.criteria.accroche === "gagne" && verdict?.criteria.pain === "perd");
  check("critère absent → égalité", verdict?.criteria.ton === "egalite");
  check("A perd quand le généré est B", parseVerdict(JSON.stringify({ global: "A" }), false)?.outcome === "perd");
  check("JSON illisible → null", parseVerdict("oops", true) === null);
  const results = ["gagne", "egalite", "perd", "egalite"].map((outcome, index) => ({
    id: String(index), company: `C${index}`, generated: { subject: "S", body: "b" }, reference: null,
    verdict: { outcome: outcome as "gagne", criteria: parseVerdict('{"global":"A"}', true)!.criteria, reasons: "r" },
  }));
  check("3 sur 4 → objectif atteint", goalReached(results));
  check("rapport rendu", renderReport(results, { date: "2026-09-27", judgeModel: "gpt-6-sol" }).includes("atteint"));

  console.log(failures ? `\n${failures} test(s) en echec.` : "\nTous les tests passent.");
  process.exit(failures ? 1 : 0);
})();

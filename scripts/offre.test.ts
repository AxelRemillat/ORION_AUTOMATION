/**
 * Tests de « Mon offre » et de la rédaction qui en découle.
 *
 * Chaque bloc fige un défaut réellement parti en production : une accroche
 * générique au secteur, un Axel invisible, aucune offre concrète, une signature
 * réduite à « Axel », et 123 mots pour une limite de 120.
 *
 * Exécution : `npm run test:offre`.
 */
import {
  chooseProof,
  credibilityFits,
  entryOfferLabel,
  isOfferComplete,
  matchingDemo,
  promiseLines,
  signatureFor,
  OFFER_DEFAULTS,
  withDefaults,
  agentMetier,
  AGENT_METIER_SENTENCE,
  SIGNATURE_URL,
  CALENDAR_URL,
} from "../lib/offer/model";
import { SITE_OFFERS } from "../lib/offer/site-offers";
import { defaultOffer } from "../lib/offer/read";
import { commitmentsOf, offerNumbers, stripSignature } from "../app/api/emails/generate/pipeline";
import { bodyParagraphs, opensOnSector, validateEmail, withoutSignature, wordCount } from "../lib/emails/validate";
import { buildFacts } from "../lib/emails/derived-facts";
import type { Prospect } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const offer = defaultOffer();

console.log("\n1. Signature : plus jamais « Axel » seul");
{
  const signature = signatureFor(offer);
  check("le nom complet y est", signature.startsWith("Axel Remillat"));
  check("le titre y est", signature.includes("Automatisation & IA en production pour PME"));
  check("le portfolio y est", signature.includes("https://axelremillat.com"));
  check("le téléphone est masqué par défaut", !signature.includes("06") && !signature.includes("+33"));

  const avecTel = signatureFor({ ...offer, phone: "06 00 00 00 00", show_phone: true });
  check("le téléphone apparaît quand on l'active", avecTel.includes("06 00 00 00 00"));
  const sansTel = signatureFor({ ...offer, phone: "06 00 00 00 00", show_phone: false });
  check("renseigné mais désactivé : absent", !sansTel.includes("06 00 00 00 00"));
}

console.log("\n2. La signature ne compte pas dans les mots");
{
  const signature = signatureFor(offer);
  const corps = "Bonjour,\n\nUn mot.\n\nDeux mots.\n\nTrois ?";
  const complet = `${corps}\n\n${signature}`;
  check("elle est retirée avant comptage", withoutSignature(complet, signature).trim() === corps);
  check(
    "le compte ignore la signature",
    wordCount(withoutSignature(complet, signature)) === wordCount(corps),
    `${wordCount(withoutSignature(complet, signature))} vs ${wordCount(corps)}`,
  );
  check("sans signature fournie, rien n'est retiré", withoutSignature(corps, undefined) === corps);
}

console.log("\n3. Une signature écrite par le modèle est retirée");
{
  check("« Axel » seul part", stripSignature("Bonjour,\n\nUn mot.\n\nAxel") === "Bonjour,\n\nUn mot.");
  check("« Axel Remillat » part aussi", stripSignature("Un mot.\n\nAxel Remillat") === "Un mot.");
  check("« Cordialement » part", stripSignature("Un mot.\n\nCordialement,\nAxel") === "Un mot.");
  check("« Bonne journée » part", stripSignature("Un mot.\n\nBonne journée,\nAxel") === "Un mot.");
  check(
    "une vraie phrase finale reste",
    stripSignature("Un mot.\n\nEst-ce que ça vous parlerait ?") === "Un mot.\n\nEst-ce que ça vous parlerait ?",
  );
}

console.log("\n4. Accroche : ouvrir sur le secteur est refusé");
{
  // La phrase réellement partie en production.
  check(
    "« Dans le commerce de gros, … » refusé",
    opensOnSector("Bonjour,\n\nDans le commerce de gros, passer une commande mobilise plusieurs outils.\n\nX."),
  );
  check("« Dans la formation, … » refusé", opensOnSector("Bonjour,\n\nDans la formation, les inscriptions…\n\nX."));
  check(
    "un fait propre à l'entreprise passe",
    !opensOnSector("Bonjour,\n\nVous avez ouvert une agence à Lavelanet en mars.\n\nX."),
  );
  check(
    "une phrase qui contient « dans » ailleurs passe",
    !opensOnSector("Bonjour,\n\nVos annonces publiées dans la presse locale…\n\nX."),
  );
}

console.log("\n5. Tournures interdites");
{
  const facts = buildFacts({
    id: "p", user_id: "u", company_name: "TERDICI VEGETAL", siren: "320182702", website: null,
    email: null, sector: "Commerce de gros", size_range: "20 à 49 salariés", city: "Torcé",
    source: "auto", signals: [], key_figures: { headcount: 35 }, pain_point: null,
    status: "nouveau", created_at: "", updated_at: "",
  } as Prospect).facts;

  const signature = signatureFor(offer);
  const base = (phrase: string) =>
    validateEmail(
      {
        subject: "commandes et bons de livraison",
        body:
          `Bonjour,\n\nVous préparez des commandes chaque jour.\n\n${phrase}\n\n` +
          `Est-ce que ça vous parlerait ?\n\n${signature}`,
      },
      { facts, contact: null, tone: "direct", companyName: "TERDICI VEGETAL", signature },
    ).failures.join(" | ");

  check("« Mon métier, c'est de » refusé", base("Mon métier, c'est de brancher des flux.").includes("interdites"));
  check("« peut demander de » refusé", base("Cela peut demander de ressaisir chaque ligne.").includes("interdites"));
  check("« m'a intéressé » refusé", base("Votre catalogue m'a intéressé.").includes("interdites"));
  check("« dans votre secteur » refusé", base("Dans votre secteur, c'est fréquent.").includes("interdites"));
  check(
    "une phrase normale passe ce contrôle",
    !base("Je construis des flux qui lisent la commande et préremplissent le bon de livraison.").includes("interdites"),
  );
}

console.log("\n6. Preuve : recoupement, et démo nommée en priorité");
{
  // Le pain de TERDICI tombe sur les commandes → agent-devis.
  const devis = chooseProof(offer, "reporter les références d'une commande client et préparer le bon de livraison");
  check("commandes → agent-devis", devis.proof?.id === "agent-devis", String(devis.proof?.id));

  // Un pain de documents tombe sur une démo n8n NOMMÉE.
  const emails = chooseProof(offer, "trier les e-mails entrants et classer les pièces reçues");
  check("e-mails → démo n8n", emails.proof?.id === "n8n", String(emails.proof?.id));
  check("la démo est nommée", emails.sentence?.includes("le tri d'e-mails") === true, String(emails.sentence));
  check("le lien n'est pas dans la phrase", !(emails.sentence ?? "").includes("http"), String(emails.sentence));

  const factures = chooseProof(offer, "rapprocher les factures fournisseurs des bons de réception");
  check("factures → démo nommée", factures.sentence?.includes("le traitement des factures") === true, String(factures.sentence));

  // Aucun recoupement : pas de preuve nommée, les exemples du site — jamais une démo à côté.
  const rien = chooseProof(offer, "surveiller la température des chambres froides");
  check(
    "aucun recoupement → exemples du site, aucune démo",
    rien.proof === null && rien.demo === null && rien.sentence === "des exemples testables sur mon site",
    String(rien.sentence),
  );
  check("la raison est explicite", rien.reason.includes("aucune preuve"), rien.reason);

  // La crédibilité n'est jamais choisie à la place d'une preuve métier.
  check("ionis n'est jamais la preuve principale", devis.proof?.id !== "ionis" && emails.proof?.id !== "ionis");
  check("ionis tient à 100 mots", credibilityFits(offer, 100)?.id === "ionis");
  check("ionis ne tient plus à 115 mots", credibilityFits(offer, 115) === null);

  check("démo reconnue", matchingDemo("classer les comptes rendus de visite")?.key === "comptes-rendus");
  check("aucune démo sur un pain hors catalogue", matchingDemo("surveiller la pression des cuves") === null);
}

console.log("\n7. Offre d'entrée et promesse");
{
  check("libellé de la demande", entryOfferLabel(offer) === "une démo de 15 min", String(entryOfferLabel(offer)));
  check("appel découverte", entryOfferLabel({ ...offer, entry_type: "appel", entry_duration: "20 min" }) === "un appel découverte de 20 min");
  const promise = promiseLines(offer);
  check("le délai est promis", promise.some((line) => line.includes("2 à 3 semaines")));
  check("sans changer d'outil", promise.includes("sans changer d'outil"));
  check("validation humaine", promise.includes("validation humaine avant chaque action"));
  check(
    "une promesse décochée disparaît",
    !promiseLines({ ...offer, no_tool_change: false }).includes("sans changer d'outil"),
  );
}

console.log("\n8. Complétude de l'offre");
{
  check("le préremplissage est complet", isOfferComplete(offer));
  check("sans nom : incomplet", !isOfferComplete({ ...offer, full_name: null }));
  check("sans titre : incomplet", !isOfferComplete({ ...offer, title: null }));
  check("sans demande d'entrée : incomplet", !isOfferComplete({ ...offer, entry_pitch: null }));
  check("sans preuve publique : incomplet", !isOfferComplete({ ...offer, proofs: [] }));
  check(
    "des preuves toutes privées : incomplet",
    !isOfferComplete({ ...offer, proofs: offer.proofs.map((p) => ({ ...p, publicOk: false })) }),
  );
  check("null : incomplet", !isOfferComplete(null));

  // Une ligne partielle en base ne doit pas effacer les valeurs par défaut.
  const partial = withDefaults({ full_name: "Axel R.", phone: null }, "u1");
  check("la valeur fournie gagne", partial.full_name === "Axel R.");
  check("le reste vient du défaut", partial.title === offer.title);
  check("l'utilisateur est conservé", partial.user_id === "u1");
}

console.log("\n9. La signature de deux lignes n'est pas un paragraphe de corps");
{
  const signature = signatureFor(offer);
  const mail =
    "Bonjour,\n\nAccroche.\n\nQui je suis.\n\nCe que je propose.\n\n" +
    `Une question ?\n\n${signature}`;
  const blocks = bodyParagraphs(mail, signature);
  check("quatre blocs de corps", blocks.length === 4, `${blocks.length} : ${blocks.join(" | ")}`);
  check("la salutation est exclue", !blocks.some((b) => b.startsWith("Bonjour")));
  check("la signature est exclue", !blocks.some((b) => b.includes("axelremillat.com")));
  check(
    "sans signature fournie, elle compterait",
    bodyParagraphs(mail).length > 4,
    String(bodyParagraphs(mail).length),
  );
}

console.log("\n10. Les chiffres de l'offre sont autorisés dans le corps");
{
  const nums = offerNumbers(offer);
  check("le délai « 2 à 3 semaines » donne 2 et 3", nums.includes(2) && nums.includes(3), nums.join(","));
  check("la durée « 15 min » donne 15", nums.includes(15), nums.join(","));

  const facts = buildFacts({
    id: "p", user_id: "u", company_name: "X", siren: "1", website: null, email: null,
    sector: "Commerce", size_range: null, city: "Lyon", source: "auto", signals: [],
    key_figures: {}, pain_point: null, status: "nouveau", created_at: "", updated_at: "",
  } as Prospect).facts;
  const signature = signatureFor(offer);
  const result = validateEmail(
    {
      subject: "commandes et bons de livraison",
      body:
        "Bonjour,\n\nVous préparez des commandes chaque jour depuis votre catalogue.\n\n" +
        "Je suis Axel Remillat, j'automatise des tâches pour les PME.\n\n" +
        "La mise en place prend 2 à 3 semaines, sans changer d'outil, avec validation humaine.\n\n" +
        `Je peux vous montrer ça en 15 minutes : est-ce que ça vous parlerait ?\n\n${signature}`,
      },
    { facts, contact: null, tone: "direct", companyName: "X", signature, offerNumbers: nums },
  );
  check(
    "2, 3 et 15 ne sont plus « absents des faits »",
    !result.failures.some((f) => f.includes("Nombre absent")),
    result.failures.join(" | "),
  );
  check(
    "sans les chiffres de l'offre, ils seraient refusés",
    validateEmail(
      {
        subject: "commandes et bons de livraison",
        body:
          "Bonjour,\n\nVous préparez des commandes.\n\nJe suis Axel Remillat.\n\n" +
          `Comptez 2 à 3 semaines.\n\nEst-ce que ça vous parlerait ?\n\n${signature}`,
      },
      { facts, contact: null, tone: "direct", companyName: "X", signature },
    ).failures.some((f) => f.includes("Nombre absent")),
  );
}

console.log("\n11. Les engagements d'Axel sont transmis au juge");
{
  const commitments = commitmentsOf(offer);
  check("le délai y est", commitments.some((c) => c.includes("2 à 3 semaines")), commitments.join(" | "));
  check("sans changer d'outil y est", commitments.includes("sans changer d'outil"));
  check("la demande d'entrée y est", commitments.some((c) => c.includes("une démo de 15 min")));
  check(
    "une promesse décochée n'y est pas",
    !commitmentsOf({ ...offer, human_validation: false }).some((c) => c.includes("validation humaine")),
  );
}

console.log("\n12. La source légale ne se nomme jamais dans le mail");
{
  const facts = buildFacts({
    id: "p", user_id: "u", company_name: "DEVESA", siren: "1", website: null, email: null,
    sector: "Immobilier", size_range: null, city: "Lyon", source: "auto", signals: [],
    key_figures: {}, pain_point: null, status: "nouveau", created_at: "", updated_at: "",
  } as Prospect).facts;
  const signature = signatureFor(offer);
  const mail = (accroche: string) =>
    validateEmail(
      {
        subject: "dossiers et relances",
        body:
          `Bonjour,\n\n${accroche}\n\nJe suis Axel Remillat, je construis des flux.\n\n` +
          `Comptez 2 à 3 semaines, sans changer d'outil.\n\nEst-ce que ça vous parlerait ?\n\n${signature}`,
      },
      { facts, contact: null, tone: "direct", companyName: "DEVESA", signature, offerNumbers: offerNumbers(offer) },
    ).failures.join(" | ");

  check("« BODACC » refusé", mail("Le BODACC annonce un nouvel établissement.").includes("interdites"));
  check("« annonce légale » refusé", mail("Une annonce légale signale votre nouvelle agence.").includes("interdites"));
  check("« Journal officiel » refusé", mail("Le Journal officiel mentionne votre création.").includes("interdites"));
  check("« au registre » refusé", mail("Vous êtes représentée par J.DIS au registre.").includes("interdites"));
  // Cas reellement parti en production : la preposition changeait, pas le mot.
  check("« Le registre indique » refusé", mail("Le registre indique que J.DIS vous représente.").includes("interdites"));
  check(
    "le même fait, dit humainement, passe",
    !mail("Vous avez ouvert une agence à Lavelanet au printemps.").includes("interdites"),
  );
}

console.log("\n13. Un defaut comble une absence, jamais un vide choisi");
{
  // Le bug d'origine : la version precedente filtrait les `null` de la ligne
  // avant de les superposer aux defauts. Un titre efface revenait donc rempli
  // au rechargement suivant, et il etait impossible de vider un champ.
  const vide = withDefaults({ user_id: "u1", title: null, entry_duration: null }, "u1");
  check("un titre vide en base RESTE vide", vide.title === null, JSON.stringify(vide.title));
  check("une duree vide en base RESTE vide", vide.entry_duration === null);

  // Une cle absente, elle, est une absence : le defaut la comble.
  const partielle = withDefaults({ user_id: "u1", full_name: "Axel R." }, "u1");
  check("la valeur fournie gagne", partielle.full_name === "Axel R.");
  check("une cle absente prend le defaut", partielle.title === OFFER_DEFAULTS.title);

  // Aucune ligne : c'est le prereplissage, et lui seul.
  const aucune = withDefaults(null, "u1");
  check("sans ligne, tout vient du defaut", aucune.title === OFFER_DEFAULTS.title);
  check("et l'utilisateur est pose", aucune.user_id === "u1");

  // Une valeur enregistree ne doit JAMAIS etre remplacee par le defaut.
  const enregistree = withDefaults(
    { user_id: "u1", title: "Mise en production IA", phone: "06 12 34 56 78", show_phone: true },
    "u1",
  );
  check("le titre enregistre survit", enregistree.title === "Mise en production IA");
  check("le telephone enregistre survit", enregistree.phone === "06 12 34 56 78");
  check("le defaut ne ramene pas show_phone a false", enregistree.show_phone === true);

  // Un faux ne doit pas etre pris pour une absence.
  const faux = withDefaults({ user_id: "u1", no_tool_change: false, human_validation: false }, "u1");
  check("un booleen faux survit", faux.no_tool_change === false && faux.human_validation === false);

  // Une liste de preuves videe volontairement reste vide.
  const sansPreuve = withDefaults({ user_id: "u1", proofs: [] }, "u1");
  check("des preuves videes restent vides", sansPreuve.proofs.length === 0);
}

console.log("\n14. Ce que la page charge peut toujours etre reenregistre");
{
  // L'aller-retour doit tenir : sinon l'ecran affiche une offre qu'il est
  // incapable de sauvegarder, et l'echec n'arrive qu'au clic.
  const charge = withDefaults({ user_id: "u1", ...OFFER_DEFAULTS }, "u1");
  const renvoye = withDefaults(charge, "u1");
  check("l'offre est stable apres un aller-retour", JSON.stringify(renvoye) === JSON.stringify(charge));

  // Et une edition ordinaire ne casse rien.
  const edite = withDefaults({ ...charge, title: "Nouveau titre", phone: "06 00 00 00 00" }, "u1");
  check("le nouveau titre est conserve", edite.title === "Nouveau titre");
  check("le nouveau telephone est conserve", edite.phone === "06 00 00 00 00");
  check("les preuves survivent", edite.proofs.length === charge.proofs.length);
}

console.log("\n15. Aligné sur le site refondu pour les PME");
{
  // Mêmes intitulés et prix que PORTFOLIO_V2/components/offres/offres-data.ts.
  check(
    "4 offres, intitulés du site",
    SITE_OFFERS.map((o) => o.name).join(" | ") ===
      "Audit automatisation | Automatisation clé en main | Suivi & évolutions | Mise en production IA",
  );
  check(
    "prix « à partir de » du site",
    SITE_OFFERS.map((o) => o.price).join(" | ") ===
      "À partir de 290 € | À partir de 1 200 € | À partir de 190 €/mois | À partir de 1 900 €",
  );

  // Signature : la page prospects, lien court sans paramètres.
  check("lien de signature → /pme", signatureFor(offer).includes(SIGNATURE_URL), signatureFor(offer));
  check("sans paramètres UTM", SIGNATURE_URL === "https://axelremillat.com/pme" && !signatureFor(offer).includes("utm_"));

  // Démo de 15 min : le lien Google Agenda du site (plus Cal.eu, plus /contact).
  check("démo 15 min → Google Agenda", offer.entry_url === CALENDAR_URL && CALENDAR_URL === "https://calendar.app.google/dwAR7ea7tgAehwv48");

  // Preuves : URLs et descriptions du site.
  const byId = (id: string) => offer.proofs.find((proof) => proof.id === id);
  check(
    "agent devis → /agent, 5 métiers",
    byId("agent-devis")?.url === "https://axelremillat.com/agent" && /5 métiers/.test(byId("agent-devis")?.sentence ?? ""),
  );
  check(
    "automatisations → /automatisations, fichiers clients",
    byId("n8n")?.url === "https://axelremillat.com/automatisations" && /fichiers clients/.test(byId("n8n")?.sentence ?? ""),
  );

  // Les 5 métiers de l'agent, reconnus au secteur (libellé ou NAF).
  const cas: [string, string | null][] = [
    ["Travaux de menuiserie bois et PVC", "menuiserie"],
    ["43.32A", "menuiserie"],
    ["Boulangerie et boulangerie-pâtisserie", "boulangerie"],
    ["Services des traiteurs", "boulangerie"],
    ["Commerce de gros de matériaux", "negoce"],
    ["Travaux de peinture et vitrerie", "btp"],
    ["Travaux de maçonnerie générale et gros œuvre de bâtiment", "btp"],
    ["Nettoyage courant des bâtiments", "services"],
    ["Conseil en systèmes et logiciels informatiques", null],
    ["Agences immobilières", null],
    [" ", null],
  ];
  for (const [secteur, attendu] of cas) {
    const trouve = agentMetier(secteur)?.id ?? null;
    check(`métier « ${secteur.trim() || "(vide)"} » → ${attendu ?? "aucun"}`, trouve === attendu, String(trouve));
  }

  const menuisier = chooseProof(offer, "chiffrer les demandes de devis de fenêtres", {
    sector: "Travaux de menuiserie bois et PVC",
  });
  check(
    "menuisier + devis → agent, exemple de son métier",
    menuisier.proof?.id === "agent-devis" && menuisier.sentence === AGENT_METIER_SENTENCE,
    String(menuisier.sentence),
  );
  check("… et la démo est nommée (métier)", /menuiserie/.test(menuisier.demo?.label ?? ""), String(menuisier.demo?.label));
  const agence = chooseProof(offer, "produire un devis à partir d'une demande client", { sector: "Agences immobilières" });
  check(
    "hors des 5 métiers : phrase générale de l'agent",
    agence.proof?.id === "agent-devis" && agence.sentence === byId("agent-devis")?.sentence,
    String(agence.sentence),
  );
  const fournil = chooseProof(offer, "regrouper les commandes des boutiques en fiches de production", {
    sector: "Boulangerie et boulangerie-pâtisserie",
  });
  check("boulangerie SANS devis : toujours les exemples du site", fournil.proof === null, String(fournil.proof?.id));
}

console.log("\n16. ARTFLEX : négoce B2B et synonymes de la demande client");
{
  // Cas réel du 30/09/2026 (520644386) : pain et secteur tels qu'en base.
  const artflex = chooseProof(
    offer,
    "Vérifier les références et les quantités demandées, puis préparer la confirmation de commande et du délai.",
    { sector: "Commerce de gros (commerce interentreprises) de fournitures pour la plomberie et le chauffage" },
  );
  check("ARTFLEX → agent devis, exemple de son métier", artflex.proof?.id === "agent-devis" && artflex.sentence === AGENT_METIER_SENTENCE, String(artflex.sentence));
  check("ARTFLEX → démo nommée « négoce B2B »", /négoce B2B/.test(artflex.demo?.label ?? ""), String(artflex.demo?.label));
  for (const pain of ["traiter les demandes de prix reçues par e-mail", "chiffrer les demandes des installateurs", "envoyer les confirmations de commande", "répondre aux demandes de cotation"]) {
    check(`« ${pain} » → agent devis`, chooseProof(offer, pain).proof?.id === "agent-devis", String(chooseProof(offer, pain).proof?.id));
  }
  const grossiste = { sector: "Commerce de gros de matériaux" };
  check("négoce : « saisir les commandes des clients » → agent devis", chooseProof(offer, "saisir les commandes reçues des installateurs", grossiste).proof?.id === "agent-devis");
  check("négoce : préparer les commandes du jour (picking) → pas l'agent", chooseProof(offer, "préparer les commandes du jour", grossiste).proof?.id !== "agent-devis");
  // Pain choisi par le stratège pendant l'eval du 30/09 : le stock y est consulté pour une commande CLIENT.
  const stocks = chooseProof(
    offer,
    "vérifier la disponibilité des articles dans les deux stocks avant de confirmer la commande ou la livraison",
    { sector: "Commerce de gros (commerce interentreprises) de fournitures pour la plomberie et le chauffage" },
  );
  check("négoce : stock vérifié avant confirmation → agent devis négoce", stocks.proof?.id === "agent-devis" && /négoce B2B/.test(stocks.demo?.label ?? ""), `${stocks.proof?.id} ${stocks.reason}`);
  check(
    "négoce : réassort et commande fournisseur → jamais l'agent",
    chooseProof(offer, "transmettre les besoins de réassort et suivre leur passage en commande fournisseur", grossiste).proof?.id !== "agent-devis",
  );
  check("hors négoce : « commande » seule → pas l'agent", chooseProof(offer, "regrouper les commandes des boutiques").proof?.id !== "agent-devis");
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

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
  withDefaults,
} from "../lib/offer/model";
import { defaultOffer } from "../lib/offer/read";
import { stripSignature } from "../app/api/emails/generate/pipeline";
import { opensOnSector, validateEmail, withoutSignature, wordCount } from "../lib/emails/validate";
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

  // Aucun recoupement : pas de preuve, plutôt qu'une preuve à côté.
  const rien = chooseProof(offer, "surveiller la température des chambres froides");
  check("aucun recoupement → aucune preuve", rien.proof === null && rien.sentence === null);
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

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

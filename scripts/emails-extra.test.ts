/**
 * Tests des corrections de fond sur la génération d'emails.
 *
 * Chaque bloc correspond à une erreur réellement partie en production : un
 * chiffre lu sur un site et recraché tel quel, une expérience que personne n'a
 * vécue, un libellé NAF de section pour un emboutisseur. Les fixer en test est
 * le seul moyen de garantir qu'elles ne reviennent pas.
 *
 * Exécution : `npm run test:emails-extra`.
 */
import {
  buildFacts,
  cleanExcerpt,
  duplicatesRegistry,
  knownNumbers,
  revenuePerHeadReading,
  roundedEuros,
} from "../lib/emails/derived-facts";
import { hedgesUsed, planApplied, unprovenExperience, validateEmail } from "../lib/emails/validate";
import { describesNeed, needConfidence } from "../lib/emails/need-lead";
import { buildGreeting, emailBelongsTo } from "../app/api/emails/generate/prompt";
import { dedupeFacts } from "../app/(app)/prospection/_components/facts-grid";
import { isOpaqueNaf, nafLabel } from "../lib/naf";
import { stripUnknownNumbers } from "../lib/emails/derived-facts";
import { PERSONA } from "../lib/persona";
import type { Prospect } from "../types";

const PROOFS = PERSONA.proofs.filter((proof) => proof.publicOk).map((proof) => proof.text);

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  id: "p1", user_id: "u", company_name: "RAS INTERIM", siren: "999999999", website: null,
  email: null, sector: "Activités des agences de travail temporaire", size_range: "20 à 49 salariés",
  city: "Lyon", source: "auto", signals: [], key_figures: {}, pain_point: null, status: "nouveau",
  created_at: "", updated_at: "", ...over,
});

console.log("\n1. Nombres : l'exact au centime est refusé, l'arrondi passe");
{
  const facts = buildFacts(prospect({ key_figures: { revenue_eur: 40_878_286 } })).facts;
  const known = knownNumbers(facts);
  check("montant exact NON autorisé dans le corps", !known.has(40878286));
  check("arrondi au million autorisé", known.has(41));
  check("un nombre absent reste absent", !known.has(777));
  check("format d'écriture arrondi", roundedEuros(40_878_286) === "~41 M€", roundedEuros(40_878_286));
}

console.log("\n2. Le « 268 » lu sur le site aurait dû être bloqué");
{
  // Cas réel : le mail Blue EnerFreeze citait « 268 points de livraison ».
  // Ce chiffre vient du SITE, pas d'un fait. Le validateur l'acceptait parce
  // qu'on avait ajouté les nombres du site aux nombres connus — la faille.
  const facts = buildFacts(
    prospect({ company_name: "BLUE ENERFREEZE", key_figures: { naf_code: "35.30Z", revenue_eur: 50_290_772 } }),
    null,
    new Date(),
    "268 points de livraison servis chaque jour, 344 GWh de consommation annuelle",
  ).facts;

  const result = validateEmail(
    {
      subject: "alertes et interventions",
      body:
        "Bonjour,\n\nFace à 268 points de livraison, la planification doit être complexe.\n\n" +
        "Je construis des flux qui relient les alertes à la commande de pièces.\n\n" +
        "C'est encore manuel chez vous ?\n\nAxel",
    },
    { facts, contact: null, tone: "direct", companyName: "Blue EnerFreeze", proofs: PROOFS },
  );
  check("268 est rejeté", result.failures.some((f) => f.includes("268")), result.failures.join(" / "));
}

console.log("\n3. Aucune expérience inventée");
{
  const facts = buildFacts(prospect()).facts;
  const context = { facts, contact: null, tone: "direct" as const, companyName: "RAS", proofs: PROOFS };

  const invented = validateEmail(
    {
      subject: "contrats de mission",
      body:
        "Bonjour,\n\nVotre volume de missions est important.\n\n" +
        "Pour des entreprises similaires, j'ai mis en place des outils de planification automatisée.\n\n" +
        "C'est un sujet chez vous ?\n\nAxel",
    },
    context,
  );
  check(
    "une expérience sans preuve est rejetée",
    invented.failures.some((f) => f.includes("Expérience non prouvée")),
    invented.failures.join(" / "),
  );

  const present = validateEmail(
    {
      subject: "contrats de mission",
      body:
        "Bonjour,\n\nVotre volume de missions est important.\n\n" +
        "Je construis des chaînes qui lisent les documents entrants et pré-remplissent les pièces à produire.\n\n" +
        "C'est un sujet chez vous ?\n\nAxel",
    },
    context,
  );
  check(
    "le présent sur son savoir-faire passe",
    !present.failures.some((f) => f.includes("Expérience")),
    present.failures.join(" / "),
  );

  check("marqueur détecté", unprovenExperience("J'accompagne des clients du BTP.", PROOFS).length === 1);
  check("aucun marqueur, aucun échec", unprovenExperience("Je construis des automatisations.", PROOFS).length === 0);
}

console.log("\n4. Offre : un flux, pas un produit à installer");
{
  const facts = buildFacts(prospect()).facts;
  const result = validateEmail(
    {
      subject: "contrats de mission",
      body:
        "Bonjour,\n\nVotre volume est important.\n\nJe peux vous proposer un logiciel de gestion intégré.\n\n" +
        "C'est un sujet ?\n\nAxel",
    },
    { facts, contact: null, tone: "direct", companyName: "RAS", proofs: PROOFS },
  );
  check("« logiciel » est rejeté", result.failures.some((f) => f.includes("logiciel")), result.failures.join(" / "));
}

console.log("\n5. NAF : libellé de sous-classe, pas de section");
{
  check("25.50B", nafLabel("25.50B", "Industrie manufacturière")?.label === "Découpage, emboutissage");
  check("précision annoncée", nafLabel("25.50B")?.precision === "sous-classe");
  check("repli division", nafLabel("28.99Z")?.precision === "division");
  check("holding opaque", isOpaqueNaf("70.10Z") && !isOpaqueNaf("35.30Z"));
}

console.log("\n6. Métier déduit hors NAF pour un siège social");
{
  const result = buildFacts(
    prospect({
      company_name: "RAS INTERIM JERECRUTE",
      sector: "Activités des sièges sociaux",
      key_figures: { naf_code: "70.10Z" },
    }),
  );
  check("famille = intérim", result.familyKey === "interim_rh", result.familyLabel);
  check("le fait le dit explicitement", result.facts.some((fact) => fact.label === "Métier réel"));
}

console.log("\n7. CA/salarié : lecture par famille, jamais « énergie » ailleurs");
{
  check("intérim", revenuePerHeadReading(900_000, "interim_rh").includes("intérimaires"));
  check("négoce", revenuePerHeadReading(900_000, "commerce").includes("négoce"));
  check(
    "pas d'énergie hors énergie",
    !revenuePerHeadReading(900_000, "interim_rh").includes("énergie") &&
      !revenuePerHeadReading(900_000, "industrie").includes("énergie"),
  );
  check("famille inconnue : constat neutre", revenuePerHeadReading(900_000, "inconnu").includes("volume"));
}

console.log("\n8. Signaux : doublons de registre et markdown");
{
  check(
    "un signal qui répète le registre est écarté",
    duplicatesRegistry("Créée le 1 janvier 1969, immatriculée au RCS de Lyon, capital social 40 000 euros"),
  );
  check("une offre d'emploi est conservée", !duplicatesRegistry("RAS recrute un automaticien en CDI"));
  check(
    "markdown et emojis nettoyés",
    cleanExcerpt("- [Voir l'offre](https://x.fr) 🔥 **Automaticien** H/F") === "Voir l'offre Automaticien H/F",
    cleanExcerpt("- [Voir l'offre](https://x.fr) 🔥 **Automaticien** H/F"),
  );
}

console.log("\n9. Priorisation : un recrutement récent passe devant les finances");
{
  const result = buildFacts(
    prospect({
      company_name: "BLUE ENERFREEZE",
      key_figures: { naf_code: "35.30Z", revenue_eur: 50_290_772, parent_company: "SOCIETE IMMOSTEF" },
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote: "Blue EnerFreeze recrute un automaticien H/F en CDI",
          url: "https://emploi.fr/offre",
          date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.9,
        },
      ],
    }),
  );
  const first = result.facts[0];
  check("le recrutement est en tête", first?.hookTier === 1, `${first?.label} (rang ${first?.hookTier})`);
  check("la société mère est détectée", result.parent === "SOCIETE IMMOSTEF");
  check(
    "le groupe passe avant les finances",
    (result.facts.find((f) => f.label === "Société mère")?.hookTier ?? 9) <
      (result.facts.find((f) => f.label === "Chiffre d'affaires")?.hookTier ?? 0),
  );
}

console.log("\n10. Rédaction : présentation, nuances, plan");
{
  const facts = buildFacts(prospect()).facts;
  const context = { facts, contact: null, tone: "direct" as const, companyName: "RAS", proofs: PROOFS };

  const titled = validateEmail(
    {
      subject: "contrats de mission",
      body:
        "Bonjour,\n\nVotre volume de missions est important.\n\n" +
        "Je suis Axel Remillat, ingénieur freelance en IA, et je construis des flux.\n\n" +
        "C'est un sujet ?\n\nAxel",
    },
    context,
  );
  check(
    "« je suis ... ingénieur » est rejeté",
    titled.failures.some((line) => line.includes("ingenieur")),
    titled.failures.join(" / "),
  );

  check("une seule nuance passe", hedgesUsed("J'imagine que la saisie est manuelle.").length === 1);
  check(
    "deux nuances sont comptées",
    hedgesUsed("J'imagine que c'est manuel, et sans doute encore sur tableur.").length === 2,
  );

  const hedged = validateEmail(
    {
      subject: "contrats de mission",
      body:
        "Bonjour,\n\nJ'imagine que le volume de missions est important.\n\n" +
        "Sans doute que la saisie reste manuelle, et je construis des flux qui la reprennent.\n\n" +
        "C'est un sujet ?\n\nAxel",
    },
    context,
  );
  check(
    "deux nuances dans un mail sont rejetées",
    hedged.failures.some((line) => line.includes("hypothèse")),
    hedged.failures.join(" / "),
  );

  const question = "Bonjour,\n\nCombien de contrats par mois ?\n\nAxel";
  const statement = "Bonjour,\n\nVotre volume est important.\n\nAxel";
  check("plan B veut une question en ouverture", planApplied("B", question));
  check("plan B refuse un constat", !planApplied("B", statement));
  check("plan A refuse une question", !planApplied("A", question));
  check("sans plan imposé, rien n'est vérifié", planApplied(undefined, "n'importe quoi"));
}

console.log("\n11. Salutation : le dirigeant du registre quand l'adresse est la sienne");
{
  const contact = {
    email: "b.dumont@blue-enerfreeze.com",
    full_name: "Benjamin Dumont",
    position: "Directeur",
    confidence: 99,
  };
  check("l'adresse porte le nom du dirigeant", emailBelongsTo(contact.email, "Benjamin Dumont"));
  check("une adresse générique ne compte pas", !emailBelongsTo("contact@blue-enerfreeze.com", "Benjamin Dumont"));
  // Regle revue : « Monsieur + nom » est reserve au registre FACTUEL. En
  // Direct, Chaleureux et Bref, on appelle les gens par leur prenom.
  check(
    "Direct : prénom, même avec un dirigeant connu",
    buildGreeting("direct", contact, "Benjamin Dumont") === "Bonjour Benjamin,",
    buildGreeting("direct", contact, "Benjamin Dumont"),
  );
  check(
    "Factuel : Monsieur + nom",
    buildGreeting("factuel", contact, "Benjamin Dumont") === "Bonjour Monsieur Dumont,",
    buildGreeting("factuel", contact, "Benjamin Dumont"),
  );
  check(
    "sans correspondance, on retombe sur le prénom",
    buildGreeting("direct", { ...contact, email: "contact@blue-enerfreeze.com" }, "Benjamin Dumont") ===
      "Bonjour Benjamin,",
  );
  check("aucun contact : salutation neutre", buildGreeting("direct", null, null) === "Bonjour,");
}

console.log("\n12. Affichage : un fait déjà dit n'est pas répété");
{
  const rows = dedupeFacts([
    { label: "Ancienneté", value: "créée en 1969, 57 ans d'activité", source: "Registre" },
    { label: "Signal web", value: "créée en 1969", source: "Signal web" },
    { label: "Effectif", value: "20 à 49 salariés", source: "Registre" },
  ]);
  check("le doublon disparaît", rows.length === 2, rows.map((row) => row.label).join(" / "));
  check("le fait calculé est conservé", rows[0]?.label === "Ancienneté");
}

console.log("\n13. Indice de besoin : la confiance se calcule");
{
  const nothing = needConfidence({ facts: [], hasSiteContent: false, vocabularyConfirmed: false });
  check("socle seul = 0,4", nothing.value === 0.4, String(nothing.value));

  // Regle revue : sans signal direct, on plafonne a 0,6. Le site dit ce que
  // l'entreprise veut montrer, pas ce qu'elle vit — annoncer 70 % sur cette
  // seule base donnait a une lecture de plaquette l'allure d'une mesure.
  const withSite = needConfidence({ facts: [], hasSiteContent: true, vocabularyConfirmed: true });
  check("site + vocabulaire, sans signal : plafonné à 0,6", withSite.value === 0.6, String(withSite.value));

  const signalFacts = buildFacts(
    prospect({
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote: "RAS INTERIM recrute un automaticien H/F",
          url: "https://emploi.fr/o",
          date: new Date().toISOString().slice(0, 10),
          confidence: 0.9,
        },
      ],
    }),
  ).facts;
  const full = needConfidence({ facts: signalFacts, hasSiteContent: true, vocabularyConfirmed: true });
  check("avec un signal direct = 0,9", full.value === 0.9, String(full.value));
  check("le détail tient en quatre lignes", full.explanation.split("\n").length === 4);
  check("« forte rentabilité » n'est pas un besoin", !describesNeed("Forte rentabilité et gestion efficace"));
  check("un volume en est un", describesNeed("Beaucoup de contrats de mission à ressaisir"));
}

console.log("\n14. L'analyse ne transmet pas les chiffres du site");
{
  const facts = buildFacts(prospect({ key_figures: { revenue_eur: 40_878_286 } })).facts;
  const allowed = knownNumbers(facts);

  check(
    "« 80 000 intérimaires » perd son chiffre",
    stripUnknownNumbers("gérer vos 80 000 intérimaires", allowed) === "gérer vos intérimaires",
    stripUnknownNumbers("gérer vos 80 000 intérimaires", allowed),
  );
  check(
    "« 268 points de livraison » aussi",
    stripUnknownNumbers("268 points de livraison par jour", allowed) === "points de livraison par jour",
    stripUnknownNumbers("268 points de livraison par jour", allowed),
  );
  check(
    "un arrondi issu des faits survit",
    stripUnknownNumbers("environ 41 M€ de chiffre d'affaires", allowed).includes("41"),
    stripUnknownNumbers("environ 41 M€ de chiffre d'affaires", allowed),
  );
  check(
    "un texte sans chiffre est inchangé",
    stripUnknownNumbers("beaucoup de contrats de mission", allowed) === "beaucoup de contrats de mission",
  );
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

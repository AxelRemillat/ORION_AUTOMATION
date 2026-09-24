/**
 * Tests des garde-fous de génération d'emails.
 *
 * Deux modules purs, deux risques distincts : un CA par salarié faux envoie le
 * modèle sur une mauvaise piste, et un validateur trop laxiste laisse partir un
 * mail qui promet « une maintenance sans interruption ». Les deux se testent
 * sans réseau.
 *
 * Exécution : `npm run test:emails`.
 */
import { buildFacts, headcountMidpoint, knownNumbers, revenuePerHeadReading } from "../lib/emails/derived-facts";
import { greetingName, validateEmail, validateSubject } from "../lib/emails/validate";
import type { DecisionMakerContact } from "../lib/enrichment/types";
import type { Prospect } from "../types";

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

const CONTACT: DecisionMakerContact = {
  email: "b.dumont@blue.fr", full_name: "Benjamin Dumont", position: "Managing Director", confidence: 99,
};

console.log("\n1. Tranches d'effectif");
{
  // (20 + 49) / 2 = 34,5 : arrondi au superieur, comme toute demi-valeur ici.
  check("« 20 à 49 salariés » -> 35", headcountMidpoint("20 à 49 salariés") === 35);
  check("« 1 à 2 salariés » -> 2", headcountMidpoint("1 à 2 salariés") === 2);
  check("« 200 à 249 salariés » -> 225", headcountMidpoint("200 à 249 salariés") === 225);
  check("tranche ouverte -> borne basse", headcountMidpoint("10 000 salariés et plus") === 10000);
  check("libellé vide -> null", headcountMidpoint(null) === null);
  check("texte sans nombre -> null", headcountMidpoint("non renseigné") === null);
}

console.log("\n2. CA par salarié");
{
  const facts = buildFacts(
    prospect({ key_figures: { naf_code: "78.20Z", revenue_eur: 40_878_286, revenue_year: 2024 } }),
    null,
    new Date("2026-09-24"),
  ).facts;
  const perHead = facts.find((fact) => fact.label === "CA par salarié");

  // 40 878 286 / 35 = 1 167 951
  check("le ratio est calculé", Boolean(perHead), JSON.stringify(facts.map((f) => f.label)));
  // Intl.NumberFormat("fr-FR") separe les milliers par une espace fine
  // insecable (U+202F) : on compare sans aucune espace.
  const digits = (perHead?.value ?? "").replace(/[\s  ]/g, "");
  check("valeur attendue (~1,17 M)", digits.includes("1167951"), perHead?.value);
  check("source « calculé »", perHead?.source === "calculé");
  check("lecture qualitative jointe", Boolean(perHead?.value.includes("intérimaires")), perHead?.value);
  check(
    "seuils de lecture",
    revenuePerHeadReading(900_000, "interim_rh").includes("intérimaires") &&
      revenuePerHeadReading(900_000, "commerce").includes("négoce") &&
      !revenuePerHeadReading(900_000, "interim_rh").includes("énergie") &&
      revenuePerHeadReading(50_000, "industrie").includes("modéré"),
  );
}

console.log("\n3. Étiquetage des sources");
{
  const facts = buildFacts(
    prospect({ website: "https://ras.fr", key_figures: { founded_year: 1969, revenue_eur: 1_000_000 } }),
  ).facts;
  const age = facts.find((fact) => fact.label === "Ancienneté");
  const revenue = facts.find((fact) => fact.label === "Chiffre d'affaires");
  const site = facts.find((fact) => fact.label === "Site officiel");

  check("ancienneté -> Annuaire Entreprises", age?.source === "Annuaire Entreprises", age?.source);
  check("CA -> Pappers", revenue?.source === "Pappers", revenue?.source);
  check("site -> Site officiel", site?.source === "Site officiel");
  check("ids stables et ordonnés", facts.every((fact, index) => fact.id === `f${index + 1}`));
}

console.log("\n4. Contact nominatif");
{
  const facts = buildFacts(prospect(), CONTACT).facts;
  check("le contact devient un fait", facts.some((fact) => fact.label === "Contact identifié"));
  check("prénom exploitable à 99 %", greetingName(CONTACT) === "Benjamin");
  check(
    "confiance faible -> pas de prénom",
    greetingName({ ...CONTACT, confidence: 40 }) === null,
  );
}

console.log("\n5. Validateur — formules bannies et promesses intenables");
{
  const facts = buildFacts(prospect()).facts;
  const context = { facts, contact: null, tone: "direct" as const, companyName: "RAS INTERIM" };
  const body = "Bonjour,\n\nJ'ai été impressionné par votre engagement envers vos clients.\n\nCela garantirait une maintenance sans interruption.\n\nAxel";
  const result = validateEmail({ subject: "contrats de mission", body }, context);

  check("le mail est rejeté", !result.ok);
  check(
    "les trois formules sont citées",
    result.failures.some((f) => f.includes("impressionne") && f.includes("garantirait") && f.includes("sans interruption")),
    result.failures.join(" / "),
  );
}

console.log("\n6. Validateur — nombres inventés");
{
  const facts = buildFacts(
    prospect({ key_figures: { revenue_eur: 40_878_286, revenue_year: 2024 } }),
  ).facts;
  const context = { facts, contact: null, tone: "direct" as const, companyName: "RAS INTERIM" };

  check(
    "un arrondi du CA passe",
    !validateEmail(
      { subject: "contrats de mission", body: "Bonjour,\n\n41 M de chiffre d'affaires, c'est beaucoup de contrats à produire chaque mois pour une équipe de cette taille.\n\nJe construis des automatisations qui lisent les documents entrants et pré-remplissent les pièces.\n\nC'est un sujet chez vous ?\n\nAxel" },
      context,
    ).failures.some((f) => f.includes("Nombre absent")),
  );

  const invented = validateEmail(
    { subject: "contrats de mission", body: "Bonjour,\n\nVous perdez 300 heures par an sur la saisie.\n\nJe construis des automatisations pour ça.\n\nC'est un sujet chez vous ?\n\nAxel" },
    context,
  );
  check("un chiffre inventé est rejeté", invented.failures.some((f) => f.includes("Nombre absent")), invented.failures.join(" / "));
  check("le nombre fautif est nommé", invented.failures.some((f) => f.includes("300")));
}

console.log("\n7. Validateur — salutation");
{
  const facts = buildFacts(prospect(), CONTACT).facts;
  const context = { facts, contact: CONTACT, tone: "direct" as const, companyName: "BLUE" };
  const impersonal = "Bonjour,\n\nVotre modèle vend de l'énergie plutôt que des machines.\n\nJe construis des automatisations qui relient les alertes à la commande de pièces.\n\nC'est encore manuel chez vous ?\n\nAxel";
  const named = impersonal.replace("Bonjour,", "Bonjour Benjamin,");

  check(
    "salutation impersonnelle rejetée",
    validateEmail({ subject: "alertes et pièces", body: impersonal }, context).failures.some((f) =>
      f.includes("salutation impersonnelle"),
    ),
  );
  check(
    "salutation nominative acceptée",
    !validateEmail({ subject: "alertes et pièces", body: named }, context).failures.some((f) =>
      f.includes("salutation impersonnelle"),
    ),
  );
}

console.log("\n8. Validateur — objet");
{
  check("objet conforme", validateSubject("contrats de mission et relevés d'heures", "RAS").length === 0);
  check(
    "« Automatisation de… » rejeté",
    validateSubject("Automatisation de vos processus", "RAS").some((f) => f.includes("Automatisation")),
  );
  check(
    "« chez <société> » rejeté",
    validateSubject("tri des candidatures chez RAS", "RAS").some((f) => f.includes("chez")),
  );
  check("un seul mot rejeté", validateSubject("automatisation", "RAS").some((f) => f.includes("mot")));
  check("capitales rejetées", validateSubject("URGENT contrats de mission", "RAS").some((f) => f.includes("capitales")));
  check("point d'exclamation rejeté", validateSubject("contrats de mission !", "RAS").some((f) => f.includes("exclamation")));
}

// Les nombres, l'experience et le NAF sont couverts par emails-extra.test.ts.

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

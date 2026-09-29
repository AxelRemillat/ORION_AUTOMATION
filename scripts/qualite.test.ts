/**
 * Tests des correctifs de qualité : effectif, signaux, scoring.
 *
 * Chaque bloc fige un défaut réellement parti en production. Les valeurs
 * Pappers utilisées ici sont celles que l'API a vraiment renvoyées le
 * 25 septembre 2026 — relevées par `npx tsx scripts/debug-qualite.ts pappers`.
 *
 * Exécution : `npm run test:qualite`.
 */
import {
  bracketOfTranches,
  checkBracket,
  readPappersHeadcount,
} from "../lib/enrichment/headcount";
import {
  classifyJobSource,
  jobTitleIn,
  listsOffersWithoutTitle,
} from "../lib/enrichment/job-source";
import { isRegistryHost, structuralSignals } from "../lib/enrichment/signals";
import { looksLikeSubsidiaryByFigures } from "../lib/enrichment/group";
import { buildGreeting, splitPerson } from "../app/api/emails/generate/prompt";
import { paraphrasesSlogan, proofMatchesPain, restatesTheOffer } from "../lib/emails/strategist";
import { echoesSlogan, questionsIn } from "../lib/emails/validate";
import { heatScore } from "../lib/scoring";
import { buildFacts } from "../lib/emails/derived-facts";
import type { ProspectSignal, Prospect } from "../types";
import type { CompanyBase } from "../lib/enrichment/types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n1. Effectif Pappers : la borne haute n'est pas un effectif");
{
  // ANDRA LEARNING, tel que Pappers le renvoie : « Au moins 1 salarié ».
  const andra = readPappersHeadcount({ financeHeadcount: null, min: 1, max: 500_000 });
  check("500000 n'est jamais retenu", andra.value !== 500_000, String(andra.value));
  check("la borne basse fait foi", andra.value === 1, String(andra.value));

  // SEMAPHORES : fourchette fermée 50-99.
  const semaphores = readPappersHeadcount({ financeHeadcount: null, min: 50, max: 99 });
  check("fourchette fermée → milieu", semaphores.value === 75, String(semaphores.value));
  check("base annoncée", semaphores.basis === "fourchette", semaphores.basis);

  // Un effectif de bilan prime, quand il est plausible.
  const bilan = readPappersHeadcount({ financeHeadcount: 42, min: 20, max: 49 });
  check("le bilan prime", bilan.value === 42 && bilan.basis === "bilan", String(bilan.value));

  // Une masse salariale en euros ne passe pas pour un effectif.
  const absurde = readPappersHeadcount({ financeHeadcount: 1_250_000, min: 3, max: 5 });
  check("une valeur absurde est écartée", absurde.value === 4, String(absurde.value));

  check("aucune donnée → null", readPappersHeadcount({}).value === null);
}

console.log("\n2. Contrôle de tranche après enrichissement");
{
  const petite = bracketOfTranches(["11", "12"]);
  check("bornes de « 10 à 49 salariés »", petite?.min === 10 && petite?.max === 49, JSON.stringify(petite));
  check("libellé lisible", petite?.label === "10 à 49 salariés", String(petite?.label));

  // Les trois cas réels : Pappers donne 75, 75 et 150 après correction.
  check("SEMAPHORES (75) est hors tranche", checkBracket(75, petite) === "hors tranche");
  check("EG RETAIL (75) est hors tranche", checkBracket(75, petite) === "hors tranche");
  check("VIVAUTO PLVL (150) est hors tranche", checkBracket(150, petite) === "hors tranche");
  check("une entreprise de 30 passe", checkBracket(30, petite) === "dans la tranche");
  check("une entreprise de 5 est hors tranche", checkBracket(5, petite) === "hors tranche");

  // On n'écarte pas sur un doute : une fiche sans effectif reste présentée.
  check("effectif inconnu → on n'écarte pas", checkBracket(null, petite) === "inconnu");
  check("aucune tranche demandée → aucun contrôle", checkBracket(9999, null) === "inconnu");

  const grande = bracketOfTranches(["42", "51", "52", "53"]);
  check("tranche ouverte : pas de maximum", grande?.max === null, JSON.stringify(grande));
}

console.log("\n3. Une fiche d'annuaire n'est pas un signal");
{
  check("LinkedIn company est un annuaire", isRegistryHost("linkedin.com"));
  check("Societe.com aussi", isRegistryHost("www.societe.com"));
  check("Pappers aussi", isRegistryHost("pappers.fr"));
  check("un média ne l'est pas", !isRegistryHost("lesechos.fr"));

  check(
    "une offre LinkedIn reste une offre",
    classifyJobSource("https://www.linkedin.com/jobs/view/3912345678") === "officielle",
  );
  check(
    "une page entreprise LinkedIn n'en est pas une",
    classifyJobSource("https://www.linkedin.com/company/andra-learning") === "aucune",
  );
  check(
    "Welcome to the Jungle est une source d'offre",
    classifyJobSource("https://www.welcometothejungle.com/fr/companies/x/jobs/dev") === "officielle",
  );
  check(
    "France Travail aussi",
    classifyJobSource("https://candidat.francetravail.fr/offres/recherche/detail/1234") === "officielle",
  );
  check(
    "trabajo.org est un agrégateur",
    classifyJobSource("https://fr.trabajo.org/emploi-semaphores") === "agregateur",
  );
  check(
    "le site officiel fait toujours autorité",
    classifyJobSource("https://blue-enerfreeze.com/offre-demploi-automaticienne", "blue-enerfreeze.com") ===
      "officielle",
  );
  check(
    "une page quelconque n'est pas une offre",
    classifyJobSource("https://exemple.fr/actualites/inauguration") === "aucune",
  );
  check(
    "une page carrière l'est",
    classifyJobSource("https://exemple.fr/nous-rejoindre/automaticien") === "officielle",
  );
}

console.log("\n4. Intitulé de poste");
{
  check("« recrute un Automaticien »", jobTitleIn("Blue EnerFreeze recrute un Automaticien H/F") !== null);
  check(
    "l'intitulé est extrait",
    (jobTitleIn("Nous recherchons un Technicien méthodes pour Lyon") ?? "").toLowerCase().includes("technicien"),
    String(jobTitleIn("Nous recherchons un Technicien méthodes pour Lyon")),
  );
  check("« 12 offres d'emploi » n'est pas un intitulé", jobTitleIn("SEMAPHORES : 12 offres d'emploi") === null);
  check("et c'est détecté comme un volume", listsOffersWithoutTitle("SEMAPHORES : 12 offres d'emploi"));
  check(
    "une vraie offre n'est pas un volume",
    !listsOffersWithoutTitle("Blue EnerFreeze recrute un Automaticien H/F"),
  );
}

console.log("\n5. Le score discrimine : 5 profils, 5 scores distincts et ordonnés");
{
  const today = new Date("2026-09-25");
  const recent = "2026-09-15";
  const vieux = "2024-01-10";

  const signal = (over: Partial<ProspectSignal>): ProspectSignal => ({
    type: "recrutement",
    label: "Poste ouvert",
    url: "https://exemple.fr/offre",
    source: "exemple.fr",
    quote: "Nous recrutons pour renforcer nos équipes sur ce poste.",
    confidence: 0.85,
    ...over,
  });

  const profils: { nom: string; signals: ProspectSignal[] }[] = [
    {
      nom: "A · levée datée + automaticien récent, 2 sources",
      signals: [
        signal({ type: "levee", date: recent, confidence: 0.9, source: "lesechos.fr", quote: "Levée de 4 M€." }),
        signal({ type: "levee", date: recent, confidence: 0.85, source: "maddyness.com", quote: "Tour de table bouclé." }),
        signal({ date: recent, category: "automation" }),
      ],
    },
    { nom: "B · automaticien récent, site officiel", signals: [signal({ date: recent, category: "automation" })] },
    { nom: "C · vendeur récent, site officiel", signals: [signal({ date: recent, category: "sales" })] },
    {
      // Trois deductions convergentes valent mieux qu'une page d'agregateur
      // vide : elles disent au moins quelque chose de l'entreprise, la ligne
      // « 12 offres » ne dit que « elle existe ».
      nom: "D · aucune actualité, déductions INSEE",
      signals: [
        { type: "structure", label: "Effectif d'au moins 50 personnes", source: "Données INSEE", confidence: 0.53 },
        { type: "structure", label: "Commerce avec présence web", source: "Code NAF", confidence: 0.5 },
        { type: "structure", label: "Secteur à forte planification", source: "Code NAF", confidence: 0.5 },
      ],
    },
    {
      nom: "E · agrégateur sans intitulé",
      signals: [signal({ date: recent, source: "trabajo.org", sourceWeight: 0.25 })],
    },
  ];

  const scores = profils.map((profil) => ({
    nom: profil.nom,
    value: heatScore(profil.signals, { seed: profil.nom, now: today }).value,
  }));
  for (const item of scores) console.log(`       ${String(item.value).padStart(3)}/100  ${item.nom}`);

  check("5 scores distincts", new Set(scores.map((s) => s.value)).size === 5, scores.map((s) => s.value).join(" "));
  for (let index = 1; index < scores.length; index += 1) {
    check(
      `${scores[index - 1].nom[0]} > ${scores[index].nom[0]}`,
      scores[index - 1].value > scores[index].value,
      `${scores[index - 1].value} vs ${scores[index].value}`,
    );
  }

  // Le cas de production : trois entreprises sans actualité, plafonnées bas.
  check("un profil purement structurel reste sous 20", scores[3].value <= 20, String(scores[3].value));
  check("un agrégateur seul ne dépasse pas 15", scores[4].value <= 15, String(scores[4].value));
  check("un signal ancien ne compte pas", heatScore([signal({ date: vieux })], { now: today }).value === 0);
}

console.log("\n6. La confiance structurelle varie avec la taille");
{
  const company = (section: string | null): CompanyBase => ({
    siren: "1", company_name: "X", website: null, email: null, sector: null, size_range: null,
    city: null, postal_code: null, naf_code: null, naf_section: section, founded_year: null,
    legal_form: null, leader: null, leader_person: null, parent_company: null,
    matched_branch: false,
    figures: {
      founded_on: null, effectif_code: null,
    legal_code: null, revenue_eur: null, revenue_year: null,
      net_income_eur: null, company_category: null, head_office_city: null,
    },
  });
  const petite = structuralSignals(company(null), 20)[0]?.confidence ?? 0;
  const grande = structuralSignals(company(null), 200)[0]?.confidence ?? 0;
  check("200 personnes pèsent plus que 20", grande > petite, `${petite} vs ${grande}`);
  check("la confiance reste bornée", grande <= 0.7, String(grande));
}

console.log("\n7. Aucune consigne de rédaction dans une valeur affichée");
{
  const prospect: Prospect = {
    id: "p", user_id: "u", company_name: "ANDRA LEARNING", siren: "985149434", website: null,
    email: null, sector: "Enseignement", size_range: null, city: "Paris", source: "auto",
    signals: [], key_figures: { headcount: 5, revenue_eur: 1_200_000 }, pain_point: null,
    status: "nouveau", created_at: "", updated_at: "",
  };
  const { facts } = buildFacts(prospect);
  const effectif = facts.find((fact) => fact.key === "headcount");
  check("l'effectif s'affiche brut", effectif?.value === "5 salariés", String(effectif?.value));
  check("la consigne est à part", (effectif?.writerHint ?? "").includes("à écrire"), String(effectif?.writerHint));
  check(
    "aucune valeur affichée ne porte de consigne",
    facts.every((fact) => !fact.value.includes("à écrire")),
    facts.filter((fact) => fact.value.includes("à écrire")).map((fact) => fact.label).join(", "),
  );
}

console.log("\n8. Filiale déduite du ratio CA / effectif");
{
  // EG RETAIL (FRANCE) SAS, chiffres Pappers reels : 1,296 Md€ pour 50-99.
  check("EG RETAIL est vue comme une filiale", looksLikeSubsidiaryByFigures(1_296_004_123, 75));
  check(
    "une PME normale ne l'est pas",
    !looksLikeSubsidiaryByFigures(13_906_256, 75),
  );
  check(
    "un gros CA avec un gros effectif ne l'est pas",
    !looksLikeSubsidiaryByFigures(900_000_000, 1200),
  );
  check("sans chiffres, aucune deduction", !looksLikeSubsidiaryByFigures(null, 75));
  check("sans effectif non plus", !looksLikeSubsidiaryByFigures(900_000_000, null));
}

console.log("\n9. Salutation : prénom usuel, jamais « Monsieur Prénom Nom »");
{
  check("prénom et nom séparés", splitPerson("Victor Grynbaum")?.last === "Grynbaum");
  check(
    "plusieurs prénoms : le nom reste le dernier mot",
    splitPerson("Benjamin Alexandre Dumont")?.last === "Dumont",
  );
  check("le prénom usuel est le premier", splitPerson("Benjamin Alexandre Dumont")?.first === "Benjamin");

  const hunter = {
    email: "s.grynbaum@andra-learning.fr",
    full_name: "Sacha Grynbaum",
    position: "Directeur",
    confidence: 92,
  };

  // Sacha Grynbaum recoit le mail a SON adresse : c'est lui qu'on nomme, pas le
  // dirigeant du meme nom. « Sacha » est mixte, donc aucune civilite sure — et
  // « Bonjour Sacha Grynbaum, » ne s'ecrit pas a un dirigeant inconnu : neutre.
  check("adresse nominative d'un autre → jamais le dirigeant homonyme", !buildGreeting("direct", hunter, "Victor Grynbaum").includes("Victor"), buildGreeting("direct", hunter, "Victor Grynbaum"));
  check("civilite incertaine → neutre", buildGreeting("direct", hunter, "Victor Grynbaum") === "Bonjour,", buildGreeting("direct", hunter, "Victor Grynbaum"));
  check("le ton ne change plus la forme", buildGreeting("bref", hunter, null) === buildGreeting("factuel", hunter, null));
  check("jamais « Monsieur Prénom Nom »", !buildGreeting("factuel", hunter, "Victor Grynbaum").includes("Monsieur Sacha"));

  const faible = { ...hunter, full_name: "Sacha Grynbaum", confidence: 40 };
  check(
    "confiance Hunter < 80 → dirigeant du registre",
    buildGreeting("direct", { ...faible, email: "v.grynbaum@andra-learning.fr" }, "Victor Grynbaum") ===
      "Bonjour Monsieur Grynbaum,",
  );
  check("aucun nom fiable → salutation neutre", buildGreeting("direct", null, null) === "Bonjour,");
  check(
    "adresse générique → le dirigeant quand même",
    buildGreeting("direct", { ...faible, email: "contact@andra-learning.fr" }, "Victor Grynbaum") ===
      "Bonjour Monsieur Grynbaum,",
  );
}

console.log("\n10. Le pain porte sur les opérations, pas sur l'offre");
{
  // Cas ANDRA LEARNING : leur métier, c'est la formation. Le pain ne peut pas
  // être « vos processus de formation ».
  check(
    "un pain qui redit le métier est refusé",
    restatesTheOffer("processus de formation", "Formation continue d'adultes"),
  );
  check(
    "une opération interne passe",
    !restatesTheOffer("inscriptions, conventions et attestations", "Formation continue d'adultes"),
  );
  check(
    "« votre offre » est refusé d'office",
    restatesTheOffer("automatiser votre offre de services", null),
  );
  check(
    "sans secteur connu, on ne bloque pas",
    !restatesTheOffer("tri des alarmes de supervision", null),
  );

  check("le slogan du site est repéré", paraphrasesSlogan("Andra Learning s'efforce de déployer l'excellence"));
  check("un fait ne l'est pas", !paraphrasesSlogan("Vous formez des salariés en presentiel et a distance"));
}

console.log("\n11. Preuve : elle recoupe le pain, ou il n'y en a pas");
{
  check(
    "une preuve d'alertes sur un pain de formation est refusée",
    !proofMatchesPain("p2", "inscriptions et attestations de formation"),
  );
  check(
    "la même preuve sur un pain de supervision passe",
    proofMatchesPain("p2", "alertes de supervision et interventions"),
  );
  check("aucune preuve est toujours permis", proofMatchesPain(null, "n'importe quoi"));
  check("un id inconnu est refusé", !proofMatchesPain("p99", "supervision"));
}

console.log("\n12. Une seule question par mail");
{
  const deux =
    "Bonjour,@@Comment standardisez-vous vos parcours ?@@Je construis des flux." +
    "@@Comment gérez-vous cela aujourd'hui ?@@Axel";
  const une = "Bonjour,@@Votre volume est important.@@Je construis des flux.@@C'est un sujet ?@@Axel";
  check("deux questions sont comptées", questionsIn(deux.split("@@").join(String.fromCharCode(10, 10))).length === 2);
  check("une seule passe", questionsIn(une.split("@@").join(String.fromCharCode(10, 10))).length === 1);
  check("le slogan est repéré dans le corps", echoesSlogan("Andra Learning s'efforce de faire mieux").length === 1);
  check("« d'après ce que je comprends » aussi", echoesSlogan("D'après ce que je comprends, vous formez").length === 1);
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

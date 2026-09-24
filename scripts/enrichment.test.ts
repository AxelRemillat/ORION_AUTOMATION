/**
 * Tests de l'extraction structurée et des nouvelles règles de score.
 *
 * Ce qui est verrouillé ici correspond aux défauts constatés en production :
 * du markdown brut affiché tel quel, des « preuves » qu'aucune source ne porte,
 * des signaux non datés comptés comme frais, des faits en double qui se
 * contredisent, et un score qui favorisait les filiales de grands groupes.
 *
 * Exécution : `npm run test:enrichment` (aucune dépendance de test).
 */
import {
  cleanText,
  isNavigationLine,
  quoteIsGrounded,
  stripMarkdown,
} from "../lib/enrichment/clean";
import {
  companyAge,
  isFresh,
  parseTextDate,
  parseUrlDate,
  resolvePostedAt,
} from "../lib/enrichment/dates";
import { isAnchored, verify, type RawExtraction } from "../lib/enrichment/extract";
import { extractionToSignals, mergeSignals } from "../lib/enrichment/structured-signals";
import { heatContextOf, heatScore } from "../lib/scoring";
import { buildFacts } from "../lib/emails/derived-facts";
import type { Prospect, ProspectSignal } from "../types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date("2026-09-24T12:00:00Z");

// ---------------------------------------------------------------------------
console.log("\nNettoyage du markdown");
// ---------------------------------------------------------------------------

const RAW_MARKDOWN = `# Nos offres

- [Automaticien/ne](https://exemple.fr/offre/12) 🔥 **CDI** — Blue EnerFreeze

Accueil | Services | Contact | Mentions légales

> Filiale du Groupe STEF, nous recrutons.`;

const cleaned = cleanText(RAW_MARKDOWN);

check("les liens gardent leur libellé, pas leur URL", cleaned.includes("Automaticien/ne"));
check("les URL disparaissent", !cleaned.includes("https://"));
check("les marqueurs markdown disparaissent", !/[#*>]/.test(cleaned));
check("les emojis disparaissent", !/\p{Extended_Pictographic}/u.test(cleaned));
check(
  "la barre de navigation est écartée",
  !cleaned.includes("Mentions légales"),
  cleaned.replace(/\n/g, " | "),
);
check("le texte porteur survit", cleaned.includes("Filiale du Groupe STEF"));
check("une ligne de menu est reconnue", isNavigationLine("Accueil | Services | Contact | Blog"));
check("une vraie phrase ne l'est pas", !isNavigationLine("Nous recrutons un automaticien en CDI."));
check("stripMarkdown ne casse pas un texte nu", stripMarkdown("Texte simple.") === "Texte simple.");

// ---------------------------------------------------------------------------
console.log("\nVérification des citations");
// ---------------------------------------------------------------------------

const SOURCE = "Blue EnerFreeze, filiale du Groupe STEF, recrute un Automaticien/ne en CDI.";

check("une citation exacte est acceptée", quoteIsGrounded("filiale du Groupe STEF", SOURCE));
check(
  "la casse et les accents ne bloquent pas",
  quoteIsGrounded("FILIALE DU GROUPE STEF", SOURCE),
);
check(
  "une citation reformulée est rejetée",
  !quoteIsGrounded("Blue EnerFreeze appartient au groupe STEF", SOURCE),
);
check("une citation trop courte est rejetée", !quoteIsGrounded("STEF", SOURCE));

const DOCUMENTS = [
  {
    url: "https://emploi.exemple.fr/offre/12",
    title: "Automaticien H/F",
    content: SOURCE,
    sourceDate: null,
    clean: SOURCE,
    anchored: true,
  },
  {
    url: "https://presse.exemple.fr/autre",
    title: "Une autre société",
    content: "Une entreprise homonyme lève 4 M€ cette semaine.",
    sourceDate: null,
    clean: "Une entreprise homonyme lève 4 M€ cette semaine.",
    anchored: false,
  },
];

const RAW: RawExtraction = {
  parentGroup: {
    name: "Groupe STEF",
    evidenceQuote: "filiale du Groupe STEF",
    url: "https://emploi.exemple.fr/offre/12",
  },
  jobPostings: [
    {
      title: "Automaticien/ne",
      category: "automation",
      postedAt: null,
      url: "https://emploi.exemple.fr/offre/12",
      evidenceQuote: "recrute un Automaticien/ne en CDI",
    },
    {
      title: "Poste inventé",
      category: "data",
      postedAt: null,
      url: "https://emploi.exemple.fr/offre/12",
      evidenceQuote: "nous recherchons un data engineer senior",
    },
  ],
  events: [
    {
      type: "levée",
      date: null,
      url: "https://presse.exemple.fr/autre",
      evidenceQuote: "Une entreprise homonyme lève 4 M€ cette semaine.",
    },
  ],
  siteSummary: null,
};

const verified = verify(RAW, DOCUMENTS, NOW);

check("le groupe parent cité mot pour mot est retenu", verified.parentGroup?.name === "Groupe STEF");
check("le poste réellement cité est retenu", verified.jobPostings.length === 1);
check(
  "le poste inventé est rejeté",
  verified.rejected.some((item) => item.reason === "citation introuvable"),
);
check(
  "l'événement d'une source non ancrée est rejeté",
  verified.events.length === 0 &&
    verified.rejected.some((item) => item.reason === "source non ancrée"),
);

check(
  "ancrage : nom + ville suffisent",
  isAnchored(
    { url: "https://presse.fr/a", title: "Jacquet à Saint-Priest", content: "Jacquet, Saint-Priest" },
    { name: "Jacquet", city: "Saint-Priest" },
  ),
);
check(
  "ancrage : le nom seul ne suffit pas",
  !isAnchored(
    { url: "https://presse.fr/a", title: "Jacquet", content: "Jacquet a signé un contrat." },
    { name: "Jacquet", city: "Saint-Priest", siren: "123456789" },
  ),
);

// ---------------------------------------------------------------------------
console.log("\nDatation et fraîcheur");
// ---------------------------------------------------------------------------

check(
  "la date de la source prime",
  resolvePostedAt({
    sourceDate: "2026-09-01T00:00:00Z",
    text: "publiée le 3 mars 2020",
    url: "https://x.fr/2019/01/02/a",
    now: NOW,
  }).date === "2026-09-01",
);
check(
  "sinon la date du texte",
  resolvePostedAt({ text: "publiée le 3 mars 2026", url: "https://x.fr/2019/01/02/a", now: NOW })
    .date === "2026-03-03",
);
check(
  "sinon la date de l'URL",
  resolvePostedAt({ text: "aucune date ici", url: "https://x.fr/2026/07/15/offre", now: NOW })
    .date === "2026-07-15",
);
check(
  "rien de datable donne null",
  resolvePostedAt({ text: "aucune date", url: "https://x.fr/offre", now: NOW }).date === null,
);
check(
  "une date relative est rapportée à la date de crawl",
  parseTextDate("publiée il y a 3 jours", NOW) === "2026-09-21",
);
check("motif de date compact dans l'URL", parseUrlDate("https://x.fr/news-20260910-a.html") === "2026-09-10");

check("moins de 60 jours : frais", isFresh("2026-09-01", NOW));
check("plus de 60 jours : périmé", !isFresh("2026-01-01", NOW));
check("non daté : jamais frais", !isFresh(null, NOW));

check(
  "âge exact avec la date complète",
  companyAge({ foundedOn: "1968-11-05" }, NOW)?.years === 57,
  JSON.stringify(companyAge({ foundedOn: "1968-11-05" }, NOW)),
);
check(
  "âge sur l'année seule, sans contradiction possible",
  companyAge({ foundedYear: 1968 }, NOW)?.years === 58,
);

// ---------------------------------------------------------------------------
console.log("\nDéduplication");
// ---------------------------------------------------------------------------

const structured = extractionToSignals(verified);
const fallback: ProspectSignal[] = [
  {
    type: "recrutement",
    label: "Recrutement en cours — emploi.exemple.fr",
    url: "https://emploi.exemple.fr/offre/12",
    quote: "recrute un Automaticien",
    confidence: 0.8,
  },
  {
    type: "digital",
    label: "Chantier digital évoqué — autre.fr",
    url: "https://autre.fr/b",
    quote: "refonte du site",
    confidence: 0.8,
  },
];

const merged = mergeSignals(structured, fallback);
check(
  "un signal structuré remplace le signal brut de même URL",
  merged.filter((signal) => signal.url === "https://emploi.exemple.fr/offre/12").length === 1,
);
check("le signal sans équivalent structuré est conservé", merged.length === structured.length + 1);
check("le signal structuré porte sa catégorie", merged[0].category === "automation");

const PROSPECT: Prospect = {
  id: "p1",
  user_id: "u1",
  company_name: "Blue EnerFreeze",
  siren: "123456789",
  website: "https://blue-enerfreeze.fr",
  email: null,
  sector: "Entreposage frigorifique",
  size_range: "50 à 99 salariés",
  city: "Vitry-le-François",
  source: "auto",
  signals: [
    {
      type: "presse",
      label: "Signal web",
      url: "https://registre.fr/fiche",
      quote: "Société créée le 12 mars 1968, immatriculée au RCS, capital social de 40 000 €.",
      confidence: 0.9,
      date: "2026-09-20",
    },
  ],
  key_figures: {
    founded_on: "1968-03-12",
    founded_year: 1968,
    naf_code: "52.10B",
    headcount: 60,
    revenue_eur: 12_000_000,
    leader_person: "Marc Dupont",
    leader_via: "SC DINOPACHOU",
    parent_group: "Groupe STEF",
    is_large_group_subsidiary: true,
    site_status: "lu",
  },
  pain_point: null,
  status: "nouveau",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
};

const built = buildFacts(PROSPECT, null, NOW);
const ageFacts = built.facts.filter((fact) => fact.key === "age");
check("un seul fait d'âge", ageFacts.length === 1, `${ageFacts.length} faits`);
check(
  "le signal qui répète le registre est supprimé",
  !built.facts.some((fact) => fact.key === "signal"),
);
check(
  "le dirigeant remonte la holding",
  built.facts.find((fact) => fact.key === "leader")?.value === "Marc Dupont (via SC DINOPACHOU)",
);
check("la filiale est signalée au reste de l'app", built.isLargeGroupSubsidiary);
check(
  "site lu : la confiance du modèle économique dépasse 0,4",
  built.businessModelConfidence > 0.4,
);
check(
  "site non trouvé : confiance plafonnée à 0,4",
  buildFacts(
    { ...PROSPECT, key_figures: { ...PROSPECT.key_figures, site_status: "non trouvé" } },
    null,
    NOW,
  ).businessModelConfidence <= 0.4,
);

// ---------------------------------------------------------------------------
console.log("\nRègles de score");
// ---------------------------------------------------------------------------

const freshHire: ProspectSignal = {
  type: "recrutement",
  label: "Poste ouvert : Automaticien/ne",
  url: "https://emploi.exemple.fr/offre/12",
  quote: "recrute un Automaticien/ne en CDI",
  confidence: 0.95,
  category: "automation",
  date: "2026-09-10",
  structured: true,
};

const baseScore = heatScore([freshHire], { now: NOW });
const withMalus = heatScore([freshHire], { now: NOW, context: { isLargeGroupSubsidiary: true } });
const withBonus = heatScore([freshHire], { now: NOW, context: { hasIdentifiedLeader: true } });

check(
  "un recrutement automation frais vaut +15",
  baseScore.breakdown.some((line) => line.kind === "bonus" && line.points === 15),
);
check("filiale de grand groupe : −15", withMalus.value === baseScore.value - 15);
check(
  "le malus est explicité",
  withMalus.breakdown.some((line) => line.kind === "malus" && line.points === -15),
);
check("PME indépendante avec dirigeant : +10", withBonus.value === baseScore.value + 10);
check(
  "le bonus PME ne s'ajoute pas au malus filiale",
  heatScore([freshHire], {
    now: NOW,
    context: { isLargeGroupSubsidiary: true, hasIdentifiedLeader: true },
  }).value === withMalus.value,
);

const undated: ProspectSignal = { ...freshHire, date: undefined };
const stale: ProspectSignal = { ...freshHire, date: "2025-01-01" };
const undatedScore = heatScore([undated], { now: NOW });
const staleScore = heatScore([stale], { now: NOW });

check("signal non daté : 0 point", undatedScore.value === 0, `${undatedScore.value}`);
check("signal périmé : 0 point", staleScore.value === 0, `${staleScore.value}`);
check(
  "et on dit pourquoi",
  undatedScore.breakdown.some((line) => line.label.includes("non daté")),
);
check(
  "un non-daté ne déclenche pas le bonus recrutement",
  !undatedScore.breakdown.some((line) => line.kind === "bonus"),
);

// ---------------------------------------------------------------------------
console.log("\nIndependance et mandats de controle");
// ---------------------------------------------------------------------------

check(
  "un representant personne morale annule le bonus d'independance",
  heatContextOf({ leader_person: "Benjamin Dumont", parent_company: "SOCIETE IMMOSTEF" })
    .hasIdentifiedLeader === false,
);
check(
  "sans indice de groupe, le bonus s'applique",
  heatContextOf({ leader_person: "Marc Dupont" }).hasIdentifiedLeader === true,
);
check(
  "le drapeau filiale reste porte par is_large_group_subsidiary",
  heatContextOf({ is_large_group_subsidiary: true }).isLargeGroupSubsidiary === true,
);

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Tests du segment « Agences » et de la famille F5.
 *
 * Ce qui est verrouillé ici, ce sont les décisions qui coûtent cher quand elles
 * se trompent : écrire à une agence qui vend déjà de l'automatisation, écarter
 * une cible parce que son site n'a pas encore été lu, dépasser le plafond
 * d'envoi commun, ou envoyer un mail de 110 mots sur une grille de 75.
 *
 * Exécution : `npm run test:segments` (aucune dépendance de test).
 */
import {
  AGENCES_DAILY_CAP,
  classifyAgence,
  normalizeNaf,
  sizeFits,
} from "../lib/segments/agences";
import {
  competitorReason,
  isSegmentCompetitor,
  segmentLabel,
  segmentMarks,
  segmentOf,
} from "../lib/segments/index";
import { allowanceLabel, resolveCap, segmentAllowance } from "../lib/segments/quota";
import { checkF5, F5_MAX_WORDS, f5Instructions } from "../lib/segments/mail-f5";
import {
  ALL_FAMILIES,
  assembleFamily,
  bareDemoUrl,
  PROOF_PREFIXES,
  familyFor,
  familyForSegment,
  FAMILY_LIMITS,
  isFamily,
} from "../lib/emails/quality/families";
import { FAMILY_GRIDS } from "../lib/emails/quality/judge";
import { offTargetReason } from "../lib/funnel/off-target";
import type { Prospect } from "../types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\nCodes NAF et taille");
// ---------------------------------------------------------------------------

check("un code sans point est normalisé", normalizeNaf("7311Z") === "73.11Z");
check("la casse ne compte pas", normalizeNaf("62.01z") === "62.01Z");
check("un code trop court est refusé", normalizeNaf("73") === null);

const SITE_AGENCE = "Nous sommes une agence web à Lyon. Création de sites vitrine et e-commerce, référencement naturel.";

check(
  "73.11Z publicité : dans le vivier",
  classifyAgence({ naf: "73.11Z", effectifCode: "11", siteText: SITE_AGENCE }).fit === "dedans",
);
check(
  "62.01Z programmation : dans le vivier, si le site le confirme",
  classifyAgence({ naf: "62.01Z", effectifCode: "02", siteText: SITE_AGENCE }).fit === "dedans",
);
check(
  "un NAF hors liste sort tout de suite",
  classifyAgence({ naf: "25.50B", effectifCode: "11", siteText: SITE_AGENCE }).fit === "dehors",
);
check(
  "et le motif nomme le code",
  (classifyAgence({ naf: "25.50B", siteText: SITE_AGENCE }).reason ?? "").includes("25.50B"),
);

check("effectif réel dans la cible", sizeFits({ headcount: 12 }).ok);
check("effectif réel au-dessus : écarté", !sizeFits({ headcount: 60 }).ok);
check("effectif réel sous la cible : écarté", !sizeFits({ headcount: 2 }).ok);
check("tranche 02 (3 à 5) acceptée", sizeFits({ effectifCode: "02" }).ok);
check("tranche 12 (20 à 49) acceptée", sizeFits({ effectifCode: "12" }).ok);
check("tranche 21 (50 à 99) écartée", !sizeFits({ effectifCode: "21" }).ok);
check("tranche 01 (1 à 2) écartée", !sizeFits({ effectifCode: "01" }).ok);
check("tranche non déterminée : on ne rejette pas", sizeFits({ effectifCode: "NN" }).ok);
check(
  "l'effectif réel l'emporte sur la tranche",
  !sizeFits({ headcount: 80, effectifCode: "11" }).ok,
);

// ---------------------------------------------------------------------------
console.log("\nQualification par le site");
// ---------------------------------------------------------------------------

const noSite = classifyAgence({ naf: "73.11Z", effectifCode: "11" });
check("sans site : indécidable, pas « dehors »", noSite.fit === "indécidable");
check("et le motif le dit", (noSite.reason ?? "").includes("site non lu"));

const qualified = classifyAgence({ naf: "73.11Z", effectifCode: "11", siteText: SITE_AGENCE });
check("les signaux trouvés sont rendus", qualified.signals.includes("agence web"));
check("plusieurs signaux cumulés", qualified.signals.length >= 2, qualified.signals.join(", "));

check(
  "NAF dans le vivier mais site muet : dehors",
  classifyAgence({
    naf: "62.01Z",
    effectifCode: "02",
    siteText: "Éditeur de logiciel de gestion pour les laboratoires d'analyse.",
  }).fit === "dehors",
);

// ---------------------------------------------------------------------------
console.log("\nConcurrents et partenaires possibles");
// ---------------------------------------------------------------------------

/*
 * Faux positif trouvé par la mesure du 07/10/2026 : REMIX COWORKING, un espace
 * de coworking, retenu comme agence sur le seul mot « SEO ». Un indice faible
 * seul ne qualifie plus ; deux, ou un fort, oui.
 */
check(
  "un seul indice faible ne qualifie pas",
  classifyAgence({
    naf: "73.11Z",
    effectifCode: "11",
    siteText: "Espace de coworking à Lyon. Nos résidents : consultants et experts SEO.",
  }).fit === "dehors",
);
check(
  "deux indices faibles qualifient",
  classifyAgence({
    naf: "73.11Z",
    effectifCode: "11",
    siteText: "Nous faisons du référencement naturel et de la boutique en ligne pour nos clients.",
  }).fit === "dedans",
);
check(
  "un indice fort seul qualifie",
  classifyAgence({
    naf: "73.11Z",
    effectifCode: "11",
    siteText: "Nous sommes une agence de communication à Lyon.",
  }).fit === "dedans",
);
check(
  "et le motif nomme l'indice insuffisant",
  (
    classifyAgence({
      naf: "73.11Z",
      effectifCode: "11",
      siteText: "Espace de coworking. Nos résidents sont experts SEO.",
    }).reason ?? ""
  ).includes("indice faible"),
);

const rival = classifyAgence({
  naf: "73.11Z",
  effectifCode: "11",
  siteText: `${SITE_AGENCE} Nous automatisons vos process avec n8n et Make.`,
});
check("un outil nommé fait le concurrent", rival.competitor !== null, String(rival.competitor));
check("et il sort du segment", rival.fit === "dehors");
check("même en cochant tous les autres critères", rival.signals.includes("agence web"));

const aiTalk = classifyAgence({
  naf: "73.11Z",
  effectifCode: "11",
  siteText: `${SITE_AGENCE} Notre blog parle d'intelligence artificielle et de ChatGPT.`,
});
check("parler d'IA ne suffit pas à faire un concurrent", aiTalk.competitor === null);
check("l'agence reste une cible", aiTalk.fit === "dedans");

const agents = classifyAgence({
  naf: "73.11Z",
  effectifCode: "11",
  siteText: `${SITE_AGENCE} Nous déployons des agents IA pour nos clients.`,
});
check("une offre d'agents IA fait le concurrent", agents.competitor !== null);

// ---------------------------------------------------------------------------
console.log("\nMarquage de la fiche");
// ---------------------------------------------------------------------------

check("un verdict indécidable n'écrit rien", Object.keys(segmentMarks(noSite)).length === 0);
check("une cible est marquée dans le segment", segmentMarks(qualified).segment === "agences");
check(
  "un concurrent n'est PAS marqué dans le segment",
  segmentMarks(rival).segment === undefined && typeof segmentMarks(rival).segment_competitor === "string",
);

const base: Pick<Prospect, "key_figures" | "size_range" | "company_name" | "website"> = {
  key_figures: {},
  size_range: null,
  company_name: "Agence Exemple",
  website: "https://agence-exemple.fr",
};

check("segmentOf lit la fiche", segmentOf({ key_figures: { segment: "agences" } }) === "agences");
check("une valeur inconnue est ignorée", segmentOf({ key_figures: { segment: "plombiers" } }) === null);
check("le libellé est affichable", segmentLabel("agences") === "Agences web & marketing");

const rivalProspect = { ...base, key_figures: segmentMarks(rival) };
check("un concurrent est reconnu sur la fiche", isSegmentCompetitor(rivalProspect));
check("son motif est lisible", (competitorReason(rivalProspect) ?? "").length > 3);
check(
  "et il devient hors cible : aucun mail",
  (offTargetReason(rivalProspect) ?? "").startsWith("concurrent / partenaire possible"),
  String(offTargetReason(rivalProspect)),
);
check("une agence cible reste contactable", offTargetReason({ ...base, key_figures: segmentMarks(qualified) }) === null);

// ---------------------------------------------------------------------------
console.log("\nQuota du segment, dans le plafond commun");
// ---------------------------------------------------------------------------

check("plafond par défaut", resolveCap("agences") === AGENCES_DAILY_CAP);
check("surcharge des réglages prise en compte", resolveCap("agences", 3) === 3);
check("surcharge absurde ignorée", resolveCap("agences", -2) === AGENCES_DAILY_CAP);
check("surcharge à zéro acceptée (segment en pause)", resolveCap("agences", 0) === 0);

const room = segmentAllowance({ segment: "agences", sent: 2, commonRemaining: 10, capOverride: 5 });
check("il reste la place du segment", room.remaining === 3, String(room.remaining));
check("rien ne limite encore", room.limitedBy === null);

const segmentFull = segmentAllowance({ segment: "agences", sent: 5, commonRemaining: 10 });
check("quota du segment atteint", segmentFull.remaining === 0 && segmentFull.limitedBy === "segment");

const commonFull = segmentAllowance({ segment: "agences", sent: 1, commonRemaining: 0 });
check("plafond commun atteint : rien ne passe", commonFull.remaining === 0);
check("et c'est le commun qui est nommé", commonFull.limitedBy === "commun");

const squeezed = segmentAllowance({ segment: "agences", sent: 0, commonRemaining: 2 });
check("le segment ne dépasse jamais le commun", squeezed.remaining === 2);
check("la phrase affichée dit l'état", allowanceLabel(segmentFull).includes("quota du segment"));

// ---------------------------------------------------------------------------
console.log("\nFamille F5");
// ---------------------------------------------------------------------------

check("F5 est une famille valide", isFamily("F5"));
check("mais pas dans le tirage des familles", !(ALL_FAMILIES as readonly string[]).includes("F5"));
check(
  "aucun prospect ne tire F5 au hasard",
  Array.from({ length: 200 }, (_, index) => familyFor(`p${index}`)).every((family) => family !== "F5"),
);
check("le segment impose F5", familyForSegment("agences") === "F5");
check("un autre segment n'impose rien", familyForSegment(null) === null);
check("F5 plafonne à 75 mots", FAMILY_LIMITS.F5.max === F5_MAX_WORDS);
check(
  "le marqueur de famille v=5 est retiré pour la liste blanche",
  bareDemoUrl("axelremillat.com/automatisations?demo=email&v=5") ===
    "axelremillat.com/automatisations?demo=email",
);

const GOOD_F5 = [
  "Bonjour Monsieur Mercier,",
  "",
  "Votre page réalisations montre trois refontes e-commerce cette année.",
  "",
  "Ces clients demandent souvent ensuite des automatisations (relances de panier, stocks) qu'une équipe de six personnes ne peut pas produire sans arrêter le reste.",
  "",
  "Je les construis en marque blanche : vous vendez et gardez la relation, je livre sous votre nom.",
  "",
  "Ce que je construis seul, testable en une minute : axelremillat.com/automatisations?demo=email&v=5",
  "",
  "Auriez-vous 15 minutes cette semaine pour en parler ?",
].join("\n");

const facts = [{ label: "Trois refontes e-commerce", url: "https://agence-exemple.fr/realisations" }];
const good = checkF5({ subject: "Vos refontes e-commerce", body: GOOD_F5, facts });
check("le mail cible passe toute la grille", good.ready, good.failed.map((item) => item.id).join(", "));
check("les six critères sont vérifiables sans LLM", good.deferred.length === 0);

const noFact = checkF5({ subject: "x", body: GOOD_F5, facts: [{ label: "une idée" }] });
check("un fait sans URL ne compte pas", !noFact.ready && noFact.failed.some((item) => item.id === "fait-source"));

const twoQuestions = checkF5({
  subject: "x",
  body: `${GOOD_F5}\n\nEt qui gère vos intégrations aujourd'hui ?`,
  facts,
});
check("deux questions : refusé", twoQuestions.failed.some((item) => item.id === "un-seul-cta"));

const noWhiteLabel = checkF5({
  subject: "x",
  body: GOOD_F5.replace("en marque blanche : vous vendez et gardez la relation, je livre sous votre nom", "pour vos clients"),
  facts,
});
check("sans marque blanche : refusé", noWhiteLabel.failed.some((item) => item.id === "marque-blanche"));

const tooLong = checkF5({
  subject: "x",
  body: `${GOOD_F5}\n\n${"mot ".repeat(40)}`,
  facts,
});
check("au-delà de 75 mots : refusé", tooLong.failed.some((item) => item.id === "longueur"));

/*
 * Défaut trouvé par la mesure à blanc du 07/10/2026 : la grille comptait le
 * corps ENTIER. La mention « stop » et la signature — posées par le code,
 * identiques partout, et la signature contient un lien du domaine de démo —
 * faisaient échouer « longueur » et « preuve » sur tout mail correct.
 */
const SIGNATURE = "Axel Remillat\nAutomatisation & IA pour PME · https://axelremillat.com/pme · 0749727192";
const STORED = `${GOOD_F5}\n\nSi le sujet ne vous concerne pas, un simple « stop » en réponse et je ne vous relancerai pas.\n\n${SIGNATURE}`;

const stored = checkF5({ subject: "x", body: STORED, signature: SIGNATURE, facts });
check(
  "signature et mention « stop » exclues du comptage",
  stored.ready,
  stored.failed.map((item) => `${item.id} (${item.detail})`).join(" · "),
);
check(
  "sans la signature fournie, le lien de la signature fait un faux doublon",
  checkF5({ subject: "x", body: STORED, facts }).failed.some((item) => item.id === "preuve"),
);

const friction = checkF5({
  subject: "x",
  body: GOOD_F5.replace(
    "Ces clients demandent souvent ensuite des automatisations (relances de panier, stocks) qu'une équipe de six personnes ne peut pas produire sans arrêter le reste.",
    "Un brief incomplet peut retarder la proposition commerciale.",
  ),
  facts,
});
check(
  "une friction sur un livrable vaut problème (ELIOPHOT, 07/10)",
  !friction.failed.some((item) => item.id === "probleme-client"),
  friction.failed.map((item) => item.id).join(", "),
);

const noProblem = checkF5({
  subject: "x",
  body: GOOD_F5.replace(
    "Ces clients demandent souvent ensuite des automatisations (relances de panier, stocks) qu'une équipe de six personnes ne peut pas produire sans arrêter le reste.",
    "Votre agence a une expertise reconnue.",
  ),
  facts,
});
check("sans problème formulé : refusé", noProblem.failed.some((item) => item.id === "probleme-client"));

check("les consignes listent les six critères", f5Instructions().includes("75 mots au plus"));

// ---------------------------------------------------------------------------
console.log("\nAssemblage et grille de jugement F5");
// ---------------------------------------------------------------------------

const assembled = assembleFamily(
  "F5",
  { subject: "x", hook: "Votre page réalisations montre trois refontes.", proposal: "Je les construis en marque blanche." },
  {
    greeting: "Bonjour Monsieur Mercier,",
    demo: { key: "emails", label: "tri des e-mails", path: "/automatisations?demo=email" },
    cta: "Auriez-vous 15 minutes cette semaine ?",
  },
);
const lines = assembled.split("\n\n");
check("F5 ouvre sur la salutation", lines[0].startsWith("Bonjour"));
check("puis le fait et le problème", lines[1].includes("réalisations"));
check("puis la proposition marque blanche", lines[2].includes("marque blanche"));
check("puis la preuve, avec le préfixe F5", lines[3].startsWith(PROOF_PREFIXES.F5));
check("la démo porte le marqueur v=5", lines[3].includes("v=5"));
check("et la demande ferme le mail", lines[4].includes("15 minutes"));

const gridF5 = FAMILY_GRIDS.F5;
check("la grille F5 existe", Array.isArray(gridF5) && gridF5.length > 0);
check(
  "et elle vaut 10 points, comme les autres",
  gridF5.reduce((total, item) => total + item.points, 0) === 10,
  String(gridF5.reduce((total, item) => total + item.points, 0)),
);

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

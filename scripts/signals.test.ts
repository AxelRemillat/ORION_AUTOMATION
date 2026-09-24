/**
 * Tests de non-regression sur la fiabilite des signaux.
 *
 * Contexte : l'app a tague « Levee de fonds » des entreprises qui n'avaient
 * jamais leve, et servait a toutes le MEME « pourquoi maintenant » template.
 * Ces tests verrouillent les deux garde-fous : ancrage de la preuve sur
 * l'entreprise, et restitution du contenu reel de la source.
 *
 * Execution : `npm run test:signals` (aucune dependance de test).
 */
import { isRegistryHost, maskCompanyName, qualifyWebResults } from "../lib/enrichment/signals";
import type { WebResult } from "../lib/enrichment/linkup";
import { heatScore, whyNow } from "../lib/scoring";
import type { ProspectSignal } from "../types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const web = (over: Partial<WebResult>): WebResult => ({
  title: "",
  url: "https://example.com/a",
  snippet: "",
  ...over,
});

console.log("\n1. Un article generique sur les levees ne doit taguer personne");
{
  const results = [
    web({
      title: "Les levées de fonds de la semaine dans la French Tech",
      url: "https://maddyness.com/levees-semaine",
      snippet:
        "Cette semaine, plusieurs startups annoncent une levée de fonds importante. Le tour de table atteint 12 millions d'euros pour certaines d'entre elles.",
      date: "2026-09-01",
    }),
  ];
  const signals = qualifyWebResults(results, { name: "Drago Paris", website: "https://drago.paris" });
  check("aucun signal emis", signals.length === 0, `obtenu ${JSON.stringify(signals)}`);
}

console.log("\n2. Une levee concernant une AUTRE entreprise ne doit pas deteindre");
{
  const results = [
    web({
      title: "Alan lève 173 millions d'euros",
      url: "https://lesechos.fr/alan-levee",
      snippet:
        "L'assurtech Alan annonce une levée de fonds de 173 millions d'euros menée par Temasek. Le tour de table valorise la société plus de 4 milliards.",
      date: "2026-08-20",
    }),
  ];
  const signals = qualifyWebResults(results, {
    name: "Paris Offset Print",
    website: "https://parisoffsetprint.fr",
  });
  check("aucun signal emis", signals.length === 0, `obtenu ${JSON.stringify(signals)}`);
}

console.log("\n3. Une levee reelle, datee et nommant l'entreprise, est retenue avec sa preuve");
let dragoSignals: ProspectSignal[] = [];
{
  dragoSignals = qualifyWebResults(
    [
      web({
        title: "Drago Paris lève 4 millions d'euros pour accélérer",
        url: "https://lesechos.fr/drago-paris-leve",
        snippet:
          "La maison Drago Paris annonce une levée de fonds de 4 millions d'euros auprès de Bpifrance. Les fonds financeront l'ouverture de deux ateliers.",
        date: "2026-08-14",
      }),
    ],
    { name: "Drago Paris", website: "https://drago.paris" },
  );
  const [signal] = dragoSignals;
  check("un signal emis", dragoSignals.length === 1);
  check("type = levee", signal?.type === "levee");
  check("citation issue de la source", Boolean(signal?.quote?.includes("Drago Paris")));
  check("url verifiable", signal?.url === "https://lesechos.fr/drago-paris-leve");
  check("date extraite", signal?.date === "2026-08-14");
  check("confiance elevee", (signal?.confidence ?? 0) >= 0.8, `confiance=${signal?.confidence}`);
  check(
    "libelle factuel, pas promotionnel",
    Boolean(signal?.label?.startsWith("Levée de fonds mentionnée")) &&
      !signal?.label?.includes("budget"),
    signal?.label,
  );
}

console.log("\n4. Deux entreprises aux sources differentes -> deux « pourquoi maintenant » differents");
{
  const alexandre = qualifyWebResults(
    [
      web({
        title: "Alexandre de Paris ouvre un nouveau site de production en Normandie",
        url: "https://usinenouvelle.com/alexandre-de-paris",
        snippet:
          "Alexandre de Paris inaugure un nouveau site de production à Caen. L'atelier emploiera trente personnes dès la première année.",
        date: "2026-07-02",
      }),
    ],
    { name: "Alexandre de Paris", website: "https://alexandredeparis.com" },
  );

  const a = whyNow(dragoSignals);
  const b = whyNow(alexandre);

  check("les deux ont un pourquoi maintenant", Boolean(a) && Boolean(b));
  check(
    "textes differents",
    Boolean(a && b && a.headline !== b.headline),
    `a="${a?.headline}" b="${b?.headline}"`,
  );
  check("chacun cite sa propre source", Boolean(a && b && a.url !== b.url));
  check(
    "le texte vient bien de la source",
    Boolean(a?.headline.includes("Drago Paris") && b?.headline.includes("Alexandre de Paris")),
  );
}

console.log("\n5. Sans signal prouve : pas de pourquoi maintenant, et jamais « brulant »");
{
  const structurels: ProspectSignal[] = [
    { type: "structure", label: "Effectif d'au moins 50 personnes", source: "Données INSEE", confidence: 0.5 },
    { type: "structure", label: "Commerce avec présence web", source: "Code NAF", confidence: 0.5 },
    { type: "structure", label: "Entreprise jeune (créée en 2022)", source: "Données INSEE", confidence: 0.5 },
  ];
  check("aucun pourquoi maintenant", whyNow(structurels) === null);

  const score = heatScore(structurels);
  check("jamais brulant", score.level !== "brulant", `niveau=${score.level} valeur=${score.value}`);
  check("score plafonne", score.value <= 60, `valeur=${score.value}`);
}

console.log("\n6. Une page de recrutement sur le domaine de l'entreprise est acceptee");
{
  const signals = qualifyWebResults(
    [
      web({
        title: "Paris Offset Print — nos offres d'emploi",
        url: "https://parisoffsetprint.fr/recrutement",
        snippet:
          "Nous recherchons un conducteur de presse offset en CDI pour renforcer l'atelier. Poste à pourvoir dès septembre 2026.",
        date: "2026-09-05",
      }),
    ],
    { name: "Paris Offset Print", website: "https://parisoffsetprint.fr" },
  );
  check("signal emis", signals.length === 1, JSON.stringify(signals));
  check("type = recrutement", signals[0]?.type === "recrutement");
}

console.log("\n7. Un mot-cle present dans la RAISON SOCIALE n'est pas un signal");
{
  // Cas reel : « RAS INTERIM JERECRUTE » recevait un signal Recrutement parce
  // que son propre nom contient « recrute », et la source etait l'annuaire
  // public — qui ne fait que republier sa fiche d'immatriculation.
  const name = "RAS INTERIM JERECRUTE";

  const fromRegistry = qualifyWebResults(
    [
      web({
        title: "RAS INTERIM JERECRUTE - Annuaire des Entreprises",
        url: "https://annuaire-entreprises.data.gouv.fr/entreprise/ras-interim-jerecrute",
        snippet:
          "RAS INTERIM JERECRUTE, SAS au capital de 40 000 euros, immatriculée au RCS de Lyon. Activité principale : activités des agences de travail temporaire.",
      }),
    ],
    { name },
  );
  check("aucun signal depuis un annuaire", fromRegistry.length === 0, JSON.stringify(fromRegistry));

  const fromPress = qualifyWebResults(
    [
      web({
        title: "RAS INTERIM JERECRUTE ouvre une agence à Nantes",
        url: "https://www.ouest-france.fr/eco/ras-interim",
        snippet:
          "RAS INTERIM JERECRUTE, agence de travail temporaire, est désormais présente à Nantes. Publié le 03/09/2026.",
      }),
    ],
    { name },
  );
  check(
    "meme hors annuaire, le nom seul ne prouve pas un recrutement",
    !fromPress.some((signal) => signal.type === "recrutement"),
    JSON.stringify(fromPress.map((signal) => signal.type)),
  );

  check(
    "le nom complet est masque avant le test des regles",
    maskCompanyName("RAS INTERIM JERECRUTE recrute", ["ras interim jerecrute"]) === "recrute",
    maskCompanyName("RAS INTERIM JERECRUTE recrute", ["ras interim jerecrute"]),
  );
  check(
    "un mot isole du nom est masque aussi",
    !maskCompanyName("Jerecrute publie une offre", ["ras interim jerecrute"]).includes("jerecrute"),
  );

  check("annuaire-entreprises reconnu comme registre", isRegistryHost("annuaire-entreprises.data.gouv.fr"));
  check("pappers reconnu comme registre", isRegistryHost("pappers.fr"));
  check("sous-domaine de registre reconnu", isRegistryHost("www.societe.com"));
  check("la presse n'est pas un registre", !isRegistryHost("lesechos.fr"));
  // Les sites d'emploi publient de vraies offres : les bloquer tuerait le signal.
  check("un site d'emploi n'est pas un registre", !isRegistryHost("welcometothejungle.com"));

  const realJob = qualifyWebResults(
    [
      web({
        title: "Zeta Technologies recrute un gestionnaire ADV",
        url: "https://www.welcometothejungle.com/fr/companies/zeta/jobs",
        snippet:
          "Zeta Technologies recrute un gestionnaire ADV en CDI pour accompagner sa croissance. Publié le 12/08/2026.",
      }),
    ],
    { name: "ZETA TECHNOLOGIES" },
  );
  check(
    "une offre d'emploi reelle reste un signal",
    realJob.some((signal) => signal.type === "recrutement"),
    JSON.stringify(realJob.map((signal) => signal.type)),
  );
}

console.log(
  failures === 0
    ? "\nTous les tests passent.\n"
    : `\n${failures} test(s) en echec.\n`,
);
process.exit(failures === 0 ? 0 : 1);

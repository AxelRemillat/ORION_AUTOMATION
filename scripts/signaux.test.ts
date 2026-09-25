/**
 * Mode « Signaux d'abord » — les regles qui decident ce qu'on paie.
 *
 * Trois pieges mesures contre l'API reelle le 25/09/2026, et verrouilles ici :
 *   - BODACC n'a PAS de colonne `siren` : il vit dans `registre`, un tableau qui
 *     porte deux ecritures du meme numero, et qui vaut null pour un EI ;
 *   - 24 % des annonces sont des personnes physiques, qui n'atteindront jamais
 *     la tranche visee mais couteraient un appel Pappers chacune ;
 *   - une offre France Travail ne porte aucun SIREN : le rapprochement par nom
 *     doit exiger la commune, sinon deux homonymes fusionnent.
 *
 * Execution : `npm run test:signaux`.
 */
import {
  BODACC_FAMILIES,
  isLegalEntity,
  isNegativeNature,
  natureOf,
  sinceDate,
  sirenOf,
  toNotice,
  whereClause,
} from "../lib/signals/bodacc";
import {
  cityOf,
  franceTravailStatus,
  minCreationDate,
  toJobSignal,
} from "../lib/signals/france-travail";
import { confirmsMatch, normalizeCity, tierOf, type OfficialSignal } from "../lib/signals";
import type { CompanyBase } from "../lib/enrichment/types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TODAY = new Date("2026-09-25T12:00:00Z");

console.log("\n1. Le SIREN d'une annonce BODACC");
{
  // Forme reelle observee : le meme numero, brut puis espace.
  check("tableau [brut, espace] -> brut", sirenOf(["911864023", "911 864 023"]) === "911864023");
  check("l'ordre inverse marche aussi", sirenOf(["911 864 023", "911864023"]) === "911864023");
  check("chaine seule acceptee", sirenOf("911 864 023") === "911864023");
  check("null (entrepreneur individuel) -> aucun SIREN", sirenOf(null) === null);
  check("tableau vide -> aucun SIREN", sirenOf([]) === null);
  check("numero trop court refuse", sirenOf(["12345"]) === null);
  check("SIRET a 14 chiffres n'est pas un SIREN", sirenOf(["91186402300019"]) === null);
}

console.log("\n2. Personne morale ou entrepreneur individuel");
{
  const pm = JSON.stringify({ personne: { typePersonne: "pm", nom: "CG CLINIC" } });
  const pp = JSON.stringify({ personne: { typePersonne: "pp", nom: "PAYET" } });
  const liste = JSON.stringify({ personne: [{ typePersonne: "pp" }] });

  check("personne morale -> gardee", isLegalEntity(pm));
  check("personne physique -> ecartee", !isLegalEntity(pp));
  check("`personne` en tableau est lu aussi", !isLegalEntity(liste));
  // Le doute profite a la cible : un appel de trop vaut mieux qu'une perte.
  check("champ absent -> gardee", isLegalEntity(null));
  check("JSON illisible -> gardee", isLegalEntity("{ pas du json"));
}

console.log("\n3. Nature de l'evenement");
{
  check(
    "descriptif lu dans le JSON",
    natureOf({ modificationsgenerales: JSON.stringify({ descriptif: "Augmentation du capital" }) }) ===
      "Augmentation du capital",
  );
  check(
    "repli sur `acte` quand l'autre champ est vide",
    natureOf({ acte: JSON.stringify({ nature: "Vente" }) }) === "Vente",
  );
  check("texte non-JSON -> pas de nature, pas d'exception", natureOf({ acte: "vente du fonds" }) === null);
  check("rien du tout -> null", natureOf({}) === null);
}

console.log("\n4. Une annonce n'est retenue que si elle est exploitable");
{
  const valide = {
    registre: ["911864023", "911 864 023"],
    commercant: "CG CLINIC",
    ville: "Civrieux-d'Azergues",
    cp: "69380",
    familleavis_lib: "Modifications diverses",
    dateparution: "2026-09-25",
    listepersonnes: JSON.stringify({ personne: { typePersonne: "pm" } }),
    url_complete: "https://www.bodacc.fr/x",
  };

  const notice = toNotice(valide);
  check("annonce complete -> retenue", notice !== null);
  check("SIREN normalise", notice?.siren === "911864023", String(notice?.siren));
  check("date de parution conservee", notice?.publishedAt === "2026-09-25");
  check("type de signal renseigne pour le scoring", Boolean(notice?.signalType), notice?.signalType);

  check("sans SIREN -> ecartee", toNotice({ ...valide, registre: null }) === null);
  check("sans date -> ecartee", toNotice({ ...valide, dateparution: null }) === null);
  check("sans nom -> ecartee", toNotice({ ...valide, commercant: "   " }) === null);
  check(
    "famille hors perimetre -> ecartee",
    toNotice({ ...valide, familleavis_lib: "Procédures collectives" }) === null,
  );
  check(
    "depot des comptes -> ecarte (obligation annuelle, pas un projet)",
    toNotice({ ...valide, familleavis_lib: "Dépôts des comptes" }) === null,
  );
  check(
    "entrepreneur individuel -> ecarte avant tout appel payant",
    toNotice({ ...valide, listepersonnes: JSON.stringify({ personne: { typePersonne: "pp" } }) }) === null,
  );
  check(
    "sans url, un lien de repli est fourni",
    Boolean(toNotice({ ...valide, url_complete: null })?.url),
  );
}

console.log("\n4bis. Une fin n'est pas un signal d'achat");
{
  check("dissolution -> negative", isNegativeNature("Dissolution sans liquidation de la société"));
  check("cessation d'activite -> negative", isNegativeNature("Cessation d'activité de la société."));
  check("liquidation -> negative", isNegativeNature("Jugement de liquidation"));
  check("radiation -> negative", isNegativeNature("Radiation du RCS"));
  check("cloture -> negative", isNegativeNature("Clôture pour insuffisance d'actif"));

  check("augmentation de capital -> gardee", !isNegativeNature("Modification du capital."));
  check("nouveau siege -> gardee", !isNegativeNature("Nouveau siège."));
  // L'absorbante d'une fusion est une cible, pas une fin.
  check(
    "fusion sans dissolution -> gardee",
    !isNegativeNature("Modification du capital. Sociétés ayant participé à l'opération de fusion"),
  );
  check("nature absente -> pas negative", !isNegativeNature(null));

  const dissolue = {
    registre: ["911864023"],
    commercant: "CYMATECH",
    familleavis_lib: "Modifications diverses",
    dateparution: "2026-09-25",
    modificationsgenerales: JSON.stringify({
      descriptif: "Dissolution sans liquidation de la société",
    }),
  };
  check("annonce de dissolution -> ecartee avant tout appel payant", toNotice(dissolue) === null);
  check(
    "la meme annonce avec une modification de capital -> retenue",
    toNotice({
      ...dissolue,
      modificationsgenerales: JSON.stringify({ descriptif: "Modification du capital." }),
    }) !== null,
  );
}


console.log("\n5. La clause envoyee a l'API");
{
  const where = whereClause("69", 60, TODAY);
  check("filtre le departement", where.includes('numerodepartement="69"'));
  check("borne la fenetre a la bonne date", where.includes("date'2026-07-27'"), where);
  check("n'accepte que les familles retenues", where.includes("familleavis_lib in ("));
  for (const family of BODACC_FAMILIES) {
    check(`famille « ${family} » demandee`, where.includes(`"${family}"`));
  }
  check(
    "les procedures collectives ne sont jamais demandees",
    !where.includes("Procédures collectives"),
  );
  check("fenetre de 7 jours", sinceDate(7, TODAY) === "2026-09-18", sinceDate(7, TODAY));
}

console.log("\n6. France Travail : sans identifiants, la source se tait");
{
  const absent = franceTravailStatus({});
  check("aucun identifiant -> indisponible", !absent.available);
  check(
    "et la raison est affichable telle quelle",
    !absent.available && absent.reason === "identifiants à configurer",
  );
  check(
    "un seul des deux ne suffit pas",
    !franceTravailStatus({ FRANCE_TRAVAIL_CLIENT_ID: "x" }).available,
  );
  check(
    "chaine vide = absente",
    !franceTravailStatus({
      FRANCE_TRAVAIL_CLIENT_ID: "  ",
      FRANCE_TRAVAIL_CLIENT_SECRET: "y",
    }).available,
  );
  check(
    "les deux presents -> disponible",
    franceTravailStatus({
      FRANCE_TRAVAIL_CLIENT_ID: "x",
      FRANCE_TRAVAIL_CLIENT_SECRET: "y",
    }).available,
  );
}

console.log("\n7. Une offre d'emploi lisible");
{
  // « 69 - LYON 03 » : le prefixe departement est du bruit pour le rapprochement.
  check("prefixe departement retire", cityOf("69 - LYON 03") === "LYON 03", String(cityOf("69 - LYON 03")));
  check("libelle deja propre inchange", cityOf("Villeurbanne") === "Villeurbanne");
  check("libelle absent -> null", cityOf(null) === null);

  const offre = {
    intitule: "Ingénieur data",
    dateCreation: "2026-09-20T08:00:00.000Z",
    entreprise: { nom: "CYMATECH" },
    lieuTravail: { libelle: "69 - LYON 03", codePostal: "69003" },
    origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/x" },
  };
  check("offre nominative -> retenue", toJobSignal(offre) !== null);
  check("commune nettoyee", toJobSignal(offre)?.city === "LYON 03");
  // Une offre passee par un cabinet ne nomme pas l'entreprise : irrapprochable.
  check("offre anonyme -> ecartee", toJobSignal({ ...offre, entreprise: null }) === null);
  check("sans date -> ecartee", toJobSignal({ ...offre, dateCreation: null }) === null);

  const since = minCreationDate(30, TODAY);
  check("minCreationDate est un ISO complet en Z", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(since), since);
  check("et pointe 30 jours en arriere", since.startsWith("2026-08-26"), since);
}

console.log("\n8. Rang d'un candidat selon la tranche declaree");
{
  const cible = ["11", "12"];
  check("tranche visee -> confirme", tierOf("11", cible) === "en-tranche");
  check("autre tranche visee -> confirme", tierOf("12", cible) === "en-tranche");
  // 60 % des cas mesures : la tranche n'est pas declaree, seul Pappers tranchera.
  check("NN -> second rang, jamais un rejet", tierOf("NN", cible) === "tranche-inconnue");
  check("code absent -> second rang", tierOf(null, cible) === "tranche-inconnue");
  check("tranche hors cible -> rejete", tierOf("22", cible) === null);
  check("micro-entreprise rejetee", tierOf("01", cible) === null);
}

console.log("\n9. Rapprochement : le SIREN fait foi, sinon nom ET commune");
{
  const base = (over: Partial<CompanyBase> = {}): CompanyBase =>
    ({
      siren: "911864023",
      company_name: "CYMATECH",
      city: "Lyon",
      website: null,
      email: null,
      sector: null,
      size_range: null,
      postal_code: null,
      naf_code: null,
      naf_section: null,
      founded_year: null,
      legal_form: null,
      leader: null,
      leader_person: null,
      parent_company: null,
      ...over,
    }) as CompanyBase;

  const signal = (over: Partial<OfficialSignal> = {}): OfficialSignal => ({
    siren: "911864023",
    companyName: "CYMATECH",
    city: "Lyon",
    postalCode: "69003",
    sourceId: "bodacc",
    date: "2026-09-25",
    signal: { label: "x" },
    ...over,
  });

  check("meme SIREN -> confirme", confirmsMatch(signal(), base()));
  check("SIREN different -> refuse, meme si le nom colle", !confirmsMatch(signal(), base({ siren: "111111111" })));

  const offre = signal({ siren: null, sourceId: "france-travail" });
  check("sans SIREN : nom + commune identiques -> confirme", confirmsMatch(offre, base()));
  // L'homonyme : meme nom, autre ville. C'est le faux positif a ne pas refaire.
  check(
    "meme nom, autre commune -> refuse",
    !confirmsMatch(offre, base({ city: "Lille", siren: "111111111" })),
  );
  check(
    "commune manquante -> refuse (on ne devine pas)",
    !confirmsMatch(signal({ siren: null, city: null }), base()),
  );
  check(
    "nom sans rapport -> refuse",
    !confirmsMatch(signal({ siren: null, companyName: "TOTALEMENT AUTRE" }), base()),
  );
  check(
    "raison sociale plus longue que l'annuaire -> confirme",
    confirmsMatch(signal({ siren: null, companyName: "CYMATECH SAS" }), base()),
  );
}

console.log("\n10. Communes comparables malgre accents et arrondissements");
{
  check("accents ignores", normalizeCity("Civrieux-d'Azergues") === normalizeCity("CIVRIEUX D AZERGUES"));
  check("arrondissement ignore", normalizeCity("LYON 03") === normalizeCity("Lyon"));
  check("deux communes distinctes restent distinctes", normalizeCity("Lyon") !== normalizeCity("Lille"));
  check("valeur absente -> chaine vide", normalizeCity(null) === "");
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Mode « Signaux d'abord » — les regles qui decident ce qu'on paie et ce qu'on
 * met en avant.
 *
 * Tout ce qui est verrouille ici vient d'une observation sur l'API reelle
 * (300 annonces du Rhone, 150 offres France Travail, le 25/09/2026), pas d'une
 * lecture de documentation :
 *
 *   - `commercant` concatene TOUS les noms cites : sur une cession il vaut
 *     « ACQUEREUR, CEDANT », donc inutilisable comme raison sociale ;
 *   - `listepersonnes` designe l'entreprise concernee et porte son SIREN, son
 *     capital et ses dirigeants ; `listeprecedentproprietaire` porte le cedant ;
 *   - « Modification de l'administration » couvre aussi bien une nomination
 *     qu'un simple depart : seul le champ `administration` tranche ;
 *   - une offre d'emploi sur deux vient d'une agence d'interim, qui recrute
 *     pour quelqu'un d'autre.
 *
 * Execution : `npm run test:signaux`.
 */
import {
  BODACC_FAMILIES,
  compareNotices,
  groupBySiren,
  sinceDate,
  toNotice,
  whereClause,
  type BodaccNotice,
} from "../lib/signals/bodacc";
import {
  capitalOf,
  classify,
  companyNameOf,
  isLegalEntity,
  isNegativeNature,
  isSeller,
  newLeadersOf,
  sirenOf,
} from "../lib/signals/bodacc-parse";
import {
  cityOf,
  creationWindow,
  franceTravailStatus,
  looksLikeStaffingAgency,
  toJobSignal,
} from "../lib/signals/france-travail";
import {
  confirmsMatch,
  isStaffingNaf,
  normalizeCity,
  simplifyName,
  tierOf,
  type OfficialSignal,
} from "../lib/signals";
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

const person = (fields: Record<string, unknown>) => JSON.stringify({ personne: fields });

/** Une annonce complete et valide, que chaque test deforme a sa guise. */
const VALIDE = {
  registre: ["911864023", "911 864 023"],
  commercant: "CG CLINIC",
  ville: "Civrieux-d'Azergues",
  cp: "69380",
  familleavis_lib: "Modifications diverses",
  dateparution: "2026-09-25",
  listepersonnes: person({
    typePersonne: "pm",
    denomination: "CG CLINIC",
    numeroImmatriculation: { numeroIdentification: "911 864 023" },
  }),
  modificationsgenerales: JSON.stringify({ descriptif: "Modification du capital." }),
  url_complete: "https://www.bodacc.fr/x",
};

console.log("\n1. Identifier l'entreprise concernee");
{
  check("SIREN lu dans listepersonnes", sirenOf(VALIDE) === "911864023");
  check(
    "repli sur registre quand listepersonnes n'en a pas",
    sirenOf({ registre: ["911 864 023"], listepersonnes: person({ typePersonne: "pm" }) }) ===
      "911864023",
  );
  check("aucun numero -> null", sirenOf({ registre: null }) === null);
  check("SIRET a 14 chiffres n'est pas un SIREN", sirenOf({ registre: ["91186402300019"] }) === null);

  check("denomination preferee a commercant", companyNameOf(VALIDE) === "CG CLINIC");
  // Le piege : sur une cession, `commercant` vaut « ACQUEREUR, CEDANT ».
  check(
    "sur une cession, on ne prend PAS la concatenation de commercant",
    companyNameOf({
      commercant: "HMCM, HMBC",
      listepersonnes: person({ typePersonne: "pm", denomination: "HMCM" }),
    }) === "HMCM",
  );
  check(
    "sans listepersonnes, commercant sert de repli",
    companyNameOf({ commercant: "CYMATECH" }) === "CYMATECH",
  );

  check("personne morale -> gardee", isLegalEntity(VALIDE));
  check(
    "entrepreneur individuel -> ecarte",
    !isLegalEntity({ listepersonnes: person({ typePersonne: "pp", nom: "PAYET" }) }),
  );
  // Le doute profite a la cible : un appel de trop vaut mieux qu'une perte.
  check("champ absent -> gardee", isLegalEntity({}));
  check("JSON illisible -> gardee", isLegalEntity({ listepersonnes: "{ pas du json" }));

  check(
    "capital lu et converti",
    capitalOf({
      listepersonnes: person({ capital: { montantCapital: "110309747.00", devise: "EUR" } }),
    }) === 110309747,
  );
  check(
    "devise etrangere ignoree",
    capitalOf({ listepersonnes: person({ capital: { montantCapital: "1000", devise: "CHF" } }) }) ===
      null,
  );
  check("pas de capital -> null", capitalOf(VALIDE) === null);
}

console.log("\n2. Les dirigeants entrants, et eux seuls");
{
  const administration = (text: string) =>
    newLeadersOf({ listepersonnes: person({ administration: text }) });

  const simple = administration("NARBONNET Bernard Henri nom d'usage : NARBONNET devient gérant");
  check("une nomination est lue", simple.length === 1, JSON.stringify(simple));
  check("nom de famille", simple[0]?.surname === "NARBONNET", simple[0]?.surname);
  check("prenom d'usage", simple[0]?.firstName === "Bernard", simple[0]?.firstName);
  check("role", simple[0]?.role === "gérant", simple[0]?.role);

  // Le discriminant : un depart n'est PAS un nouveau dirigeant.
  const depart = administration("RUBIN Charles n'est plus gérant");
  check("un depart seul ne produit aucun dirigeant", depart.length === 0, JSON.stringify(depart));

  const mixte = administration(
    "DUTEL Marion Bénédicte nom d'usage : DUTEL n'est plus président. DUTEL Marion Bénédicte nom d'usage : DUTEL devient gérant",
  );
  check("dans un texte mixte, seule la nomination compte", mixte.length === 1);

  const compose = administration(
    "LE PERFF Armelle Marie Brigitte nom d'usage : LE PERFF devient gérant",
  );
  check("nom de famille en deux mots", compose[0]?.surname === "LE PERFF", compose[0]?.surname);
  check("prenom apres un nom compose", compose[0]?.firstName === "Armelle");

  // La source contient la coquille « non d'usage » : elle ne doit pas polluer
  // le nom de famille.
  const coquille = administration("RUBIN Charles non d'usage : RUBIN Charles devient gérant");
  check("coquille « non d'usage » absorbee", coquille[0]?.surname === "RUBIN", coquille[0]?.surname);

  check("champ vide -> aucun dirigeant", administration("").length === 0);
  check("champ absent -> aucun dirigeant", newLeadersOf({}).length === 0);
}

console.log("\n3. Cedant ou acquereur d'un fonds");
{
  const cession = {
    familleavis_lib: "Ventes et cessions",
    dateparution: "2026-09-20",
    commercant: "HMCM, HMBC",
    listepersonnes: person({
      typePersonne: "pm",
      denomination: "HMCM",
      numeroImmatriculation: { numeroIdentification: "103 179 560" },
    }),
    listeprecedentproprietaire: person({
      typePersonne: "pm",
      denomination: "HMBC",
      numeroImmatriculation: { numeroIdentification: "849 979 216" },
    }),
  };

  check("l'acquereur n'est pas le cedant", !isSeller(cession));
  check("l'annonce vise bien l'acquereur", sirenOf(cession) === "103179560");
  check("et le fait remonter comme signal", toNotice(cession) !== null);
  check("classee « fort »", toNotice(cession)?.strength === "fort");

  // Le meme fonds vu depuis le vendeur : ce n'est pas une cible, c'est une sortie.
  const vuDuCedant = {
    ...cession,
    listepersonnes: cession.listeprecedentproprietaire,
  };
  check("le cedant est detecte", isSeller(vuDuCedant));
  check("et l'annonce est ecartee", toNotice(vuDuCedant) === null);
}

console.log("\n4. Une fin n'est jamais un signal d'achat");
{
  check("dissolution", isNegativeNature("Dissolution sans liquidation de la société"));
  check("cessation d'activite", isNegativeNature("Cessation d'activité de la société."));
  check("liquidation", isNegativeNature("Jugement de liquidation"));
  check("radiation", isNegativeNature("Radiation du RCS"));
  check("cloture", isNegativeNature("Clôture pour insuffisance d'actif"));
  check("sauvegarde", isNegativeNature("Ouverture d'une procédure de sauvegarde"));
  check("redressement judiciaire", isNegativeNature("Jugement de redressement judiciaire"));

  check("augmentation de capital gardee", !isNegativeNature("Modification du capital."));
  check("nouveau siege garde", !isNegativeNature("Nouveau siège."));
  // L'absorbante d'une fusion est une cible, pas une fin.
  check(
    "fusion sans dissolution gardee",
    !isNegativeNature("Modification du capital. Sociétés ayant participé à l'opération de fusion"),
  );
  check("nature absente", !isNegativeNature(null));

  check(
    "annonce de dissolution ecartee avant tout appel payant",
    toNotice({
      ...VALIDE,
      modificationsgenerales: JSON.stringify({ descriptif: "Dissolution de la société" }),
    }) === null,
  );
}

console.log("\n5. Le bareme de force");
{
  const leader = [{ surname: "NARBONNET", firstName: "Bernard", role: "gérant" }];
  const fort = classify("Modifications diverses", "Modification de l'administration.", leader, false);
  check("nouveau dirigeant -> fort", fort?.strength === "fort");
  check("type « direction »", fort?.signalType === "direction", fort?.signalType);
  check("libelle nomme la personne", fort?.label.includes("Bernard NARBONNET") === true, fort?.label);

  // Meme descriptif, aucun entrant : ce n'est plus un changement de tete.
  const depart = classify("Modifications diverses", "Modification de l'administration.", [], false);
  check("depart seul -> pas « fort »", depart?.strength !== "fort", depart?.strength);

  check(
    "capital -> fort",
    classify("Modifications diverses", "Modification du capital.", [], false)?.strength === "fort",
  );
  check("reprise de fonds -> fort", classify("Ventes et cessions", null, [], false)?.strength === "fort");
  check(
    "nouvel etablissement -> moyen",
    classify("Modifications diverses", "Nouvel établissement principal.", [], false)?.strength ===
      "moyen",
  );
  check(
    "transfert de siege -> moyen",
    classify("Modifications diverses", "Nouveau siège.", [], false)?.strength === "moyen",
  );
  check("immatriculation -> moyen", classify("Créations", null, [], false)?.strength === "moyen");
  check(
    "denomination -> faible",
    classify("Modifications diverses", "Modification de la dénomination.", [], false)?.strength ===
      "faible",
  );
  check(
    "forme juridique -> faible",
    classify("Modifications diverses", "Modification de la forme juridique.", [], false)?.strength ===
      "faible",
  );
  check(
    "objet social -> faible",
    classify("Modifications diverses", "Modification de l'activité.", [], false)?.strength === "faible",
  );
  check(
    "dissolution -> ecartee",
    classify("Modifications diverses", "Dissolution de la société.", [], false) === null,
  );
  check("cedant -> ecarte", classify("Ventes et cessions", null, [], true) === null);
}

console.log("\n6. Plusieurs annonces pour une meme entreprise");
{
  const notice = (siren: string, strength: string, date: string): BodaccNotice =>
    ({
      siren,
      companyName: "X",
      city: null,
      postalCode: null,
      family: "Modifications diverses",
      strength,
      signalType: "presse",
      label: `${strength} du ${date}`,
      nature: null,
      publishedAt: date,
      newLeaders: [],
      capitalAmount: null,
      url: "https://x",
    }) as BodaccNotice;

  const groups = groupBySiren([
    notice("111111111", "faible", "2026-09-24"),
    notice("111111111", "fort", "2026-09-01"),
    notice("222222222", "moyen", "2026-09-20"),
  ]);
  check("une entree par entreprise", groups.size === 2, String(groups.size));
  check("les deux annonces sont conservees", (groups.get("111111111") ?? []).length === 2);
  // Le point qui compte : la plus FORTE donne l'angle, meme si elle est plus
  // ancienne qu'une anecdote publiee hier.
  check(
    "la plus forte passe devant la plus recente",
    groups.get("111111111")?.[0]?.strength === "fort",
    groups.get("111111111")?.[0]?.strength,
  );
  check(
    "a force egale, la plus recente d'abord",
    compareNotices(notice("1", "fort", "2026-09-01"), notice("1", "fort", "2026-09-20")) > 0,
  );
}

console.log("\n7. La clause envoyee a l'API");
{
  const where = whereClause("69", 60, TODAY);
  check("filtre le departement", where.includes('numerodepartement="69"'));
  check("borne la fenetre a la bonne date", where.includes("date'2026-07-27'"), where);
  for (const family of BODACC_FAMILIES) {
    check(`famille « ${family} » demandee`, where.includes(`"${family}"`));
  }
  check("les procedures collectives ne sont jamais demandees", !where.includes("Procédures"));
  check("les depots de comptes non plus", !where.includes("Dépôts"));
  check("fenetre de 7 jours", sinceDate(7, TODAY) === "2026-09-18", sinceDate(7, TODAY));
}

console.log("\n8. France Travail : identifiants et fenetre");
{
  const absent = franceTravailStatus({});
  check("aucun identifiant -> indisponible", !absent.available);
  check(
    "raison affichable telle quelle",
    !absent.available && absent.reason === "identifiants à configurer",
  );
  check(
    "un seul des deux ne suffit pas",
    !franceTravailStatus({ FRANCE_TRAVAIL_CLIENT_ID: "x" }).available,
  );
  check(
    "chaine vide = absente",
    !franceTravailStatus({ FRANCE_TRAVAIL_CLIENT_ID: "  ", FRANCE_TRAVAIL_CLIENT_SECRET: "y" })
      .available,
  );
  check(
    "les deux presents -> disponible",
    franceTravailStatus({ FRANCE_TRAVAIL_CLIENT_ID: "x", FRANCE_TRAVAIL_CLIENT_SECRET: "y" })
      .available,
  );

  // L'API refuse minCreationDate sans maxCreationDate (HTTP 400 mesure) : les
  // deux bornes doivent toujours partir ensemble.
  const window = creationWindow(30, TODAY);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  check("borne basse au format ISO en Z", iso.test(window.min), window.min);
  check("borne haute au format ISO en Z", iso.test(window.max), window.max);
  check("la basse pointe 30 jours en arriere", window.min.startsWith("2026-08-26"), window.min);
  check("la haute est le moment de l'appel", window.max.startsWith("2026-09-25"), window.max);
}

console.log("\n9. Un intermediaire n'est pas l'employeur");
{
  for (const name of [
    "APROJOB LYON",
    "Randstad professional",
    "MICHAEL PAGE ADVERTISING",
    "Gojob",
    "RAS INTERIM JERECRUTE",
    "ACTUAL LEADER",
    "Cabinet de recrutement Dupont",
  ]) {
    check(`« ${name} » ecarte`, looksLikeStaffingAgency(name));
  }
  for (const name of ["CYMATECH", "IRIUM SOFTWARE", "SUN'R GROUPE", "L'UZYNE"]) {
    check(`« ${name} » garde`, !looksLikeStaffingAgency(name));
  }
  // Sans bornes de mot, « crit » attraperait « decrit » : le piege est reel.
  check("« Décrit Solutions » garde", !looksLikeStaffingAgency("Décrit Solutions"));
}

console.log("\n10. Une offre d'emploi lisible");
{
  check(
    "prefixe departement retire",
    cityOf("69 - LYON 03") === "LYON 03",
    String(cityOf("69 - LYON 03")),
  );
  check("libelle deja propre inchange", cityOf("Villeurbanne") === "Villeurbanne");
  check("libelle absent -> null", cityOf(null) === null);

  const offre = {
    intitule: "Ingénieur data",
    dateCreation: "2026-09-20T08:00:00.000Z",
    entreprise: { nom: "CYMATECH" },
    lieuTravail: { libelle: "69 - LYON 03", codePostal: "69003" },
    origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/x" },
  };
  check("offre nominative retenue", toJobSignal(offre) !== null);
  check("commune nettoyee", toJobSignal(offre)?.city === "LYON 03");
  // Une offre passee par un cabinet ne nomme pas l'entreprise : irrapprochable.
  check("offre anonyme ecartee", toJobSignal({ ...offre, entreprise: null }) === null);
  check("sans date ecartee", toJobSignal({ ...offre, dateCreation: null }) === null);
}

console.log("\n11. Rang d'un candidat selon la tranche declaree");
{
  const cible = ["11", "12"];
  check("tranche visee -> confirme", tierOf("11", cible) === "en-tranche");
  // 60 % des cas mesures : la tranche n'est pas declaree, seul Pappers tranchera.
  check("NN -> second rang, jamais un rejet", tierOf("NN", cible) === "tranche-inconnue");
  check("code absent -> second rang", tierOf(null, cible) === "tranche-inconnue");
  check("tranche hors cible -> rejete", tierOf("22", cible) === null);
  check("micro-entreprise rejetee", tierOf("01", cible) === null);
}

console.log("\n12. Rapprochement : le SIREN fait foi, sinon nom ET commune");
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
    strength: "fort",
    signals: [{ label: "x" }],
    newLeaders: [],
    capitalAmount: null,
    ...over,
  });

  check("meme SIREN -> confirme", confirmsMatch(signal(), base()));
  check(
    "SIREN different -> refuse, meme si le nom colle",
    !confirmsMatch(signal(), base({ siren: "111111111" })),
  );

  const offre = signal({ siren: null, sourceId: "france-travail" });
  check("sans SIREN : le nom suffit", confirmsMatch(offre, base()));

  // Le piege corrige : l'annuaire rend la commune du SIEGE, l'offre le LIEU DE
  // TRAVAIL. IRIUM SOFTWARE siege a Tille et recrute a Lyon. Exiger l'egalite
  // des communes ne laissait passer qu'une offre sur douze.
  check(
    "siege ailleurs que le lieu de travail -> confirme quand meme",
    confirmsMatch(offre, base({ siren: null, city: "Tille" })),
  );
  check(
    "commune absente -> le nom decide seul",
    confirmsMatch(signal({ siren: null, city: null }), base()),
  );
  check(
    "nom sans rapport -> refuse",
    !confirmsMatch(signal({ siren: null, companyName: "TOTALEMENT AUTRE" }), base()),
  );
  check(
    "forme juridique ignoree",
    confirmsMatch(signal({ siren: null, companyName: "CYMATECH SAS" }), base()),
  );
  // La confirmation geographique vient du filtre DEPARTEMENT de l'annuaire,
  // qui porte sur les etablissements : un homonyme situe ailleurs ne remonte
  // pas du tout, donc il n'arrive jamais jusqu'ici.
  check("nom simplifie comparable", simplifyName("CYMATECH SAS") === simplifyName("Cymatech"));
  check(
    "deux raisons sociales distinctes restent distinctes",
    simplifyName("FOKUS") !== simplifyName("FOCUS GROUPE"),
  );
}

console.log("\n12bis. Une agence d'emploi n'est pas l'employeur");
{
  check("agence de travail temporaire ecartee", isStaffingNaf("78.20Z"));
  check("agence de placement ecartee", isStaffingNaf("7810Z"));
  check("mise a disposition de personnel ecartee", isStaffingNaf("78.30z"));
  check("un editeur de logiciel est garde", !isStaffingNaf("62.01Z"));
  check("code absent -> garde", !isStaffingNaf(null));
}

console.log("\n13. Communes comparables malgre accents et arrondissements");
{
  check(
    "accents ignores",
    normalizeCity("Civrieux-d'Azergues") === normalizeCity("CIVRIEUX D AZERGUES"),
  );
  check("arrondissement numerique ignore", normalizeCity("LYON 03") === normalizeCity("Lyon"));
  // France Travail ecrit « Lyon 1er Arrondissement » : sans ce nettoyage, tout
  // le bassin lyonnais et tout Paris etaient irrapprochables.
  check(
    "arrondissement en clair ignore",
    normalizeCity("Lyon 1er Arrondissement") === normalizeCity("Lyon"),
    normalizeCity("Lyon 1er Arrondissement"),
  );
  check(
    "et la forme parisienne aussi",
    normalizeCity("Paris 15e Arrondissement") === normalizeCity("Paris"),
    normalizeCity("Paris 15e Arrondissement"),
  );
  check("deux communes distinctes restent distinctes", normalizeCity("Lyon") !== normalizeCity("Lille"));
  check("valeur absente -> chaine vide", normalizeCity(null) === "");
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

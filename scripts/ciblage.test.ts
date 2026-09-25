/**
 * Ciblage : qui n'est pas un prospect.
 *
 * Ces regles decident ce qu'on DEPENSE : elles s'appliquent avant l'ouverture
 * d'une fiche Pappers. Une exclusion trop large coute des cibles, une exclusion
 * trop etroite coute des appels — les deux sont verrouilles ici.
 *
 * Le referentiel INSEE des categories juridiques est hierarchique, d'ou le
 * filtrage par PREFIXE : l'INSEE ajoute des codes, et une liste fermee aurait
 * laisse passer les nouveaux en silence.
 *
 * Execution : `npm run test:ciblage`.
 */
import {
  DEFAULT_EXCLUDED_SECTORS,
  EXCLUDED_LEGAL_PREFIXES,
  exclusionOf,
  matchesExcludedSector,
  normalizeNaf,
} from "../lib/signals/targeting";
import { MAX_EXCLUDED_SECTORS, cleanSectors } from "../lib/signals/settings";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Entreprise minimale, telle que l'annuaire la rend. */
const company = (over: {
  name?: string;
  naf?: string | null;
  legal?: string | null;
  effectif?: string | null;
  legalForm?: string | null;
}) => ({
  company_name: over.name ?? "CYMATECH",
  naf_code: over.naf ?? "6201Z",
  legal_form: over.legalForm ?? "Société par actions simplifiée",
  figures: { legal_code: over.legal ?? "5710", effectif_code: over.effectif ?? "11" },
});

console.log("\n1. Codes NAF comparables quelle que soit l'ecriture");
{
  check("point retire", normalizeNaf("85.53Z") === "8553Z");
  check("casse normalisee", normalizeNaf("8553z") === "8553Z");
  check("espaces retires", normalizeNaf(" 71.20 A ") === "7120A");
  check("valeur absente -> chaine vide", normalizeNaf(null) === "");
}

console.log("\n2. Un prefixe suffit, et il porte loin");
{
  check("code complet", matchesExcludedSector("8553Z", ["8553Z"]) === "8553Z");
  check("ecriture differente des deux cotes", matchesExcludedSector("85.53Z", ["8553z"]) === "8553z");
  // Le point qui compte : un prefixe court vise un pan entier.
  check("classe", matchesExcludedSector("8553Z", ["8553"]) === "8553");
  check("division vise tout l'enseignement", matchesExcludedSector("8559A", ["85"]) === "85");
  check("hors liste -> garde", matchesExcludedSector("6201Z", ["8553Z", "7120A"]) === null);
  check("liste vide -> garde", matchesExcludedSector("8553Z", []) === null);
  check("code absent -> garde", matchesExcludedSector(null, ["85"]) === null);
}

console.log("\n3. Structures ecartees d'office");
{
  check("association declaree (9220)", exclusionOf(company({ legal: "9220" }))?.kind === "structure");
  check("syndicat professionnel (9260)", exclusionOf(company({ legal: "9260" }))?.kind === "structure");
  check("fondation (9300)", exclusionOf(company({ legal: "9300" }))?.kind === "structure");
  check("commune (7210)", exclusionOf(company({ legal: "7210" }))?.kind === "structure");
  check("etablissement public (7389)", exclusionOf(company({ legal: "7389" }))?.kind === "structure");
  check("organisme prive specialise (8110)", exclusionOf(company({ legal: "8110" }))?.kind === "structure");

  // Le voisinage immediat des prefixes exclus doit passer : 6xxx et 5xxx sont
  // des societes, et 9100 (syndicat de coproprietaires) n'est pas demande.
  check("SAS (5710) -> gardee", exclusionOf(company({ legal: "5710" })) === null);
  check("SARL (5499) -> gardee", exclusionOf(company({ legal: "5499" })) === null);
  check("autre personne morale au RCS (6540) -> gardee", exclusionOf(company({ legal: "6540" })) === null);
  check("syndicat de coproprietaires (9110) -> garde", exclusionOf(company({ legal: "9110" })) === null);

  check("la raison nomme l'entreprise", exclusionOf(company({ legal: "9220", name: "LES AMIS DU PARC" }))?.reason.includes("LES AMIS DU PARC") === true);
  check(
    "et dit la forme juridique lisible",
    exclusionOf(company({ legal: "9220", legalForm: "Association déclarée" }))?.reason.includes(
      "Association déclarée",
    ) === true,
  );
  check("categorie absente -> gardee", exclusionOf(company({ legal: null })) === null);

  check("tous les prefixes documentes sont testes", EXCLUDED_LEGAL_PREFIXES.length === 4);
}

console.log("\n4. Entreprise individuelle sans salarie");
{
  check(
    "EI a zero salarie -> ecartee",
    exclusionOf(company({ legal: "1000", effectif: "00" }))?.reason.includes("sans salarié") === true,
  );
  // `NN` pour un EI veut dire qu'aucune masse salariale n'est declaree.
  check("EI sans tranche declaree -> ecartee", exclusionOf(company({ legal: "1000", effectif: "NN" })) !== null);
  // Un EI qui emploie, lui, est une cible.
  check("EI de 10 a 19 salaries -> gardee", exclusionOf(company({ legal: "1000", effectif: "11" })) === null);
  // La regle ne doit PAS s'etendre aux societes : pour elles, `NN` est un doute
  // qui profite a la cible, tranche plus tard par l'effectif reel.
  check("societe sans tranche declaree -> gardee", exclusionOf(company({ legal: "5710", effectif: "NN" })) === null);
}

console.log("\n5. Secteur exclu");
{
  const sectors = [...DEFAULT_EXCLUDED_SECTORS];
  check("auto-ecole ecartee", exclusionOf(company({ naf: "8553Z" }), sectors)?.kind === "secteur");
  check("controle technique ecarte", exclusionOf(company({ naf: "7120A" }), sectors)?.kind === "secteur");
  check("editeur de logiciel garde", exclusionOf(company({ naf: "6201Z" }), sectors) === null);
  check(
    "la raison nomme le code saisi",
    exclusionOf(company({ naf: "8553Z" }), sectors)?.reason.includes("8553Z") === true,
  );

  // Ordre des motifs : la structure est plus dirimante et plus parlante.
  const both = exclusionOf(company({ legal: "9220", naf: "8553Z" }), sectors);
  check("une association dans un secteur exclu est d'abord une association", both?.kind === "structure");

  check("deux secteurs par defaut", DEFAULT_EXCLUDED_SECTORS.length === 2);
}

console.log("\n6. Nettoyage de la liste saisie a la main");
{
  check("normalisation", cleanSectors(["85.53z"])[0] === "8553Z");
  check("doublons absorbes", cleanSectors(["8553Z", "85.53z", " 8553 Z "]).length === 1);
  check("entrees vides ecartees", cleanSectors(["", "   ", "8553Z"]).length === 1);
  check("valeurs non textuelles ignorees", cleanSectors([42, null, { a: 1 }, "8553Z"]).length === 1);
  // Un prefixe d'un seul caractere viserait des pans entiers de l'economie sur
  // une faute de frappe : refuse.
  check("prefixe trop court refuse", cleanSectors(["8"]).length === 0);
  check("division de deux chiffres acceptee", cleanSectors(["85"])[0] === "85");
  check(
    "liste plafonnee",
    cleanSectors(Array.from({ length: 200 }, (_, i) => `${1000 + i}`)).length <= MAX_EXCLUDED_SECTORS,
  );
  check("liste vide reste vide", cleanSectors([]).length === 0);
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

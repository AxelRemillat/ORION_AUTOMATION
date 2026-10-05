/**
 * SALUTATION — « Bonjour Monsieur Briol, » dès que le dirigeant est connu.
 *
 * Les mails écrits à la main commencent tous ainsi, y compris quand l'adresse
 * est générique (contact@) : le dirigeant la lit, ou la fait suivre. Un
 * « Bonjour, » anonyme alors qu'on connaît son nom sonne comme un publipostage.
 *
 * Deux difficultés, réglées ici et nulle part ailleurs :
 * - le NOM D'USAGE : « Marie DUPONT épouse MARTIN » et « Marie MARTIN née
 *   DUPONT » s'adressent toutes deux « Madame Martin » ;
 * - la CIVILITÉ : aucune source ne donne le sexe. On la déduit d'une liste de
 *   prénoms courants ; un prénom inconnu ou mixte donne « Bonjour Camille
 *   Martin, » plutôt qu'un « Monsieur » faux.
 *
 * Module pur : importable côté client et dans les tests.
 */

export interface Person {
  first: string;
  /** Nom d'usage, en casse naturelle. */
  last: string;
}

/** « DUPONT » → « Dupont », « LE GALL » → « Le Gall », « DE LA FONTAINE » → « de La Fontaine ». */
export function naturalCase(value: string): string {
  const particles = new Set(["de", "du", "des", "d'"]);
  return value
    .trim()
    .split(/\s+/)
    .map((word, index, words) => {
      const lower = word.toLowerCase();
      // Particule en tête d'un nom de plusieurs mots aussi : « Monsieur de La Fontaine ».
      if (particles.has(lower) && (index > 0 || words.length > 1)) return lower;
      return lower.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
    })
    .join(" ");
}

const isUpper = (word: string) => word.length > 1 && word === word.toUpperCase() && /\p{L}/u.test(word);

/**
 * Prénom et NOM D'USAGE d'une personne telle que l'écrivent le registre ou Hunter.
 *
 * - « X épouse Y », « X ep. Y », « X veuve Y » → nom d'usage Y ;
 * - « Y née X » → nom d'usage Y (ce qui précède « née ») ;
 * - noms du registre en capitales : « Jean LE GALL » → « Le Gall » ;
 * - sinon, le dernier mot est le nom, le premier le prénom.
 */
const NAME_PARTICLES = new Set(["de", "du", "des", "d'", "d’", "van", "von", "le", "la"]);

/**
 * Un nom d'usage COMPLET ? Le 05/10/2026, FONDERIE DE LA BRUCHE est sortie
 * « Bonjour Madame Danancher-, » : la fiche portait « Danancher-(attard) »
 * (registre : « DANANCHER (ATTARD) »), et le retrait des parenthèses laissait
 * un nom coupé. Un nom qui finit ou commence par un trait d'union ou une
 * apostrophe, qui garde une parenthèse ou un chiffre, n'est pas sûr : on
 * salue alors par la seule civilité (« Bonjour Madame, »).
 */
export function isCompleteName(last: string | null | undefined): boolean {
  const value = (last ?? "").trim();
  if (value.length < 2) return false;
  if (/^[-'’]|[-'’]$/.test(value)) return false;
  if (/[()[\]\d]/.test(value)) return false;
  return /\p{L}{2}/u.test(value);
}

export function usagePerson(fullName: string | null | undefined): Person | null {
  if (!fullName?.trim()) return null;
  let text = fullName.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();

  const married = text.match(/^(.*?)\s+(?:[ée]pouse|ep\.?|veuve|vve)\s+(.+)$/i);
  let usage: string | null = null;
  if (married) {
    text = married[1];
    usage = married[2];
  }
  const born = text.match(/^(.*?)\s+n[ée]e?\s+.+$/i);
  if (born) text = born[1];

  const words = text.split(" ").filter(Boolean);
  if (!words.length) return null;

  // Registre : prénoms en casse naturelle, NOM en capitales.
  const upperStart = words.findIndex((word, index) => index > 0 && isUpper(word) && words.slice(index).every(isUpper));
  // Casse naturelle : un nom à particule commence à la particule (« Jean de La Fontaine »).
  const particleStart = words.findIndex((word, index) => index > 0 && index < words.length - 1 && NAME_PARTICLES.has(word.toLowerCase()));
  const first = words[0];
  const last =
    usage ??
    (upperStart > 0
      ? words.slice(upperStart).join(" ")
      : particleStart > 0
        ? words.slice(particleStart).join(" ")
        : words.length > 1
          ? words[words.length - 1]
          : null);
  if (!last) return null;
  return { first: naturalCase(first), last: naturalCase(last) };
}

const strip = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[-\s]/)[0];

/* Prénoms courants chez les dirigeants de PME françaises. Les prénoms mixtes
 * (Camille, Dominique, Claude…) sont volontairement absents. */
const MALE = new Set(
  (
    "alain alexandre alexis andre antoine arnaud arthur augustin aurelien baptiste benjamin benoit bernard bertrand bruno " +
    "cedric charles christian christophe clement cyril damien daniel david denis didier dimitri eric emmanuel etienne fabien " +
    "fabrice florent florian francis francois franck frederic gael gerard gilbert gilles gregory guillaume guy henri herve " +
    "hugo hugues jacques jean jeremy jerome joel jonathan jordan joseph julien kevin laurent leo lionel loic louis lucas " +
    "ludovic marc marcel mathieu matthieu maxime michel mickael nathan nicolas olivier pascal patrice patrick paul philippe " +
    "pierre quentin raphael regis remi renaud richard robert roger romain samuel sebastien serge simon stephane sylvain " +
    "thibault thierry thomas tony valentin victor vincent xavier yann yannick yves"
  ).split(" "),
);
const FEMALE = new Set(
  (
    "agnes alexandra alice amandine amelie anne annie audrey aurelie beatrice brigitte carole caroline catherine cecile " +
    "celine chantal charlotte chloe christelle christine claire clara corinne delphine elisabeth elise elodie emilie emma " +
    "estelle eva fabienne florence francoise gaelle helene isabelle jeanne jessica josiane julie juliette karine laetitia " +
    "laura laure laurence lea lucie lydie magali manon marie marine marion martine mathilde melanie monique muriel " +
    "nadia nathalie nicole oceane pascale patricia pauline sabine sandra sandrine sarah severine sophie stephanie sylvie " +
    "valerie veronique virginie"
  ).split(" "),
);

/** « Monsieur », « Madame », ou `null` quand le prénom ne permet pas de trancher. */
export function civilityFor(firstName: string): "Monsieur" | "Madame" | null {
  const key = strip(firstName);
  if (MALE.has(key)) return "Monsieur";
  if (FEMALE.has(key)) return "Madame";
  return null;
}

/**
 * LE TITULAIRE DE L'ADRESSE, déduit de l'adresse elle-même.
 *
 * Le mail arrive dans UNE boîte. Saluer le dirigeant quand l'adresse est
 * `j.benes@` revient à écrire à quelqu'un d'autre que son lecteur — le juge de
 * l'évaluation l'a relevé sur BRIOL DIFFUSION le 28/09/2026.
 *
 * On ne devine que ce qui est lisible : « j.benes » donne un nom de famille et
 * une initiale, jamais une civilité. Sans civilité, c'est « Bonjour, » — mieux
 * vaut neutre que « Monsieur » adressé à une femme.
 *
 * Rend `null` pour une adresse de service (contact@, info@) : là, c'est le
 * dirigeant qu'on nomme.
 */
const GENERIC_LOCAL =
  /^(contact|info|infos|accueil|bonjour|hello|mail|email|secretariat|admin|administration|compta|comptabilite|facturation|commercial|commande|commandes|vente|ventes|devis|sav|service|support|direction|gerance|bureau|agence|atelier|boutique|magasin|recrutement|rh|jobs|emploi|reservation|std|standard)[0-9._-]*$/i;

export function addresseeOf(email: string | null | undefined): Person | null {
  const local = (email ?? "").trim().toLowerCase().split("@")[0];
  if (!local || GENERIC_LOCAL.test(local)) return null;

  // « jean.vacherand-granger@ » : le point sépare prénom et nom, le trait
  // d'union appartient au NOM composé (avant : « Granger » seul).
  const dotted = /[._]/.test(local);
  const parts = local.split(dotted ? /[._]+/ : /[._-]+/).filter(Boolean);
  if (!parts.length) return null;
  // « jbenes » sans séparateur : on ne sait pas où finit le prénom.
  if (parts.length === 1) return parts[0].length >= 4 ? { first: "", last: naturalCase(parts[0]) } : null;

  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  if (last.length < 3) return null;
  return { first: first.length >= 3 ? naturalCase(first) : "", last: naturalCase(last) };
}

/** La salutation complète pour une personne connue, ou « Bonjour, ». */
export function salutationFor(fullName: string | null | undefined): string {
  const person = usagePerson(fullName);
  if (!person) return "Bonjour,";
  const civility = civilityFor(person.first);
  if (civility && !isCompleteName(person.last)) return `Bonjour ${civility},`;
  /*
   * JAMAIS le prénom seul, jamais « Bonjour Prénom Nom ».
   *
   * Sur GLOBAL 2F, le mail ouvrait « Bonjour Birama, » : un prénom inconnu de la
   * table des civilités tombait dans un repli familier, que personne n'écrit à
   * un dirigeant qu'il ne connaît pas. Sans civilité sûre, on reste neutre.
   */
  return civility ? `Bonjour ${civility} ${person.last},` : "Bonjour,";
}

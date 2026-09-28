/**
 * Nom du dirigeant tel qu'il signe ses mails : le NOM D'USAGE.
 *
 * Le registre donne souvent le nom de naissance à côté du nom d'usage :
 * « BRIOL Séverine née NASSIF », « Séverine NASSIF épouse BRIOL ». Hunter
 * cherche une adresse sur le nom qui figure dans l'adresse — le nom d'usage.
 * Chercher « nassif@ » ne trouverait jamais rien.
 */

const cap = (value: string) =>
  value
    .toLowerCase()
    .split(/([\s-])/)
    .map((part) => (/[\s-]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");

/** Un mot tout en capitales est un nom de famille dans les écritures du registre. */
const isUpper = (word: string) => word.length > 1 && word === word.toUpperCase() && /\p{L}/u.test(word);

export interface PersonName {
  firstName: string;
  lastName: string;
}

/**
 * Découpe un nom complet du registre en prénom + nom d'usage.
 *
 *   « BRIOL Séverine née NASSIF »      → Séverine Briol
 *   « Séverine NASSIF épouse BRIOL »   → Séverine Briol
 *   « Jean-Pierre MARTIN »             → Jean-Pierre Martin
 *   « Martin Dupont »                  → Martin Dupont (ordre prénom nom)
 */
export function usageName(
  fullName: string | null | undefined,
  /**
   * Prénom connu par ailleurs (champ « prénom » de Pappers). Indispensable
   * quand la source a normalisé la casse — « Briol Séverine Née Nassif » :
   * sans majuscules, rien ne dit lequel des deux mots est le nom.
   */
  hint: { firstName?: string | null } = {},
): PersonName | null {
  const raw = (fullName ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  // « épouse X » / « ép. X » : X est le nom d'usage, il remplace tout le reste.
  const married = raw.match(/^(.*?)\s+(?:épouse|epouse|ép\.?|ep\.?)\s+(.+)$/i);
  // « née X » / « né X » : X est le nom de naissance, on le retire.
  const born = raw.match(/^(.*?)\s+(?:née|nee|né|ne)\s+\S.*$/i);

  let words: string[];
  let usage: string | null = null;
  if (married) {
    words = married[1].split(" ");
    usage = married[2].trim();
  } else if (born) {
    words = born[1].split(" ");
  } else {
    words = raw.split(" ");
  }

  // Lettres seules : « Mathieu, » et « Mathieu » doivent se reconnaitre.
  const plain = (value: string) =>
    value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z-]/g, "");
  const known = hint.firstName ? plain(hint.firstName).split(/[\s-]+/)[0] : null;
  if (known && !usage) {
    const rest = words.filter((word) => plain(word).split("-")[0] !== known);
    if (rest.length && rest.length < words.length) {
      /*
       * LES DEUXIÈMES PRÉNOMS NE SONT PAS DES NOMS DE FAMILLE.
       *
       * « Mathieu Robert Alain BONNIN » donnait « Mathieu » + « Robert Alain
       * Bonnin », et Hunter cherchait une adresse sur ce nom-là. Le nom de
       * famille, ce sont les mots en CAPITALES quand la source en a gardé —
       * c'est l'écriture du registre — sinon le DERNIER mot.
       */
      const upperRest = rest.filter(isUpper);
      const family = upperRest.length ? upperRest.join(" ") : rest[rest.length - 1];
      return { firstName: cap(hint.firstName!.split(" ")[0]), lastName: cap(family) };
    }
  }

  const upper = words.filter(isUpper);
  const lower = words.filter((word) => !isUpper(word));
  let first: string;
  let last: string;
  if (usage) {
    first = lower.join(" ") || words[0];
    last = usage;
  } else if (upper.length && lower.length) {
    first = lower.join(" ");
    last = upper.join(" ");
  } else if (words.length >= 2) {
    first = words[0];
    last = words.slice(1).join(" ");
  } else {
    return null;
  }
  first = first.split(" ")[0];
  if (!first || !last) return null;
  return { firstName: cap(first), lastName: cap(last) };
}

import { civilityFor } from "@/lib/emails/salutation";

/**
 * NOMS + FONCTIONS lus sur le site de l'entreprise (06/10/2026, Cowork #32).
 *
 * Hunter ne connaît pas tout le monde : sur 5 fiches, 2 seulement avaient une
 * adresse nominative chez lui. Le site, lui, nomme souvent ses gens — page
 * équipe, contact, à propos, mentions légales (« Directeur de la publication :
 * Jean Dupont »). Ces noms deviennent des candidats pour l'Email Finder, ou pour
 * le schéma d'adresse du domaine (« {first}.{last} »), TOUJOURS vérifiés.
 *
 * Module PUR. Un nom n'est retenu que si son PRÉNOM est connu (table des
 * civilités) : « Service Commercial » ou « Mentions Légales » ne sont pas des
 * personnes.
 */

export interface SitePerson {
  firstName: string;
  lastName: string;
  /** Fonction telle qu'écrite sur le site. */
  role: string;
  /** Page où le nom a été lu. */
  url: string;
}

const ROLE_WORDS =
  "directeur|directrice|responsable|g[ée]rante?|pr[ée]sidente?|p\\.?d\\.?g\\.?|\\bdg\\b|\\bdaf\\b|\\bceo\\b|\\bcfo\\b|\\bcoo\\b|fondat(?:eur|rice)|co-?fondat(?:eur|rice)|associ[ée]e?|chef|charg[ée]e?|assistante?|comptable|comptabilit[ée]|commerciale?|office manager|attach[ée]e? commercial|ing[ée]nieur commercial|technico-commercial|sales manager|account manager|adv\\b";
const ROLE = new RegExp(`(?:${ROLE_WORDS})[^\\n:|•]{0,50}`, "i");

/** Un mot de nom : capitale initiale (Dupont, DUPONT, Le Gall, d'Arc, Dupont-Martin). */
const NAME_WORD = "(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+)";
const PARTICLE = "(?:de|du|des|d['’]|le|la|van|von)";
const PERSON = `(${NAME_WORD})\\s+((?:${PARTICLE}\\s*)?${NAME_WORD}(?:\\s+${NAME_WORD})?)`;

const NAME_THEN_ROLE = new RegExp(`(?:^|[\\s(])${PERSON}\\s*(?:[,–—:|-]|\\s)\\s*(${ROLE.source})`, "g");
const ROLE_THEN_NAME = new RegExp(`(${ROLE.source}?)\\s*[:–—-]\\s*(?:M\\.|Mme|Mr|Monsieur|Madame)?\\s*${PERSON}`, "gi");

/** Mots qui ressemblent à un nom propre mais n'en sont pas. */
const NOT_A_NAME = /^(service|mentions|contact|accueil|nos|notre|votre|le|la|les|direction|soci[ée]t[ée]|groupe|si[èe]ge|agence|plan|site|equipe|équipe|page|tel|tél|fax|email|mail|adresse)$/i;

/** Blocs de texte d'une page : une ligne par paragraphe, titre, cellule ou élément de liste. */
export function blocksOf(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/td|\/th|\/tr|\/dt|\/dd|\/section|\/article|\/span)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1 && line.length < 200);
}

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[\s,.;:–—-]+$/, "").trim();

function person(first: string, last: string, role: string, url: string): SitePerson | null {
  const firstName = clean(first);
  const lastName = clean(last);
  if (!civilityFor(firstName.split(/[-\s]/)[0] ?? "")) return null;
  if (NOT_A_NAME.test(lastName.split(" ")[0]) || lastName.length < 2) return null;
  const text = clean(role);
  if (!ROLE.test(text)) return null;
  return { firstName, lastName, role: text.slice(0, 60), url };
}

/** Personnes nommées sur une page, avec leur fonction. */
export function extractPeople(html: string, url: string): SitePerson[] {
  const found: SitePerson[] = [];
  const add = (candidate: SitePerson | null) => {
    if (!candidate) return;
    const key = `${candidate.firstName} ${candidate.lastName}`.toLowerCase();
    if (!found.some((item) => `${item.firstName} ${item.lastName}`.toLowerCase() === key)) found.push(candidate);
  };
  const lines = blocksOf(html);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(NAME_THEN_ROLE)) add(person(match[1], match[2], match[3], url));
    for (const match of line.matchAll(ROLE_THEN_NAME)) add(person(match[2], match[3], match[1], url));
    // Carte d'équipe : le nom sur une ligne, la fonction sur la suivante.
    const alone = new RegExp(`^${PERSON}$`).exec(line);
    const next = lines[index + 1] ?? "";
    if (alone && ROLE.test(next) && next.length <= 70) add(person(alone[1], alone[2], next, url));
  });
  return found;
}

const TEAM_PAGE = /equipe|équipe|team|qui[-_ ]sommes|a[-_ ]propos|à[-_ ]propos|about|direction|organigramme|contact|mentions?[-_ ]?l[eé]gales?|legal|notre[-_ ](histoire|entreprise|societe|société)/i;

/** Pages du site où chercher des noms : équipe, à propos, contact, mentions légales (4 au plus). */
export function teamPages(html: string, base: string, max = 4): string[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const urls: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([^<]{0,80})/gi)) {
    let url: URL;
    try {
      url = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // chemin mal encodé : gardé tel quel
    }
    const target = `${url.origin}${url.pathname}`;
    if (TEAM_PAGE.test(`${path} ${match[2]}`) && !urls.includes(target)) urls.push(target);
  }
  for (const path of ["/equipe", "/notre-equipe", "/mentions-legales", "/contact"]) {
    const target = `${origin.origin}${path}`;
    if (!urls.some((url) => url.startsWith(target))) urls.push(target);
  }
  return urls.slice(0, max);
}

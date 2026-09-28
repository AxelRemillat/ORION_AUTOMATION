import { domainOfEmail, isServiceProvider } from "./domains";

/**
 * Extraction d'adresses dans une page, y compris masquées.
 *
 * Les petites entreprises protègent souvent leur adresse des robots :
 * « contact [at] exemple.fr », « contact(at)exemple(dot)fr », entités HTML
 * (`&#64;`), ou un simple `mailto:`. On les remet en clair avant de chercher.
 */

const ENTITY: Record<string, string> = { "&#64;": "@", "&#x40;": "@", "&commat;": "@", "&#46;": ".", "&period;": "." };

/** Remet en clair les formes masquées courantes. */
export function deobfuscate(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(ENTITY)) out = out.split(entity).join(char);
  return out
    .replace(/\s*[[({]\s*(?:at|arobase|@)\s*[\])}]\s*/gi, "@")
    .replace(/\s+(?:at|arobase)\s+(?=[a-z0-9-]+\s*(?:[[({]\s*(?:dot|point)\s*[\])}]|\.)\s*[a-z]{2,})/gi, "@")
    .replace(/\s*[[({]\s*(?:dot|point)\s*[\])}]\s*/gi, ".");
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,10}/gi;

/** Faux positifs : noms de fichiers d'images, adresses de services techniques. */
const JUNK_DOMAIN = /(sentry|wixpress|example\.(com|fr|org)|domain\.(com|fr)|votre-?site|monsite|email\.com|yourdomain|test\.)/i;
const JUNK_LOCAL = /^(no-?reply|noreply|nepasrepondre|postmaster|abuse|webmaster|mailer-daemon|privacy|dpo|rgpd|gdpr)$/i;
const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

export function extractEmails(content: string): string[] {
  const found = new Set<string>();
  for (const match of deobfuscate(content).matchAll(EMAIL)) {
    const email = match[0].toLowerCase().replace(/\.+$/, "");
    const [local, domain] = email.split("@");
    if (!local || !domain || FILE_EXT.test(email) || JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) continue;
    found.add(email);
  }
  return [...found];
}

/** Adresses de service : on les garde, mais elles ne désignent personne. */
const GENERIC_LOCAL =
  /^(contact|info|infos|information|accueil|bonjour|hello|hi|mail|email|secretariat|secretaire|admin|administration|compta|comptabilite|facturation|commercial|commerciale|commande|commandes|ventes?|sales|devis|sav|service|support|direction|gerance|office|bureau|agence|atelier|boutique|magasin|recrutement|rh|jobs|emploi|reservation|boulangerie|menuiserie|entreprise|societe)[0-9._-]*$/i;

export type EmailKind = "nominatif" | "generique";

/**
 * Nominatif ou générique ?
 *
 * Nominatif si la partie locale porte le nom (ou prénom.nom, p.nom) d'une
 * personne connue, ou si elle a la forme « prenom.nom ». Sinon générique.
 */
/**
 * Le libelle d'adresse peut-il porter le nom d'une personne ?
 *
 * Hunter etiquette « personal » des alias opaques : sur briol-diffusion.fr il
 * rend `xbr@` en « personal », et le module le presentait donc comme un contact
 * NOMINATIF — trois lettres qui ne nomment personne, classees au-dessus de
 * l'adresse que l'entreprise publie elle-meme. On exige donc quatre lettres au
 * minimum avant de croire l'etiquette.
 */
export function namesSomeone(email: string): boolean {
  const letters = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  return letters.length >= 4;
}

export function classifyEmail(email: string, person?: { firstName: string; lastName: string } | null): EmailKind {
  const local = email.split("@")[0].toLowerCase();
  if (GENERIC_LOCAL.test(local)) return "generique";
  const plain = (value: string) =>
    value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  if (person) {
    const last = plain(person.lastName);
    const first = plain(person.firstName);
    const flat = local.replace(/[^a-z]/g, "");
    if ((last.length >= 3 && flat.includes(last)) || (first.length >= 3 && flat.startsWith(first))) return "nominatif";
  }
  return /^[a-z]{2,}[._-][a-z]{2,}$/.test(local) ? "nominatif" : "generique";
}

/** Domaines d'adresses différents du site : le mail peut vivre ailleurs (BRIOL). */
export function emailDomains(emails: string[], siteDomain: string | null): string[] {
  const domains = new Set<string>();
  for (const email of emails) {
    const domain = domainOfEmail(email);
    // L'hébergeur cité dans les mentions légales n'est pas l'entreprise.
    if (domain && !isServiceProvider(domain)) domains.add(domain);
  }
  // Le domaine du site passe en dernier : c'est l'hypothèse la plus faible
  // quand une adresse publiée pointe ailleurs.
  const list = [...domains].filter((domain) => domain !== siteDomain);
  if (siteDomain && domains.has(siteDomain)) list.push(siteDomain);
  return list;
}

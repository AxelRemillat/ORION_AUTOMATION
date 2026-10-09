import { isRoleBox } from "./role-boxes";
import { domainOfEmail, isServiceProvider } from "./domains";

/**
 * Extraction d'adresses dans une page, y compris masquées.
 *
 * Les petites entreprises protègent souvent leur adresse des robots :
 * « contact [at] exemple.fr », « contact(at)exemple(dot)fr », entités HTML
 * (`&#64;`), ou un simple `mailto:`. On les remet en clair avant de chercher.
 */

const ENTITY: Record<string, string> = { "&#64;": "@", "&#x40;": "@", "&commat;": "@", "&#46;": ".", "&period;": "." };

/** Entités numériques (`&#99;`, `&#x63;`) → caractère. */
const decodeEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)));

/**
 * ADRESSES MASQUÉES PAR JOOMLA (« email cloaking »).
 *
 * Joomla n'écrit jamais l'adresse dans la page : un script la reconstruit
 * morceau par morceau, entités HTML comprises :
 *   var addy8f2 = 'c&#111;nt&#97;ct' + '&#64;';
 *   addy8f2 = addy8f2 + 'exemple' + '&#46;' + 'fr';
 * Une lecture du texte ne voyait AUCUNE adresse, et la fiche partait « à
 * compléter » alors que le site en publiait une. On recolle les littéraux de
 * chaque variable `addy…`, dans l'ordre, puis on décode les entités.
 */
export function decodeJoomlaCloak(html: string): string[] {
  const parts = new Map<string, string>();
  for (const match of html.matchAll(/(?:var\s+)?(addy[\w]+)\s*=\s*((?:\1\s*\+\s*)?(?:'[^']*'|"[^"]*")(?:\s*\+\s*(?:'[^']*'|"[^"]*"))*)\s*;/g)) {
    const [, name, expression] = match;
    const literals = [...expression.matchAll(/'([^']*)'|"([^"]*)"/g)].map((item) => item[1] ?? item[2] ?? "").join("");
    parts.set(name, (expression.trim().startsWith(name) ? parts.get(name) ?? "" : "") + literals);
  }
  return [...parts.values()].map((value) => decodeEntities(value).trim()).filter((value) => value.includes("@"));
}

/** Remet en clair les formes masquées courantes. */
export function deobfuscate(text: string): string {
  const cloaked = /addy[\w]+\s*=/.test(text) ? decodeJoomlaCloak(text) : [];
  let out = cloaked.length ? `${text}\n${cloaked.join("\n")}` : text;
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
    // Boîte de rôle juridique (rgpd@, dpo@, no-reply@…) : jamais un contact (Cowork #41).
    if (isRoleBox(email)) continue;
    found.add(email);
  }
  return [...found];
}

/**
 * Téléphones français d'une page : liens `tel:` d'abord (explicites), puis
 * numéros écrits (01 23 45 67 89, 01.23.45.67.89, +33 1 23 45 67 89).
 * Rendus au format « 01 23 45 67 89 ». Les numéros surtaxés (08 9x) sont écartés.
 */
export function extractPhones(html: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    let digits = raw.replace(/[^\d+]/g, "");
    if (digits.startsWith("+33")) digits = `0${digits.slice(3)}`;
    else if (digits.startsWith("0033")) digits = `0${digits.slice(4)}`;
    digits = digits.replace(/^0\(0\)/, "0");
    if (!/^0[1-9]\d{8}$/.test(digits) || /^089/.test(digits)) return;
    const pretty = digits.replace(/(\d{2})(?=\d)/g, "$1 ");
    if (!found.includes(pretty)) found.push(pretty);
  };
  for (const match of html.matchAll(/href=["']tel:([^"']+)["']/gi)) add(match[1]);
  const text = html.replace(/<[^>]+>/g, " ");
  for (const match of text.matchAll(/(?:\+33\s?(?:\(0\)\s?)?|0)[1-9](?:[\s.-]?\d{2}){4}/g)) add(match[0]);
  return found;
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
  // « contact.internet », « service.clients » : un mot générique en tête n'est pas un prénom (Cowork #43).
  if (GENERIC_LOCAL.test(local.split(/[._-]/)[0] ?? "")) return "generique";
  const plain = (value: string) =>
    value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  if (person) {
    const last = plain(person.lastName);
    const first = plain(person.firstName);
    const flat = local.replace(/[^a-z]/g, "");
    if ((last.length >= 3 && flat.includes(last)) || (first.length >= 3 && flat.startsWith(first))) return "nominatif";
  }
  // « prenom.nom » ou « initiale.nom » (« e.lahmadi », LORMEDO 07/10) : nominatif.
  return /^[a-z]{2,}[._-][a-z]{2,}$/.test(local) || /^[a-z][._-][a-z]{3,}$/.test(local) ? "nominatif" : "generique";
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

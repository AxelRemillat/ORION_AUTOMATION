/**
 * Couverture du site officiel — découverte, validation, lecture.
 *
 * Constat de départ : pour Jacquet, l'app n'avait aucun site. La découverte se
 * limitait à Pappers puis à une devinette sur le nom de domaine, et la lecture
 * à deux pages dont une au chemin deviné. Résultat : le modèle économique était
 * paraphrasé depuis le code NAF, ce qui donne des mails génériques.
 *
 * Trois règles :
 *   1. Chercher dans un ORDRE explicite, du moins cher au plus cher.
 *   2. Ne VALIDER un domaine que si la page parle bien de cette entreprise
 *      (nom, SIREN, ville ou code postal). Un domaine trouvé n'est pas un
 *      domaine vérifié.
 *   3. Assumer l'échec : « Site : non trouvé » est une information. On ne
 *      remplace jamais un site absent par une paraphrase du NAF.
 *
 * Lecture : fetch serveur direct (gratuit), robots.txt respecté, 5 s de délai,
 * user-agent explicite, pas de navigateur headless. Linkup /v1/fetch ne sert
 * que de repli quand le site refuse le fetch direct : il coûte 0,001 $.
 */
import { decodeBody } from "./charset";
import { cleanText } from "./clean";
import { toDomain } from "./http";
import { fetchPage, fetchWebResults, hasLinkupKey } from "./linkup";
import { companyAliases, guessOwnWebsite } from "./signals";
import { normalizeForMatch } from "./clean";
import { wwwVariant } from "./www";


/** Identification honnête : un site doit pouvoir nous reconnaître et nous bloquer. */
export const USER_AGENT =
  "OrionProspectBot/1.0 (+https://orion.axelremillat.com/bot; prospection B2B; contact axel@axelremillat.com)";

const TIMEOUT_MS = 5_000;
/**
 * Pages lues par site : accueil + « a propos » + « services » + jusqu'a deux
 * offres d'emploi. Le plafond a ete releve de 3 a 5 parce que les offres
 * arrivaient toujours apres les pages de presentation et n'etaient jamais lues.
 */
const MAX_PAGES = 6;
const MAX_PAGE_CHARS = 4_000;

export type SiteStatus = "lu" | "trouvé" | "non trouvé";

export interface SitePage {
  url: string;
  /** Texte nettoyé, prêt pour l'extraction. */
  text: string;
  /** Comment la page a été obtenue : utile pour comprendre un coût. */
  via: "direct" | "linkup";
}

export interface SiteCoverage {
  /** Domaine validé, ou `null` si rien n'a pu être confirmé. */
  domain: string | null;
  url: string | null;
  status: SiteStatus;
  pages: SitePage[];
  /** D'où vient le domaine retenu. */
  discoveredBy: "pappers" | "annuaire" | "email" | "hunter" | "devine" | "linkup" | null;
  /** Coûts engagés ici : lectures Linkup de repli, recherche Linkup. */
  linkupCalls: number;
  /** Raison d'un échec, affichée telle quelle. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/** Règles retenues pour notre user-agent (et pour `*`). */
interface Robots {
  disallow: string[];
}

const robotsCache = new Map<string, Robots>();

async function loadRobots(origin: string): Promise<Robots> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const rules: Robots = { disallow: [] };
  try {
    const response = await fetchText(`${origin}/robots.txt`, "text/plain");
    if (response) {
      let applies = false;
      for (const line of response.split(/\r?\n/)) {
        const [rawKey, ...rest] = line.split("#")[0].split(":");
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") {
          applies = value === "*" || normalizeForMatch(USER_AGENT).includes(normalizeForMatch(value));
        } else if (key === "disallow" && applies && value) {
          rules.disallow.push(value);
        }
      }
    }
  } catch {
    // Pas de robots.txt lisible : la convention est que tout est autorisé.
  }
  robotsCache.set(origin, rules);
  return rules;
}

export function isAllowedByRobots(rules: Robots, pathname: string): boolean {
  return !rules.disallow.some((rule) => rule === "/" || pathname.startsWith(rule));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** GET texte, avec user-agent explicite et délai court. Jamais throw. */
/**
 * Rend l URL REELLEMENT servie apres redirections, avec le texte.
 *
 * Indispensable pour l origine : fourmizz.fr, saintlouisconseil.fr et
 * conversationnel.fr repondent 301 vers « www. ». En gardant le domaine nu
 * comme origine, `internalLinks` jugeait EXTERNE chaque lien du site et n en
 * retenait aucun — ORION ne lisait alors que la page d accueil, jamais
 * « a propos » ni « services ».
 */
async function fetchDoc(url: string, accept = "text/html"): Promise<{ text: string; url: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: `${accept},*/*;q=0.8` },
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (accept === "text/html" && !type.includes("html") && !type.includes("text")) return null;
    // `response.text()` forcerait l'UTF-8 : on respecte le charset annonce.
    return { text: decodeBody(await response.arrayBuffer(), type).slice(0, 400_000), url: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Le texte seul, pour les appelants qui n ont pas besoin de l URL servie. */
const fetchText = async (url: string, accept = "text/html"): Promise<string | null> =>
  (await fetchDoc(url, accept))?.text ?? null;

/** HTML -> texte lisible. Scripts, styles et balises retirés. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;|&#38;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    // Les apostrophes typographiques arrivent en decimal (&#039;) ou en nom :
    // non decodees, elles polluaient le texte envoye au modele.
    .replace(/&#0?39;|&rsquo;|&#8217;|&apos;/g, "'")
    .replace(/&lt;|&#60;/g, "<")
    .replace(/&gt;|&#62;/g, ">")
    .replace(/&#\d{2,5};/g, " ")
    .replace(/&[a-z]+;/gi, " ");
  return cleanText(stripped, MAX_PAGE_CHARS);
}

/** Liens internes de la page d'accueil, avec leur libellé. */
export function internalLinks(html: string, origin: string): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith("#") || /^(mailto|tel|javascript):/i.test(rawHref)) continue;
    try {
      const url = new URL(rawHref, origin);
      if (url.origin !== origin) continue;
      const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      links.push({ href: `${url.origin}${url.pathname}`, label });
    } catch {
      // href relatif illisible : on l'ignore.
    }
  }
  return links;
}

/** Pages recherchées après l'accueil, par ordre de priorité. */
const ABOUT = /\b(à propos|a propos|qui sommes|notre histoire|entreprise|société|about)\b/i;
const SERVICES = /\b(services?|métiers?|savoir[- ]faire|nos activités|activités|prestations|solutions|produits)\b/i;

/**
 * Pages d'offre d'emploi, reconnues a l'URL.
 *
 * Volontairement large : un intitule de poste peut etre n'importe quoi, mais
 * le chemin porte presque toujours « offre-demploi », « recrutement » ou
 * « carriere ».
 */
export const JOB_PATH = /offre[-_]?d?[-_]?emploi|recrutement|carrier|carriere|nous[-_]rejoindre|jobs?|job[-_]offer/i;

/**
 * URLs d'offres d'emploi lues dans le sitemap.
 *
 * Pourquoi le sitemap et pas les liens de la page : chez BLUE ENERFREEZE, la
 * page « nous-rejoindre » construit sa liste en JavaScript. Le HTML servi ne
 * contient donc AUCUN lien vers l'offre « Automaticien/ne », alors que le
 * sitemap la declare. Sans cette lecture, l'offre etait invisible pour nous —
 * et l'entreprise tombait a 7/100 en recrutant exactement notre cible.
 */
export function jobUrlsFromSitemap(xml: string, origin: string, max = 3): string[] {
  // Le sitemap est souvent servi sur « www » alors qu'on crawle le domaine nu
  // (ou l'inverse). Comparer les origines telles quelles rejetait donc TOUTES
  // les URLs — le bug qui rendait l'offre Automaticien invisible.
  const host = (value: string): string => {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const base = host(origin);
  const found: { url: string; offer: boolean }[] = [];

  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const raw = match[1];
    if (!JOB_PATH.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (host(raw) !== base) continue;
    // Les traductions (/en/, /es/) disent la meme chose : on garde le FR.
    if (/^\/(en|es|de|it)\//.test(url.pathname)) continue;

    // On reecrit sur l'origine reellement crawlee, pour rester dans le meme
    // robots.txt et le meme domaine que les autres pages.
    const clean = `${origin}${url.pathname}`;
    if (found.some((item) => item.url === clean)) continue;
    found.push({ url: clean, offer: /offre|job[-_]offer/i.test(url.pathname) });
  }

  // Une offre precise vaut mieux qu'une page « nous rejoindre » qui ne liste
  // rien : c'est elle qui porte l'intitule du poste et, parfois, sa date.
  return found
    .sort((a, b) => Number(b.offer) - Number(a.offer))
    .slice(0, max)
    .map((item) => item.url);
}

/** Choisit au plus deux pages internes : « à propos » puis « services ». */
export function pickSecondaryPages(
  links: { href: string; label: string }[],
  homeUrl: string,
): string[] {
  const seen = new Set([homeUrl]);
  const picked: string[] = [];

  for (const pattern of [ABOUT, SERVICES]) {
    const match = links.find(
      (link) => !seen.has(link.href) && (pattern.test(link.label) || pattern.test(link.href)),
    );
    if (match) {
      seen.add(match.href);
      picked.push(match.href);
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SiteIdentity {
  name: string;
  siren?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/**
 * Un domaine n'est validé que si la page parle de CETTE entreprise.
 * Le nom seul ne suffit pas pour un nom court et répandu (« Jacquet ») : on
 * exige un second marqueur, sauf si le nom est long et distinctif.
 */
export function pageConfirmsCompany(text: string, company: SiteIdentity): boolean {
  const haystack = normalizeForMatch(text);
  const aliases = companyAliases(company.name).filter((alias) => alias.length >= 4);
  const named = aliases.some((alias) => haystack.includes(alias));
  if (!named) return false;

  // SIREN tel qu'on l'écrit dans des mentions légales : « 520 644 386 »,
  // « 520.644.386 » ou collé. Cherché avec ses séparateurs possibles : ARTFLEX
  // (520644386) était écarté, son SIREN n'apparaissant qu'espacé, et son profil
  // métier n'était jamais lu.
  const siren = company.siren?.replace(/\D/g, "") ?? "";
  if (siren.length === 9 && new RegExp(`(^|\\D)${siren.split("").join("[\\s.\\u00a0\\u202f]?")}(\\D|$)`).test(text)) return true;

  const markers = [company.city, company.postalCode]
    .filter((value): value is string => Boolean(value && value.length >= 3))
    .map(normalizeForMatch);

  if (markers.some((marker) => haystack.includes(marker))) return true;
  // Nom long et peu ambigu : il vaut preuve à lui seul.
  return aliases.some((alias) => alias.length >= 12);
}

// ---------------------------------------------------------------------------
// Découverte
// ---------------------------------------------------------------------------

/**
 * Un hote doit ressembler a un nom de domaine : une adresse IP ou un libelle
 * sans extension alphabetique n'est pas un site officiel, c'est une scorie
 * d'enrichissement.
 */
export function looksLikeDomain(host: string | null): host is string {
  if (!host) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return /\.[a-z]{2,}$/i.test(host);
}

/**
 * Domaines qui ne sont jamais le site officiel d'une PME.
 *
 * Ancré sur les LIBELLÉS du domaine : la version précédente cherchait « x.com »
 * n'importe où, et « maviflex.com » (MAVIFLEX, 02/10/2026) était écarté comme
 * un réseau social — profil métier jamais lu.
 */
export const NOT_OFFICIAL =
  /(^|[./])(linkedin|facebook|instagram|twitter|youtube|pappers|infogreffe|annuaire-entreprises|indeed|welcometothejungle|google|wikipedia|pagesjaunes|kompass|manageo|bodacc)\.|(^|[./])(x|societe|verif)\.com\b|(^|[./])data\.gouv\.fr\b|(^|[./])(rubypayeur|creditsafe|ellisphere|altares|bilansgratuits|score3|b-reputation|dirigeant|entreprises\.lefigaro|journaldunet|usinenouvelle|lesechos|bfmtv|batiactu)\./i;

export interface DiscoveryInput extends SiteIdentity {
  /** Site donné par Pappers, le plus fiable quand il existe. */
  pappersWebsite?: string | null;
  /** Site déjà connu du prospect (annuaire, saisie manuelle). */
  knownWebsite?: string | null;
  /**
   * Adresse de contact connue. Son domaine est un candidat gratuit et fiable :
   * une entreprise qui écrit depuis `@blue-enerfreeze.com` a son site là.
   * Arrive avant Hunter, qui coûte une recherche pour la même information.
   */
  contactEmail?: string | null;
  /** Domaine issu de Hunter, quand la recherche de contact a déjà eu lieu. */
  hunterDomain?: string | null;
}

/** Domaine d'une adresse e-mail, hors messageries grand public. */
const FREE_MAILBOX =
  /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|orange|wanadoo|free|sfr|laposte|bbox|numericable|aol|icloud|me|protonmail|proton)\./i;

export function domainOfEmail(email: string | null | undefined): string | null {
  const at = email?.trim().split("@")[1];
  if (!at) return null;
  const domain = at.toLowerCase().replace(/^www\./, "");
  return FREE_MAILBOX.test(domain) ? null : domain;
}

/** Candidats de domaine, dans l'ordre imposé, sans doublon. */
export function candidateDomains(
  input: DiscoveryInput,
): { domain: string; by: NonNullable<SiteCoverage["discoveredBy"]>; nameProven?: boolean }[] {
  const ordered: { domain: string | null; by: NonNullable<SiteCoverage["discoveredBy"]> }[] = [
    { domain: toDomain(input.pappersWebsite ?? null), by: "pappers" },
    { domain: toDomain(input.knownWebsite ?? null), by: "annuaire" },
    { domain: domainOfEmail(input.contactEmail), by: "email" },
    { domain: toDomain(input.hunterDomain ?? null), by: "hunter" },
  ];

  const seen = new Set<string>();
  const candidates: { domain: string; by: NonNullable<SiteCoverage["discoveredBy"]>; nameProven?: boolean }[] = [];
  for (const item of ordered) {
    if (!looksLikeDomain(item.domain)) continue;
    if (seen.has(item.domain) || NOT_OFFICIAL.test(item.domain)) continue;
    seen.add(item.domain);
    candidates.push({ domain: item.domain, by: item.by });
  }

  // Dernier recours GRATUIT, avant la recherche web payante : le domaine déduit
  // du nom. Il n'est jamais `nameProven` — la page devra nommer l'entreprise.
  if (!candidates.length) {
    for (const domain of guessedDomains(input.name)) {
      if (seen.has(domain) || NOT_OFFICIAL.test(domain)) continue;
      seen.add(domain);
      candidates.push({ domain, by: "devine" });
    }
  }
  return candidates;
}

/**
 * Domaines plausibles pour un nom d'entreprise : `.fr` puis `.com`.
 *
 * Le nom est réduit à son noyau — forme juridique, enseignes entre parenthèses
 * et mots génériques retirés. « MAETVA (MA & VA DIRECT) » donne « maetva.fr »
 * et « maetva.com ». Sous cinq caractères on n'essaie pas : « UMT » ou « CB »
 * donneraient n'importe quoi.
 */
export function guessedDomains(name: string): string[] {
  const core = (name.split("(")[0] ?? name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sas|sasu|sarl|eurl|sa|snc|scop|sci|societe|ste|groupe|france|holding)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
  if (core.length < 5 || core.length > 30) return [];
  return [`${core}.fr`, `${core}.com`];
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Lit une page : fetch direct d'abord, Linkup en repli si le site refuse. */
async function readPage(
  url: string,
  robots: Robots,
  prospectId: string | null,
  allowLinkupFallback: boolean,
): Promise<{ page: SitePage | null; linkupCalls: number }> {
  const path = new URL(url).pathname;
  if (!isAllowedByRobots(robots, path)) return { page: null, linkupCalls: 0 };

  const html = await fetchText(url);
  if (html) {
    const text = htmlToText(html);
    if (text.length >= 120) return { page: { url, text, via: "direct" }, linkupCalls: 0 };
  }

  // Le fetch direct est gratuit : Linkup ne sert que lorsqu'il a échoué.
  if (!allowLinkupFallback || !hasLinkupKey()) return { page: null, linkupCalls: 0 };
  const viaLinkup = await fetchPage(url, prospectId);
  if (!viaLinkup.ok) return { page: null, linkupCalls: 1 };
  return {
    page: { url, text: cleanText(viaLinkup.data.markdown, MAX_PAGE_CHARS), via: "linkup" },
    linkupCalls: 1,
  };
}

/** Le nom de l'entreprise (ou un de ses alias) figure-t-il dans le texte ? */
function namesCompany(text: string, company: SiteIdentity): boolean {
  const haystack = normalizeForMatch(text);
  return companyAliases(company.name).filter((alias) => alias.length >= 4).some((alias) => haystack.includes(alias));
}

const LEGAL_LINK = /mentions?[-_ ]?l[eé]gales?|legal|informations[-_ ]l[eé]gales/i;
const LEGAL_PATHS = ["/mentions-legales", "/mentions-legales.html", "/mentions-legales/", "/legal"];

/**
 * SECONDE PREUVE PAR LES MENTIONS LÉGALES.
 *
 * Un nom court (« ARTFLEX », 7 lettres) ne vaut pas preuve à lui seul, et les
 * pages lues (accueil, services, recrutement) ne portent souvent ni le SIREN ni
 * la ville. Les mentions légales, elles, portent le SIREN : c'est là que la
 * recherche de contact l'avait trouvé pour ARTFLEX (520644386), alors que la
 * lecture du site l'écartait — et le profil métier n'était jamais lu.
 *
 * Deux pages au plus, lecture directe gratuite (pas de Linkup), robots.txt respecté.
 */
async function legalNoticeConfirms(
  origin: string,
  homeHtml: string | null,
  alreadyRead: string,
  company: SiteIdentity,
  prospectId: string | null,
): Promise<boolean> {
  const robots = await loadRobots(origin);
  const linked = homeHtml
    ? internalLinks(homeHtml, origin)
        .filter((link) => LEGAL_LINK.test(link.href) || LEGAL_LINK.test(link.label))
        .map((link) => link.href)
    : [];
  const urls = [...new Set([...linked, ...LEGAL_PATHS.map((path) => `${origin}${path}`)])].slice(0, 2);
  for (const url of urls) {
    const read = await readPage(url, robots, prospectId, false);
    if (read.page && pageConfirmsCompany(`${alreadyRead}\n${read.page.text}`, company)) return true;
  }
  return false;
}

/** Accueil + jusqu'à deux pages internes détectées depuis ses liens. */
async function readSite(
  origin: string,
  prospectId: string | null,
): Promise<{ pages: SitePage[]; html: string | null; linkupCalls: number }> {
  const first = await readSiteAt(origin, prospectId);
  // Domaine nu muet, « www. » servi (planfor.fr, gravir.fr… Cowork #35) : une seconde tentative.
  const www = first.pages.length ? null : wwwVariant(origin);
  if (!www) return first;
  const second = await readSiteAt(www, prospectId);
  return second.pages.length ? { ...second, linkupCalls: first.linkupCalls + second.linkupCalls } : first;
}

async function readSiteAt(
  origin: string,
  prospectId: string | null,
): Promise<{ pages: SitePage[]; html: string | null; linkupCalls: number }> {
  const robots = await loadRobots(origin);
  let linkupCalls = 0;

  const document = await fetchDoc(origin);
  const homeHtml = document?.text ?? null;
  const home = await readPage(origin, robots, prospectId, true);
  linkupCalls += home.linkupCalls;
  if (!home.page) return { pages: [], html: homeHtml, linkupCalls };

  const pages = [home.page];
  /*
   * ORIGINE REELLEMENT SERVIE. Un site qui repond 301 vers « www. » faisait
   * juger EXTERNE chacun de ses propres liens (internalLinks compare a
   * l origine DEMANDEE) : plus aucune page secondaire, jamais. Mesure du
   * 09/10/2026 : fourmizz.fr, saintlouisconseil.fr et conversationnel.fr
   * perdaient ainsi « a propos », « services » et « realisations ».
   */
  const served = document ? new URL(document.url).origin : origin;
  const secondary = homeHtml ? pickSecondaryPages(internalLinks(homeHtml, served), served) : [];

  // Le sitemap declare des pages que le HTML ne lie pas (listes construites en
  // JavaScript). C'est la seule facon de trouver certaines offres d'emploi.
  // Il est servi en `application/xml` : sans ce type explicite, `fetchText` le
  // rejetait silencieusement et aucune offre n'etait jamais decouverte.
  const sitemap = await fetchText(`${served}/sitemap.xml`, "application/xml");
  const jobs = sitemap ? jobUrlsFromSitemap(sitemap, served, 3) : [];

  // Les offres passent AVANT les pages de presentation : une offre datee est
  // le signal le plus fort qu'on puisse trouver, « qui sommes-nous » le plus
  // faible. L'inverse faisait sortir les offres du budget de pages.
  const extra = [...jobs, ...secondary.filter((url) => !jobs.includes(url))];
  for (const url of extra.slice(0, MAX_PAGES - 1)) {
    const read = await readPage(url, robots, prospectId, false);
    linkupCalls += read.linkupCalls;
    if (read.page) pages.push(read.page);
  }

  return { pages, html: homeHtml, linkupCalls };
}

/**
 * Découvre, valide et lit le site officiel.
 *
 * Retourne toujours un verdict exploitable : `status: "non trouvé"` est un
 * résultat, pas une erreur.
 */
export async function coverSite(
  input: DiscoveryInput,
  options: {
    prospectId?: string | null;
    allowLinkupSearch?: boolean;
    /**
     * Le site DÉJÀ ENREGISTRÉ sur la fiche (`knownWebsite`) est celui du
     * prospect : il a été validé au creusage ou saisi à la main. On le lit sans
     * repasser l'anti-homonymie — un site de marque (talents-handicap.com pour
     * NEW NET 3D) ne cite pas toujours la raison sociale, et le profil métier
     * restait vide alors que le site existe.
     */
    trustKnownWebsite?: boolean;
  } = {},
): Promise<SiteCoverage> {
  const prospectId = options.prospectId ?? null;
  const base: SiteCoverage = {
    domain: null,
    url: null,
    status: "non trouvé",
    pages: [],
    discoveredBy: null,
    linkupCalls: 0,
    note: null,
  };

  const candidates = candidateDomains(input);

  /**
   * Essaie une liste de domaines : rend le premier confirmé, ou `null`.
   *
   * Extrait d'une boucle unique pour que Linkup devienne un VRAI dernier
   * recours : il ne se déclenchait qu'en l'absence totale de candidat, et
   * `guessedDomains` en fournit presque toujours un. Deux domaines devinés
   * injoignables suffisaient donc à écarter la recherche web.
   */
  const attempt = async (list: ReturnType<typeof candidateDomains>): Promise<SiteCoverage | null> => {
    for (const candidate of list) {
      const origin = `https://${candidate.domain}`;
      const read = await readSite(origin, prospectId);
      base.linkupCalls += read.linkupCalls;

      if (!read.pages.length) {
        base.note = `Site ${candidate.domain} injoignable ou interdit par robots.txt`;
        continue;
      }

      const joined = read.pages.map((page) => page.text).join("\n");
      const confirmed =
        /*
         * Un domaine dont le LABEL porte le nom de l'entreprise vaut
         * identification : « serensia.com » pour SERENSIA. Exiger en plus le
         * SIREN ou la ville sur la page d'accueil écartait des sites parfaitement
         * bons — une page d'accueil vend, elle ne récite pas le registre.
         */
        candidate.nameProven === true ||
        (options.trustKnownWebsite === true && candidate.by === "annuaire") ||
        pageConfirmsCompany(joined, input) ||
        // Domaine deviné : la page doit nommer l'entreprise. Le label du domaine
        // EST le nom ; la mention sur la page est la seconde preuve.
        (candidate.by === "devine" && namesCompany(joined, input)) ||
        (namesCompany(joined, input) && (await legalNoticeConfirms(origin, read.html, joined, input, prospectId)));
      if (!confirmed) {
        base.note = `Site ${candidate.domain} écarté : la page ne mentionne ni le nom, ni le SIREN, ni la ville`;
        continue;
      }

      return {
        ...base,
        domain: candidate.domain,
        url: origin,
        status: "lu",
        pages: read.pages,
        discoveredBy: candidate.by,
        note: null,
      };
    }
    return null;
  };

  // 1. Les pistes gratuites : annuaire, courriel de contact, domaines devinés.
  const free = await attempt(candidates);
  if (free) return free;

  // 2. Dernier recours, PAYANT : demander le site officiel à Linkup. La porte
  //    (lib/linkup/gate.ts) tient le budget quotidien et la part réservée au
  //    segment ; ici on se contente de poser la question au bon moment.
  if (options.allowLinkupSearch !== false && hasLinkupKey()) {
    const search = await fetchWebResults({
      name: input.name,
      city: input.city,
      website: null,
      // Guillemets autour du NOM seul : « "ELIOPHOT" Villeurbanne site officiel ».
      query: [`"${input.name}"`, input.city, "site officiel"].filter(Boolean).join(" "),
    });
    base.linkupCalls += 1;
    if (search.ok) {
      /*
       * On ne prend PLUS le premier domaine acceptable : il s'agissait presque
       * toujours d'un annuaire de notation mieux référencé que l'entreprise
       * elle-même. `guessOwnWebsite` ne retient qu'un domaine dont le label
       * porte réellement le nom — c'est la seule preuve gratuite qu'on ait.
       * Sans correspondance de nom, on préfère ne rien trouver : un faux site
       * fait écrire un mail sur le métier de quelqu'un d'autre.
       */
      const named = toDomain(guessOwnWebsite(input.name, search.data));
      if (looksLikeDomain(named) && !NOT_OFFICIAL.test(named)) {
        // `nameProven` : le label du domaine porte le nom de l'entreprise.
        const viaLinkup = await attempt([{ domain: named, by: "linkup", nameProven: true }]);
        if (viaLinkup) return viaLinkup;
      }
    }
  }

  return base;
}

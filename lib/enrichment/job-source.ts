/**
 * Ce qui fait — ou non — une offre d'emploi.
 *
 * Constat de production : trois entreprises ont reçu un signal « Recrutement
 * en cours » alors que la source était une fiche d'annuaire (LinkedIn company,
 * Societe.com) ou un agrégateur qui annonce « 12 offres d'emploi » sans citer
 * un seul poste. Ce n'est pas un signal : c'est une page qui existe pour toute
 * entreprise de France, et qui ne dit rien de son actualité.
 *
 * Trois catégories, trois traitements :
 *
 *   `officielle`  — site de l'entreprise, page carrière, ou plateforme
 *                   d'emploi nominative (Welcome to the Jungle, Indeed,
 *                   France Travail, LinkedIn `/jobs/view/`). Points pleins.
 *   `agregateur`  — liste d'offres sans intitulé ni date (trabajo.org,
 *                   jobtomove…). 25 % des points, jamais angle principal.
 *   `aucune`      — fiche d'annuaire, page d'entreprise. Pas un signal.
 */

export type JobSourceKind = "officielle" | "agregateur" | "aucune";

/** Part des points accordée selon la qualité de la source. */
export const JOB_SOURCE_WEIGHT: Record<JobSourceKind, number> = {
  officielle: 1,
  agregateur: 0.25,
  aucune: 0,
};

/**
 * Plateformes d'emploi où une annonce est nominative et datable.
 *
 * LinkedIn est un cas particulier : `/jobs/view/<id>` est une offre,
 * `/company/<nom>` est une fiche d'entreprise. Seul le premier compte.
 */
const JOB_BOARDS = [
  "welcometothejungle.com",
  "indeed.fr",
  "indeed.com",
  "francetravail.fr",
  "pole-emploi.fr",
  "candidat.francetravail.fr",
  "apec.fr",
  "hellowork.com",
  "cadremploi.fr",
  "monster.fr",
  "regionsjob.com",
  "jobteaser.com",
];

/**
 * Agrégateurs qui republient des annonces sans intitulé exploitable.
 *
 * Ils remontent très haut dans les résultats parce qu'ils créent une page par
 * entreprise. Leur seule information réelle est « cette entreprise existe ».
 */
const AGGREGATORS = [
  "trabajo.org",
  "jobtomove.com",
  "fr.jooble.org",
  "jooble.org",
  "neuvoo.fr",
  "talent.com",
  "jobrapido.com",
  "optioncarriere.com",
  "emploi.org",
  "meteojob.com",
  "jobijoba.com",
];

/** Chemins qui désignent une page de recrutement sur un site d'entreprise. */
const CAREER_PATH =
  /carri[eè]re|recrutement|nous-rejoindre|rejoignez|offre[s]?-d?-?emploi|jobs?|job-offer|emplois?/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

const matches = (host: string, list: readonly string[]): boolean =>
  list.some((item) => host === item || host.endsWith(`.${item}`));

/**
 * Nature de la source d'une offre.
 *
 * `officialDomain` est le domaine vérifié de l'entreprise : une page de son
 * propre site fait toujours autorité, quelle que soit son URL.
 */
export function classifyJobSource(url: string, officialDomain?: string | null): JobSourceKind {
  const host = hostOf(url);
  if (!host) return "aucune";

  const own = officialDomain?.toLowerCase().replace(/^www\./, "");
  if (own && (host === own || host.endsWith(`.${own}`))) return "officielle";

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    // Une fiche d'entreprise LinkedIn n'est pas une offre.
    return /^\/jobs\/view\//.test(pathOf(url)) ? "officielle" : "aucune";
  }

  if (matches(host, JOB_BOARDS)) return "officielle";
  if (matches(host, AGGREGATORS)) return "agregateur";

  // Site quelconque : seule une page manifestement dédiée au recrutement compte.
  return CAREER_PATH.test(pathOf(url)) ? "officielle" : "aucune";
}

/**
 * Intitulé de poste repéré dans un texte.
 *
 * Sans intitulé, « 12 offres d'emploi » ne dit rien d'exploitable : on ne peut
 * ni écrire dessus, ni juger si le métier est automatisable.
 */
const TITLE_PATTERNS = [
  /\b(?:poste|offre)\s+d[eu']?\s*([A-ZÀ-Ý][\wÀ-ÿ'()/-]*(?:\s+[\wÀ-ÿ'()/-]+){0,4})/,
  /\brecrut(?:e|ons|ement d')\s+(?:un|une|des)?\s*([A-Za-zÀ-ÿ][\wÀ-ÿ'()/-]*(?:\s+[\wÀ-ÿ'()/-]+){0,4})/i,
  /\b(?:recherchons|recherche)\s+(?:un|une|des)?\s*([A-Za-zÀ-ÿ][\wÀ-ÿ'()/-]*(?:\s+[\wÀ-ÿ'()/-]+){0,4})/i,
  /\b([A-Za-zÀ-ÿ][\wÀ-ÿ'()/-]{3,}(?:\s+[\wÀ-ÿ'()/-]+){0,3})\s*\(?\s*(?:H\/F|F\/H)\s*\)?/i,
];

/** Mots qui ne sont pas un intitulé : ils désignent l'annonce, pas le métier. */
const NOT_A_TITLE =
  /^(?:emploi|offre|offres|poste|postes|annonce|annonces|recrutement|candidature|job|jobs|cdi|cdd|stage|alternance)s?$/i;

export function jobTitleIn(text: string): string | null {
  for (const pattern of TITLE_PATTERNS) {
    const match = pattern.exec(text);
    const candidate = match?.[1]?.trim().replace(/[.,;:]$/, "");
    if (!candidate) continue;
    const first = candidate.split(/\s+/)[0];
    if (NOT_A_TITLE.test(first)) continue;
    if (candidate.length < 4 || candidate.length > 70) continue;
    return candidate;
  }
  return null;
}

/**
 * Une source annonce-t-elle un VOLUME d'offres sans en nommer aucune ?
 * (« 12 offres d'emploi chez X », « Emplois : X — 34 postes »)
 */
export function listsOffersWithoutTitle(text: string): boolean {
  return /\b\d+\s+(?:offres?|postes?|emplois?|annonces?)\b/i.test(text) && jobTitleIn(text) === null;
}

import { carriesName, runContactSearch, type ContactDeps } from "./finder";
import { exclusionReason, isServiceProvider, toDomain } from "./domains";
import type { CompanyIdentity, ContactBudget } from "./types";

/**
 * SITE TROUVÉ GRATUITEMENT — avant toute rédaction et avant les appels payants.
 *
 * Décision Cowork (itération 2, 04/10/2026) : 5 fiches sur 10 n'avaient aucun
 * site connu, donc aucun fait propre, donc pas de mail. On cherche le site par
 * la seule chaîne GRATUITE : domaines déduits de la raison sociale et de
 * l'enseigne, chacun validé par la même inspection que la recherche de contact
 * (accueil, mentions légales, SIREN ou nom). Ni Linkup, ni Hunter, ni modèle.
 * Pas de site validé : `null` — jamais un domaine deviné.
 */

/** Rien de payant : seules les lectures de pages (requêtes HTTP) sont permises. */
export const FREE_BUDGET: ContactBudget = { linkup: 0, pages: 4, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 };
export const MAX_CANDIDATE_DOMAINS = 8;
/**
 * Un domaine TROUVÉ (deviné, lu dans une offre, rendu par Linkup) n'est retenu
 * qu'avec la raison sociale ET une seconde attache : SIREN (90) ou ville (75).
 * La raison sociale seule (60) ne suffit pas — un homonyme la porte aussi.
 */
export const MIN_SITE_CONFIDENCE = 75;
/** Score de tri minimal pour dépenser une recherche Linkup sur une fiche. */
export const LINKUP_MIN_SCORE = 4;

const LEGAL_FORMS = /\b(sarl|sas|sasu|eurl|sa|sci|snc|selarl|scop|ets|etablissements?|societe|ste|groupe|holding)\b/g;
const STOP = new Set(["et", "de", "des", "du", "la", "le", "les", "l", "d", "en", "a", "au", "aux", "and"]);

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " et ")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOP.has(word));

/**
 * Domaines plausibles d'un nom, du plus probable au moins probable :
 * « ACTUEL VERANDA ET MENUISERIE » → actuel-veranda.fr, actuelveranda.fr,
 * actuel-veranda.com, …, actuel-veranda-menuiserie.fr… Code pur.
 */
export function candidateDomains(names: readonly (string | null | undefined)[], city?: string | null): string[] {
  const out: string[] = [];
  const push = (label: string) => {
    if (label.length < 3 || label.length > 40) return;
    for (const tld of ["fr", "com"]) {
      const domain = `${label}.${tld}`;
      if (!out.includes(domain)) out.push(domain);
    }
  };
  const place = tokens(city ?? "").join("-");
  const expanded = names.flatMap((name) => {
    const inner = [...(name ?? "").matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
    return [...inner, name];
  });
  for (const name of expanded) {
    // « C.T.A. » : des lettres isolées forment un sigle, « cta » — repéré sur le
    // nom BRUT (« a » serait sinon retiré comme mot vide).
    const acronym = /^\s*([a-z]\s*[.\s]\s*){2,}[a-z]?\.?\s*$/i.test(name ?? "") ? (name ?? "").replace(/[^a-z]/gi, "").toLowerCase() : null;
    const raw = tokens(name ?? "");
    const words = acronym ? [acronym] : raw.filter((word) => word.length > 1);
    if (!words.length) continue;
    const two = words.slice(0, 2);
    if (two.length === 2) {
      push(two.join("-"));
      push(two.join(""));
    }
    push(words.slice(0, 3).join("-"));
    if (words[0].length >= 3) push(words[0]);
    if (place) push(`${words.slice(0, 2).join("-")}-${place}`);
  }
  return out.slice(0, MAX_CANDIDATE_DOMAINS * 2);
}

export interface FreeSite {
  website: string;
  domain: string;
  confidence: number;
}

/** Valide UN domaine : la même inspection que la recherche de contact, seuil strict. */
async function validateDomain(
  company: Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail">,
  domain: string,
  deps: ContactDeps,
): Promise<FreeSite | null> {
  if (exclusionReason(domain) || isServiceProvider(domain)) return null;
  const search = await runContactSearch(
    { ...company, knownWebsite: `https://${domain}`, pappersWebsite: null, knownEmail: null },
    deps,
    FREE_BUDGET,
    { hunter: { allowed: false, reason: "recherche de site seule" } },
  ).catch(() => null);
  const website = search?.result.website;
  const found = website ? toDomain(website) : null;
  // La confiance du SITE est dans la trace : celle du résultat est celle du
  // CONTACT (divisée par deux quand aucune adresse n'est trouvée).
  const checked = search?.trace.candidates.find((item) => item.domain === found);
  if (!website || !found || !checked?.validated || checked.confidence < MIN_SITE_CONFIDENCE) return null;
  return { website, domain: found, confidence: checked.confidence };
}

/** Les recherches web et Hunter ne passent JAMAIS par la validation. */
const freeOnly = (deps: ContactDeps): ContactDeps => ({
  fetchHtml: deps.fetchHtml,
  webSearch: async () => null,
  hunterDomainSearch: async () => null,
  hunterFinder: async () => null,
  hunterVerify: async () => null,
});

export async function findSiteFree(
  company: Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail">,
  deps: ContactDeps,
  options: { deadline?: number } = {},
): Promise<FreeSite | null> {
  const domains = candidateDomains([...company.tradeNames, company.legalName], company.city).slice(0, MAX_CANDIDATE_DOMAINS);
  for (const domain of domains) {
    if (options.deadline && Date.now() > options.deadline) break;
    const site = await validateDomain(company, domain, freeOnly(deps));
    if (site) return site;
  }
  return null;
}

export type SiteSource = "connu" | "offre" | "domaine" | "linkup";
export interface ResolvedSite extends FreeSite {
  by: SiteSource;
}

/**
 * RÉSOLUTION DU SITE (complétion automatique, Cowork 05/10/2026), dans l'ordre,
 * arrêt au premier site VALIDÉ :
 *   a. URL déjà connues, gratuites ou déjà payées : site Pappers, site de
 *      l'entreprise dans l'offre France Travail, domaine d'une adresse connue ;
 *   b. domaines déduits du nom (gratuit) ;
 *   c. Linkup « <enseigne ou raison sociale> <ville> site officiel » — score de
 *      tri ≥ 4 seulement, sous le plafond du jour (lib/linkup/gate.ts).
 * Jamais un annuaire, un site d'emploi ou un réseau social (liste d'exclusion).
 */
export async function resolveSite(
  company: Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail">,
  deps: ContactDeps,
  options: { knownUrls?: readonly (string | null | undefined)[]; score?: number | null; deadline?: number } = {},
): Promise<{ site: ResolvedSite | null; linkupQueries: number }> {
  const free = freeOnly(deps);
  const late = () => Boolean(options.deadline && Date.now() > options.deadline);
  for (const url of options.knownUrls ?? []) {
    const domain = toDomain(url);
    if (!domain || late()) continue;
    const site = await validateDomain(company, domain, free);
    if (site) return { site: { ...site, by: url?.includes("@") ? "connu" : "offre" }, linkupQueries: 0 };
  }
  const guessed = await findSiteFree(company, deps, { deadline: options.deadline });
  if (guessed) return { site: { ...guessed, by: "domaine" }, linkupQueries: 0 };
  if ((options.score ?? 0) < LINKUP_MIN_SCORE || late()) return { site: null, linkupQueries: 0 };

  const name = company.tradeNames[0] ?? company.legalName;
  const query = [name, company.city, "site officiel"].filter(Boolean).join(" ");
  const results = (await deps.webSearch(query).catch(() => null)) ?? [];
  const domains = [...new Set(results.map((item) => toDomain(item.url)).filter((domain): domain is string => Boolean(domain)))]
    .filter((domain) => !exclusionReason(domain) && !isServiceProvider(domain))
    .sort((a, b) => Number(carriesName(b, company as CompanyIdentity)) - Number(carriesName(a, company as CompanyIdentity)))
    .slice(0, 3);
  for (const domain of domains) {
    if (late()) break;
    const site = await validateDomain(company, domain, free);
    if (site) return { site: { ...site, by: "linkup" }, linkupQueries: 1 };
  }
  return { site: null, linkupQueries: 1 };
}

/** Identité minimale, SANS appel Pappers : nom, enseignes, SIREN, ville. */
export function siteIdentity(input: {
  id?: string | null;
  name: string;
  tradeNames?: readonly (string | null | undefined)[];
  siren?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail"> {
  return {
    prospectId: input.id ?? null,
    legalName: input.name,
    tradeNames: (input.tradeNames ?? []).filter((name): name is string => Boolean(name && name.trim() && name !== input.name)),
    siren: input.siren?.replace(/\s/g, "") || null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    leader: null,
    activity: null,
  };
}

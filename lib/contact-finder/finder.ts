import { domainOfEmail, isExcludedDomain, isFreeMailbox, toDomain } from "./domains";
import { classifyEmail, emailDomains, extractEmails, type EmailKind } from "./extract";
import { pagesToVisit, textOf } from "./links";
import { judgePage } from "./validate";
import {
  DEFAULT_BUDGET,
  type CompanyIdentity,
  type ContactBudget,
  type ContactResult,
  type ContactTrace,
} from "./types";

/**
 * Recherche du contact d'une fiche, sans aucune dépendance réseau directe.
 *
 * Tout ce qui sort (pages, Linkup, Hunter, modèle) passe par `ContactDeps` :
 * les tests rejouent du HTML enregistré, la production branche les vrais
 * clients (clients.ts). Le budget est vérifié AVANT chaque appel : un appel
 * refusé n'est pas fait, il n'est pas seulement compté.
 */

export type VerifierStatus = "valid" | "accept_all" | "invalid" | "unknown" | "disposable" | "webmail";

export interface HunterHit {
  email: string;
  type: "personal" | "generic" | null;
  firstName: string | null;
  lastName: string | null;
  sources: string[];
}

export interface ContactDeps {
  fetchHtml(url: string): Promise<{ html: string; url: string } | null>;
  webSearch(query: string): Promise<{ url: string; title: string; snippet: string }[] | null>;
  hunterDomainSearch(domain: string): Promise<HunterHit[] | null>;
  hunterFinder(domain: string, firstName: string, lastName: string): Promise<{ email: string } | null>;
  hunterVerify(email: string): Promise<VerifierStatus | null>;
  /** Départage de candidats ambigus : un appel de modèle, au plus. */
  pickDomain?(company: CompanyIdentity, options: { domain: string; excerpt: string }[]): Promise<string | null>;
}

interface Candidate {
  domain: string;
  by: string;
}

interface SiteEmail {
  email: string;
  url: string;
}

interface Checked {
  domain: string;
  by: string;
  confidence: number;
  validated: boolean;
  reason: string;
  emails: SiteEmail[];
  excerpt: string;
}

const EMPTY_SPENT = (): ContactBudget => ({
  linkup: 0, pages: 0, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0,
});

/** Requêtes web, dans l'ordre : nom commercial, mentions légales, SIREN. */
export function searchQueries(company: CompanyIdentity): string[] {
  const queries: string[] = [];
  const trade = company.tradeNames.find((name) => name.toLowerCase() !== company.legalName.toLowerCase());
  if (trade) queries.push(`"${trade}" ${company.city ?? ""}`.trim());
  queries.push(`"${company.legalName}" mentions légales`);
  if (company.siren) queries.push(`"${company.siren}" mentions légales`);
  else if (!trade) queries.push(`"${company.legalName}" ${company.city ?? ""}`.trim());
  return queries;
}

export async function runContactSearch(
  company: CompanyIdentity,
  deps: ContactDeps,
  budget: ContactBudget = DEFAULT_BUDGET,
): Promise<{ result: ContactResult; trace: ContactTrace }> {
  const spent = EMPTY_SPENT();
  const trace: ContactTrace = { spent, candidates: [], emailDomains: [], steps: [] };
  const can = (key: keyof ContactBudget) => spent[key] < budget[key];
  const use = (key: keyof ContactBudget) => {
    spent[key] += 1;
  };

  // --- 1. Candidats gratuits ----------------------------------------------
  const candidates: Candidate[] = [];
  const add = (domain: string | null, by: string) => {
    if (!domain || isExcludedDomain(domain) || isFreeMailbox(domain)) return;
    if (!candidates.some((item) => item.domain === domain)) candidates.push({ domain, by });
  };
  add(toDomain(company.knownWebsite), "site connu");
  add(toDomain(company.pappersWebsite), "pappers");
  add(domainOfEmail(company.knownEmail), "adresse connue");

  const checked: Checked[] = [];
  const check = async (candidate: Candidate) => {
    const result = await inspect(candidate, company, deps, () => can("pages"), () => use("pages"));
    checked.push(result);
    trace.candidates.push({
      domain: result.domain, by: result.by, confidence: result.confidence, validated: result.validated, reason: result.reason,
    });
    trace.steps.push(`${result.domain} (${result.by}) : ${result.reason}`);
    return result;
  };

  for (const candidate of candidates) {
    if (!can("pages")) break;
    if ((await check(candidate)).confidence >= 90) break;
  }

  // --- 2. Recherche web, tant qu'aucun domaine n'est prouvé -----------------
  const snippetEmails: SiteEmail[] = [];
  for (const query of searchQueries(company)) {
    if (checked.some((item) => item.validated) || !can("linkup")) break;
    use("linkup");
    const results = (await deps.webSearch(query)) ?? [];
    trace.steps.push(`recherche « ${query} » : ${results.length} résultat(s)`);
    const fresh: Candidate[] = [];
    for (const item of results) {
      for (const email of extractEmails(`${item.title} ${item.snippet}`)) snippetEmails.push({ email, url: item.url });
      const domain = toDomain(item.url);
      if (domain && !isExcludedDomain(domain) && !candidates.some((c) => c.domain === domain) && !fresh.some((c) => c.domain === domain)) {
        fresh.push({ domain, by: `linkup:${query}` });
      }
    }
    candidates.push(...fresh);
    for (const candidate of fresh.slice(0, 3)) {
      if (!can("pages")) break;
      if ((await check(candidate)).validated) break;
    }
  }

  // --- 3. Choix du domaine ------------------------------------------------
  let site = pickBest(checked);
  const ambiguous = checked.filter((item) => item.confidence >= 20).sort((a, b) => b.confidence - a.confidence);
  const tie = site && ambiguous.filter((item) => item.validated && item.confidence === site!.confidence).length > 1;
  if ((tie || (!site && ambiguous.length >= 2)) && deps.pickDomain && can("llm")) {
    use("llm");
    const picked = await deps.pickDomain(company, ambiguous.slice(0, 4).map(({ domain, excerpt }) => ({ domain, excerpt })));
    const chosen = ambiguous.find((item) => item.domain === picked);
    trace.steps.push(`départage par le modèle : ${picked ?? "aucun"}`);
    if (chosen) site = chosen.validated ? chosen : { ...chosen, validated: true, confidence: 50, reason: "départagé par le modèle" };
  }

  const siteUrl = site ? `https://${site.domain}` : undefined;
  const person = company.leader;
  const siteEmails = site ? site.emails : [];
  const domains = emailDomains(siteEmails.map((item) => item.email), site?.domain ?? null);
  if (site && !domains.includes(site.domain)) domains.push(site.domain);
  trace.emailDomains = domains;

  // --- 4. Hunter : sur les domaines d'ADRESSE, pas seulement celui du site --
  type Nominal = { email: string; url: string; by: string; verified: VerifierStatus | null; guessed: boolean };
  const nominals: Nominal[] = [];
  const hunterGeneric: SiteEmail[] = [];
  for (const domain of domains) {
    if (!can("hunterDomainSearch")) break;
    use("hunterDomainSearch");
    const hits = (await deps.hunterDomainSearch(domain)) ?? [];
    trace.steps.push(`Hunter domain-search ${domain} : ${hits.length} adresse(s)`);
    for (const hit of hits) {
      const kind: EmailKind = hit.type === "personal" ? "nominatif" : hit.type === "generic" ? "generique" : classifyEmail(hit.email, person);
      const url = hit.sources[0] ?? siteUrl ?? `https://${domain}`;
      if (kind === "nominatif") nominals.push({ email: hit.email, url, by: "hunter:domain-search", verified: null, guessed: false });
      else hunterGeneric.push({ email: hit.email, url });
    }
  }
  if (person && domains[0] && can("hunterFinder") && !nominals.some((item) => matchesPerson(item.email, person))) {
    use("hunterFinder");
    const found = await deps.hunterFinder(domains[0], person.firstName, person.lastName);
    trace.steps.push(`Hunter email-finder ${person.firstName} ${person.lastName} @${domains[0]} : ${found?.email ?? "rien"}`);
    if (found) nominals.unshift({ email: found.email, url: siteUrl ?? `https://${domains[0]}`, by: "hunter:email-finder", verified: null, guessed: true });
  }
  // Le dirigeant d'abord : c'est à lui qu'on écrit.
  nominals.sort((a, b) => Number(matchesPerson(b.email, person)) - Number(matchesPerson(a.email, person)));
  for (const item of nominals) {
    if (!can("hunterVerifier")) break;
    use("hunterVerifier");
    item.verified = await deps.hunterVerify(item.email);
    trace.steps.push(`Hunter email-verifier ${item.email} : ${item.verified ?? "sans réponse"}`);
  }

  // --- 5. Priorité : nominatif valide > nominatif accept_all > générique ----
  const base = site?.confidence ?? 0;
  const valid = nominals.find((item) => item.verified === "valid");
  // Une adresse DEVINÉE (email-finder) ne passe qu'avec « valid » : jamais sur
  // un simple accept_all, qui accepte n'importe quelle adresse du domaine.
  const acceptAll = nominals.find((item) => item.verified === "accept_all" && !item.guessed);
  const generic = pickGeneric(siteEmails) ?? pickGeneric(hunterGeneric);

  let result: ContactResult;
  if (valid) {
    result = contact(valid.email, "nominatif", valid.url, Math.max(85, Math.min(98, 70 + Math.round(base / 4))), `${valid.by}+verifier:valid`, siteUrl);
  } else if (acceptAll) {
    result = contact(acceptAll.email, "nominatif", acceptAll.url, 65, `${acceptAll.by}+verifier:accept_all`, siteUrl);
  } else if (generic) {
    const fromSite = siteEmails.some((item) => item.email === generic.email);
    result = contact(generic.email, "generique", generic.url, fromSite ? Math.min(85, Math.max(50, base)) : 45, fromSite ? `site:${pageKind(generic.url)}` : "hunter:domain-search", siteUrl);
  } else {
    result = { ...(siteUrl ? { website: siteUrl } : {}), confidence: site ? Math.round(base / 2) : 0, found_by: site ? `site:${site.by}` : "aucun" };
  }
  if (!site && snippetEmails.length) trace.steps.push(`adresses vues dans la recherche, non retenues (site non prouvé) : ${snippetEmails.map((item) => item.email).join(", ")}`);
  return { result, trace };
}

function contact(email: string, type: EmailKind, url: string, confidence: number, found_by: string, website?: string): ContactResult {
  return { ...(website ? { website } : {}), email, email_type: type, email_source_url: url, confidence, found_by };
}

function matchesPerson(email: string, person: CompanyIdentity["leader"]): boolean {
  if (!person) return false;
  const local = email.split("@")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const last = person.lastName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  return last.length >= 3 && local.replace(/[^a-z]/g, "").includes(last);
}

/** contact@ avant accueil@/info@ avant le reste. */
function pickGeneric(emails: SiteEmail[]): SiteEmail | null {
  const rank = (email: string) => {
    const local = email.split("@")[0];
    if (local === "contact") return 0;
    if (/^(accueil|info|infos|bonjour|hello)$/.test(local)) return 1;
    return 2;
  };
  return [...emails].sort((a, b) => rank(a.email) - rank(b.email))[0] ?? null;
}

function pageKind(url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/mention|legal/.test(path)) return "mentions-legales";
  if (/contact/.test(path)) return "contact";
  if (/propos|qui-sommes|about/.test(path)) return "a-propos";
  return path === "/" || !path ? "accueil" : path.replace(/^\//, "");
}

function pickBest(checked: Checked[]): Checked | null {
  return [...checked].filter((item) => item.validated).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/** Accueil + pages légales/contact d'un domaine, jugées et fouillées. */
async function inspect(
  candidate: Candidate,
  company: CompanyIdentity,
  deps: ContactDeps,
  canRead: () => boolean,
  spend: () => void,
): Promise<Checked> {
  const origin = `https://${candidate.domain}`;
  const out: Checked = { ...candidate, confidence: 0, validated: false, reason: "site injoignable", emails: [], excerpt: "" };
  if (!canRead()) return { ...out, reason: "budget de pages épuisé" };

  spend();
  let home = await deps.fetchHtml(origin);
  // Certains domaines ne répondent qu'en « www. » (pas d'enregistrement DNS nu).
  if (!home && canRead()) {
    spend();
    home = await deps.fetchHtml(`https://www.${candidate.domain}`);
  }
  if (!home) return out;
  const queue = pagesToVisit(home.html, home.url || origin);
  const pages = [home];
  for (const url of queue) {
    if (pages.length >= 4 || !canRead()) break;
    spend();
    const page = await deps.fetchHtml(url);
    if (page) pages.push(page);
  }

  // Bonus de source : un site saisi ou déclaré chez Pappers part avec un a priori.
  const prior = candidate.by === "site connu" || candidate.by === "pappers" ? 5 : 0;
  for (const page of pages) {
    const evidence = judgePage(textOf(page.html), company);
    if (evidence.confidence > out.confidence) Object.assign(out, { confidence: evidence.confidence, validated: evidence.validated, reason: evidence.reason });
    for (const email of extractEmails(page.html)) {
      if (!out.emails.some((item) => item.email === email)) out.emails.push({ email, url: page.url });
    }
  }
  if (out.validated) out.confidence = Math.min(100, out.confidence + prior);
  out.excerpt = pages.map((page) => textOf(page.html)).join(" ").slice(0, 600);
  return out;
}

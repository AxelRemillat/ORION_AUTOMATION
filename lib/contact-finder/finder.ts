import { isRoleBox } from "./role-boxes";
import { domainOfEmail, exclusionReason, isFreeMailbox, isServiceProvider, toDomain } from "./domains";
import { classifyEmail, emailDomains, extractEmails, extractPhones, namesSomeone, type EmailKind } from "./extract";
import { pagesToVisit, textOf } from "./links";
import { coreName, judgePage } from "./validate";
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

/**
 * Réglage de l'appel Hunter, décidé AVANT la recherche par l'appelant
 * (`hunterPolicy` + garde-fou du jour, lib/contact-finder/index.ts).
 * Absent : Hunter autorisé (tests, script de mesure).
 */
export interface ContactSearchOptions {
  hunter?: { allowed: boolean; reason?: string };
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
  /** Téléphones lus sur le site, avec leur page. */
  phones: { phone: string; url: string }[];
  excerpt: string;
  pages: { url: string; ok: boolean }[];
}

/** Motif pour lequel un domaine n'est jamais lu, ou `null` s'il peut l'être. */
function skipReason(domain: string): string | null {
  if (isFreeMailbox(domain)) return "messagerie grand public";
  if (isServiceProvider(domain)) return "hébergeur ou prestataire technique";
  return exclusionReason(domain);
}

const EMPTY_SPENT = (): ContactBudget => ({
  linkup: 0, pages: 0, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0,
});

/** Requêtes web, dans l'ordre : nom commercial, mentions légales, SIREN. */
export function searchQueries(company: CompanyIdentity): string[] {
  /*
   * L'ORDRE DÉCIDE DU RÉSULTAT, parce que le budget de pages est petit.
   *
   * Mesuré sur BRIOL DIFFUSION (SIREN 421882440) le 28/09/2026 : la requête par
   * nom commercial partait en premier et rendait trois domaines sans rapport
   * (un blog, data.inpi.fr, un agrégateur). Chacun coûte deux lectures — une
   * pour le domaine nu, une pour « www. » — donc les huit pages du budget
   * étaient dépensées avant la requête suivante. Or le site officiel,
   * menuiseriebriol-diffusion.com, était le PREMIER résultat de
   * « "BRIOL DIFFUSION" mentions légales ». Il n'a jamais été lu.
   *
   * On commence donc par le plus précis. Le SIREN d'abord : il ne peut pas
   * désigner une homonyme, et une page de mentions légales qui le porte prouve
   * le rattachement à elle seule.
   */
  const queries: string[] = [];
  if (company.siren) queries.push(`"${company.siren}" mentions légales`);
  queries.push(`"${company.legalName}" mentions légales`);

  /*
   * Troisième requête : le NOM, le MÉTIER et la VILLE, sans guillemets.
   *
   * Pour SARL BONNIN FRERES, les deux requêtes de mentions légales ne rendent
   * que des annuaires et des homonymes (bonin-tp.fr, bonnin-freres.com, une
   * psychologue). « "BONNIN FRERES" ANGLES » aussi. Ce qui fait sortir
   * boulangerie-bonnin.fr, c'est d'ajouter le métier :
   * « bonnin freres Boulangerie et boulangerie-pâtisserie ANGLES ».
   *
   * Le nom commercial passe devant la raison sociale quand il en diffère : c'est
   * lui que le site affiche.
   */
  const trade = company.tradeNames.find((name) => name.toLowerCase() !== company.legalName.toLowerCase());
  const name = trade ?? company.legalName;
  const place = company.city ?? "";
  if (company.activity) queries.push(`${name} ${company.activity} ${place}`.replace(/\s+/g, " ").trim());
  else if (trade) queries.push(`"${trade}" ${place}`.trim());
  else if (!company.siren) queries.push(`"${company.legalName}" ${place}`.trim());
  return queries;
}

export async function runContactSearch(
  company: CompanyIdentity,
  deps: ContactDeps,
  budget: ContactBudget = DEFAULT_BUDGET,
  options: ContactSearchOptions = {},
): Promise<{ result: ContactResult; trace: ContactTrace }> {
  const spent = EMPTY_SPENT();
  const trace: ContactTrace = { spent, candidates: [], emailDomains: [], steps: [], queries: [], skipped: [], hunter: [] };
  const skip = (domain: string, reason: string) => {
    if (!trace.skipped!.some((item) => item.domain === domain)) trace.skipped!.push({ domain, reason });
  };
  const can = (key: keyof ContactBudget) => spent[key] < budget[key];
  const use = (key: keyof ContactBudget) => {
    spent[key] += 1;
  };

  // --- 1. Candidats gratuits ----------------------------------------------
  const candidates: Candidate[] = [];
  const add = (domain: string | null, by: string) => {
    if (!domain) return;
    const reason = skipReason(domain);
    if (reason) return skip(domain, reason);
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
      pages: result.pages,
    });
    trace.steps.push(`${result.domain} (${result.by}) : ${result.reason}`);
    return result;
  };

  for (const candidate of candidates) {
    if (!can("pages")) break;
    if ((await check(candidate)).confidence >= 90) break;
  }

  // --- 2. Recherche web, tant qu'aucun domaine n'est prouvé -----------------
  /*
   * UNE REQUÊTE NE PEUT PAS DÉPENSER TOUT LE BUDGET DE PAGES.
   *
   * Mesuré sur BRIOL DIFFUSION et ARTFLEX le 28/09/2026 : la première requête
   * rendait deux ou trois domaines sans rapport (un répertoire de créances, un
   * site dont la page de mentions légales cite des SIREN de clients). Chacun
   * coûte deux lectures — domaine nu, puis « www. » — et les huit pages du
   * budget étaient dépensées avant la requête suivante. Or le site officiel
   * était dans les résultats de cette requête suivante, deux fois sur deux.
   *
   * On réserve donc une part égale à chaque requête. La dernière hérite de ce
   * qui reste : rien n'est perdu quand les premières ont été économes.
   */
  const queries = searchQueries(company);
  const shareOfPages = Math.max(2, Math.floor(budget.pages / Math.max(1, queries.length)));
  const snippetEmails: SiteEmail[] = [];
  for (const [index, query] of queries.entries()) {
    if (checked.some((item) => item.validated) || !can("linkup")) break;
    const pagesAtStart = spent.pages;
    const last = index === queries.length - 1;
    const withinShare = () => last || spent.pages - pagesAtStart < shareOfPages;
    use("linkup");
    const results = (await deps.webSearch(query)) ?? [];
    trace.steps.push(`recherche « ${query} » : ${results.length} résultat(s)`);
    trace.queries!.push({ query, results: results.length });
    const fresh: Candidate[] = [];
    for (const item of results) {
      for (const email of extractEmails(`${item.title} ${item.snippet}`)) snippetEmails.push({ email, url: item.url });
      const domain = toDomain(item.url);
      const excluded = domain ? exclusionReason(domain) ?? (isServiceProvider(domain) ? "hébergeur ou prestataire technique" : null) : null;
      if (domain && excluded) skip(domain, excluded);
      if (
        domain &&
        !excluded &&
        !candidates.some((c) => c.domain === domain) &&
        !fresh.some((c) => c.domain === domain)
      ) {
        fresh.push({ domain, by: `linkup:${query}` });
      }
    }
    candidates.push(...fresh);

    /*
     * UN DOMAINE QUI PORTE LEUR NOM PASSE DEVANT.
     *
     * Trois candidats au plus sont lus par requête, dans l'ordre du moteur. Sur
     * SARL BONNIN FRERES, cet ordre donnait boulangeriespatisseries.fr (un
     * annuaire), boulangerie-patisserie-harel.fr (un concurrent) puis un
     * domaine parasite — et boulangerie-bonnin.fr, quatrième, n'était jamais lu.
     *
     * Le nom dans le domaine n'est pas une preuve — la validation reste
     * nécessaire — mais c'est le meilleur ordre de lecture disponible, et il ne
     * coûte rien.
     */
    const ranked = [...fresh].sort(
      (a, b) => Number(carriesName(b.domain, company)) - Number(carriesName(a.domain, company)),
    );
    for (const candidate of ranked.slice(0, 3)) {
      if (!can("pages") || !withinShare()) break;
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

  /*
   * --- 4. DOMAINE DE CONFIANCE -------------------------------------------
   *
   * Une adresse n'est gardée que si son domaine est celui du site (ou un
   * sous-domaine), ou un domaine d'adresse publiée dans les MENTIONS LÉGALES
   * — l'entreprise y déclare où on la joint. Sinon, seule une vérification
   * Hunter « valid » la sauve, avec le drapeau « douteux ».
   *
   * Cas réel (30/09/2026) : HÖRMANN FRANCE sortait « contactable » avec
   * louis@louis.info — une adresse vue sur le site, d'un domaine sans rapport,
   * interrogée chez Hunter comme un « second domaine ».
   *
   * Les mentions légales citent AUSSI des tiers : l'hébergeur (obligatoire),
   * l'agence web, le photographe. Rejeu du 30/09 : support@ovhcloud.com pour
   * BOUVET CARTIER, contact@lamobylettejaune.com (agence) pour ACTES ALLIANCES.
   * Un domaine autre que celui du site n'est donc de confiance que s'il PORTE
   * LE NOM de l'entreprise (briol-diffusion.fr, belledonnebio.shop) et n'est
   * pas un prestataire technique.
   */
  const trusted = (email: string) => {
    const domain = domainOfEmail(email);
    if (!domain || !site) return false;
    if (domain === site.domain || domain.endsWith(`.${site.domain}`)) return true;
    return !isServiceProvider(domain) && carriesName(domain, company);
  };

  /*
   * --- 5. Hunter : SEULEMENT SI LE GRATUIT N'A RIEN DONNÉ ------------------
   *
   * 01/10/2026 : un run a épuisé les crédits d'un coup. Hunter partait sur
   * chaque fiche, même quand le site (accueil, mentions légales, adresse
   * masquée par Joomla, second domaine) avait déjà donné une adresse de
   * confiance. Désormais : une adresse de confiance lue sur le site → pas
   * d'appel. Et rien sans le feu vert de l'appelant (score ≥ 4, opposition,
   * taille, budget du jour — cf. `hunterPolicy`).
   */
  const freeFound = siteEmails.some((item) => trusted(item.email));
  const policy = options.hunter ?? { allowed: true };
  const hunterSkip = freeFound
    ? "adresse de confiance trouvée sur le site"
    : policy.allowed
      ? null
      : policy.reason ?? "Hunter non autorisé";
  if (hunterSkip) trace.steps.push(`Hunter non appelé : ${hunterSkip}`);

  type Nominal = { email: string; url: string; by: string; verified: VerifierStatus | null; guessed: boolean };
  const nominals: Nominal[] = [];
  const hunterGeneric: SiteEmail[] = [];
  for (const domain of hunterSkip ? [] : domains) {
    if (!can("hunterDomainSearch")) break;
    use("hunterDomainSearch");
    const hits = ((await deps.hunterDomainSearch(domain)) ?? []).filter((hit) => !isRoleBox(hit.email));
    trace.steps.push(`Hunter domain-search ${domain} : ${hits.length} adresse(s)`);
    trace.hunter!.push({ call: "domain-search", target: domain, result: `${hits.length} adresse(s)` });
    for (const hit of hits) {
      // « personal » de Hunter n'est cru que si le libelle peut nommer quelqu'un.
      const kind: EmailKind =
        hit.type === "generic"
          ? "generique"
          : hit.type === "personal" && namesSomeone(hit.email)
            ? "nominatif"
            : classifyEmail(hit.email, person);
      const url = hit.sources[0] ?? siteUrl ?? `https://${domain}`;
      if (kind === "nominatif") nominals.push({ email: hit.email, url, by: "hunter:domain-search", verified: null, guessed: false });
      else hunterGeneric.push({ email: hit.email, url });
    }
  }
  if (!hunterSkip && person && domains[0] && can("hunterFinder") && !nominals.some((item) => matchesPerson(item.email, person))) {
    use("hunterFinder");
    const found = await deps.hunterFinder(domains[0], person.firstName, person.lastName);
    trace.steps.push(`Hunter email-finder ${person.firstName} ${person.lastName} @${domains[0]} : ${found?.email ?? "rien"}`);
    trace.hunter!.push({ call: "email-finder", target: `${person.firstName} ${person.lastName} @${domains[0]}`, result: found?.email ?? "rien" });
    if (found && !isRoleBox(found.email)) nominals.unshift({ email: found.email, url: siteUrl ?? `https://${domains[0]}`, by: "hunter:email-finder", verified: null, guessed: true });
  }
  // Le dirigeant d'abord : c'est à lui qu'on écrit.
  nominals.sort((a, b) => Number(matchesPerson(b.email, person)) - Number(matchesPerson(a.email, person)));
  for (const item of nominals) {
    if (!can("hunterVerifier")) break;
    // Seules les adresses NOMINATIVES passent ici : une adresse générique (lue
    // sur le site ou rendue par Hunter) n'est jamais soumise à l'email-verifier.
    use("hunterVerifier");
    item.verified = await deps.hunterVerify(item.email);
    trace.steps.push(`Hunter email-verifier ${item.email} : ${item.verified ?? "sans réponse"}`);
    trace.hunter!.push({ call: "email-verifier", target: item.email, result: item.verified ?? "sans réponse" });
  }

  // --- 6. Priorité : nominatif valide > nominatif accept_all > générique ----
  const base = site?.confidence ?? 0;
  const valid = nominals.find((item) => item.verified === "valid");
  // Une adresse DEVINÉE (email-finder) ne passe qu'avec « valid » : jamais sur
  // un simple accept_all, qui accepte n'importe quelle adresse du domaine.
  // Et un accept_all ne prouve rien d'un domaine étranger au site.
  const acceptAll = nominals.find((item) => item.verified === "accept_all" && !item.guessed && trusted(item.email));
  // Générique hors domaine de confiance : JAMAIS gardé, même « valid » chez
  // Hunter — une boîte valide d'un tiers (support@ovhcloud.com) reste celle
  // d'un tiers. L'exception « valid » ne vaut que pour une adresse NOMINATIVE.
  const generic = pickGeneric(siteEmails.filter((item) => trusted(item.email))) ?? pickGeneric(hunterGeneric.filter((item) => trusted(item.email)));
  const genericDoubtful = false;
  if (!valid && !acceptAll && !generic) {
    const outsider = pickGeneric(siteEmails) ?? pickGeneric(hunterGeneric);
    if (outsider) trace.steps.push(`adresse écartée, domaine étranger au site et à l'entreprise : ${outsider.email}`);
  }

  let result: ContactResult;
  if (valid) {
    result = contact(valid.email, "nominatif", valid.url, Math.max(85, Math.min(98, 70 + Math.round(base / 4))), `${valid.by}+verifier:valid`, siteUrl);
    if (!trusted(valid.email)) result.doubtful = true;
  } else if (acceptAll) {
    result = contact(acceptAll.email, "nominatif", acceptAll.url, 65, `${acceptAll.by}+verifier:accept_all`, siteUrl);
  } else if (generic) {
    const fromSite = siteEmails.some((item) => item.email === generic!.email);
    result = contact(generic.email, "generique", generic.url, fromSite ? Math.min(85, Math.max(50, base)) : 45, fromSite ? `site:${pageKind(generic.url)}` : "hunter:domain-search", siteUrl);
    if (genericDoubtful) result.doubtful = true;
  } else {
    result = { ...(siteUrl ? { website: siteUrl } : {}), confidence: site ? Math.round(base / 2) : 0, found_by: site ? `site:${site.by}` : "aucun" };
  }
  // Le téléphone du site : sans email, c'est lui qui permet de joindre l'entreprise.
  // Les mentions légales et la page contact d'abord, l'accueil ensuite.
  const phones = site?.phones ?? [];
  const phone = phones.find((item) => /contact|mention|legal/.test(item.url)) ?? phones[0];
  if (phone) result.phone = phone.phone;
  // Rien trouvé, et Hunter retenu faute de feu vert : on dit pourquoi.
  if (!result.email && hunterSkip && !freeFound) result.hunter_skipped = hunterSkip;
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

/**
 * Le libellé du domaine reprend-il un mot distinctif de leur nom ?
 *
 * On compare des mots de quatre lettres au moins, formes juridiques retirées :
 * « briol » dans menuiseriebriol-diffusion.com, « bonnin » dans
 * boulangerie-bonnin.fr. Les mots trop courts ou trop communs sont écartés par
 * `coreName`, qui enlève déjà « societe », « groupe », « ets ».
 */
export function carriesName(domain: string, company: CompanyIdentity): boolean {
  const host = domain.toLowerCase().replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "");
  const words = [company.legalName, ...company.tradeNames]
    .flatMap((name) => coreName(name).split(" "))
    .filter((word) => word.length >= 4);
  return words.some((word) => host.includes(word));
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
  const out: Checked = { ...candidate, confidence: 0, validated: false, reason: "site injoignable", emails: [], phones: [], excerpt: "", pages: [] };
  if (!canRead()) return { ...out, reason: "budget de pages épuisé" };
  const read = async (url: string) => {
    spend();
    const page = await deps.fetchHtml(url);
    out.pages.push({ url, ok: Boolean(page) });
    return page;
  };

  let home = await read(origin);
  // Certains domaines ne répondent qu'en « www. » (pas d'enregistrement DNS nu).
  if (!home && canRead()) home = await read(`https://www.${candidate.domain}`);
  if (!home) return out;
  const queue = pagesToVisit(home.html, home.url || origin);
  const pages = [home];
  for (const url of queue) {
    if (pages.length >= 4 || !canRead()) break;
    const page = await read(url);
    if (page) pages.push(page);
  }

  // Bonus de source : un site saisi ou déclaré chez Pappers part avec un a priori.
  const declared = candidate.by === "site connu" || candidate.by === "pappers" || candidate.by === "adresse connue";
  const prior = declared ? 5 : 0;
  for (const page of pages) {
    const evidence = judgePage(textOf(page.html), company);
    /*
     * La raison sociale SEULE ne valide pas un domaine trouvé sur le web — un
     * homonyme la porte aussi (cf. artflex.software). Mais quand le domaine a été
     * SAISI par l'utilisateur ou DÉCLARÉ au registre, la question de l'identité
     * ne se pose plus : y lire le nom de l'entreprise suffit à confirmer qu'on
     * est au bon endroit.
     */
    if (declared && !evidence.validated && evidence.confidence >= 60) {
      evidence.validated = true;
      evidence.reason = `${evidence.reason} — domaine déclaré`;
    }
    if (evidence.confidence > out.confidence) Object.assign(out, { confidence: evidence.confidence, validated: evidence.validated, reason: evidence.reason });
    for (const email of extractEmails(page.html)) {
      if (!out.emails.some((item) => item.email === email)) out.emails.push({ email, url: page.url });
    }
    for (const phone of extractPhones(page.html)) {
      if (!out.phones.some((item) => item.phone === phone)) out.phones.push({ phone, url: page.url });
    }
  }
  if (out.validated) out.confidence = Math.min(100, out.confidence + prior);
  out.excerpt = pages.map((page) => textOf(page.html)).join(" ").slice(0, 600);
  return out;
}

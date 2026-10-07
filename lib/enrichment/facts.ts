import { blocksOf } from "@/lib/contact-finder/site-people";
import { rescoreFacts } from "./facts-rules";

/**
 * FAITS DISTINCTIFS SOURCÉS — contrat de données avec le générateur de mails
 * (Cowork #34, 06/10/2026).
 *
 * Constat du double juge : 3 à 6 mails sur 15 seulement atteignent 9/10, faute
 * de faits propres à l'entreprise (« fait pas assez distinctif », « problème
 * générique »). On lit donc davantage le site — produits/services, références,
 * réalisations, actualités, recrutement, certifications, implantations — et on
 * en tire au plus 5 faits, chacun CITÉ mot pour mot dans sa page.
 *
 * Écrit dans `prospects.key_figures` (fusion, rien n'est effacé) :
 *
 *   facts: Array<{
 *     text: string;             // extrait COURT, copié tel quel de la page source
 *     source_url: string;       // page où l'extrait figure
 *     page_kind: "produits" | "references" | "actualites" | "recrutement" | "apropos" | "registre" | "autre";
 *     distinctiveness: 0 | 1 | 2 | 3;
 *     process_hint: string | null; // tâche répétitive probable liée au fait
 *   }>;
 *   facts_score: 0 | 1 | 2 | 3;  // max(distinctiveness), 0 si aucun fait
 *   facts_at: string;            // date de l'extraction (ISO)
 *   facts_version: 1;
 *
 * distinctiveness : 0 = générique au secteur ; 1 = propre à l'entreprise, sans
 * lien avec un process ; 2 = propre ET lié à un process (devis, commandes, SAV,
 * planning, documents…) ; 3 = propre, lié à un process, et vérifiable par une
 * citation de la page.
 *
 * Absence de `facts` = extraction jamais faite (fiche d'avant, ou sans site).
 * `facts: []` = extraction faite, rien de sûr.
 *
 * Garde-fou : un fait dont l'extrait ne se retrouve PAS dans le texte de sa
 * page est rejeté par le code — le modèle ne peut rien inventer.
 */

export const FACTS_VERSION = 1;
export const PAGE_KINDS = ["produits", "references", "actualites", "recrutement", "apropos", "registre", "autre"] as const;
export type FactPageKind = (typeof PAGE_KINDS)[number];

export interface SourcedFact {
  text: string;
  source_url: string;
  page_kind: FactPageKind;
  distinctiveness: 0 | 1 | 2 | 3;
  process_hint: string | null;
}

export interface FactPage {
  url: string;
  kind: FactPageKind;
  text: string;
}

const PAGE_RULES: { kind: FactPageKind; test: RegExp }[] = [
  { kind: "produits", test: /produit|service|solution|offre|prestation|catalogue|gamme|savoir[-_ ]faire|metier|métier|activit/i },
  { kind: "references", test: /reference|référence|client|realisation|réalisation|projet|portfolio|cas[-_ ]client|chantier/i },
  { kind: "actualites", test: /actu|news|blog|presse|evenement|événement/i },
  { kind: "recrutement", test: /recrut|emploi|carri|job|rejoindre|candidat/i },
  { kind: "apropos", test: /propos|qui[-_ ]sommes|about|histoire|entreprise|societe|société|certif|qualit|iso|implant|agence|site|chiffre/i },
];

/** Famille d'une page, d'après son chemin et le libellé du lien. */
export function pageKindOf(probe: string): FactPageKind {
  return PAGE_RULES.find((rule) => rule.test.test(probe))?.kind ?? "autre";
}

/**
 * Pages à lire, au plus `max`, en couvrant d'abord des familles différentes
 * (produits, références, actualités, recrutement, à propos). Même domaine seulement.
 */
export function factPages(html: string, base: string, max = 6): { url: string; kind: FactPageKind }[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const found: { url: string; kind: FactPageKind }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#?]+)[^"']*["'][^>]*>([^<]{0,80})/gi)) {
    let url: URL;
    try {
      url = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?)$/i.test(url.pathname) || url.pathname === "/" || url.pathname === "") continue;
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // chemin mal encodé : gardé tel quel
    }
    if (/mentions|legal|cgv|cookie|confidentialit|privacy|plan[-_ ]du[-_ ]site|login|panier|cart/i.test(path)) continue;
    const kind = pageKindOf(`${path} ${match[2]}`);
    if (kind === "autre") continue;
    const target = `${url.origin}${url.pathname}`;
    if (!found.some((item) => item.url === target)) found.push({ url: target, kind });
  }
  // Une page par famille d'abord, puis le reste dans l'ordre du site.
  const picked: { url: string; kind: FactPageKind }[] = [];
  for (const kind of PAGE_KINDS) {
    const first = found.find((item) => item.kind === kind);
    if (first) picked.push(first);
  }
  for (const item of found) if (!picked.includes(item)) picked.push(item);
  return picked.slice(0, max);
}

/** Texte d'une page pour le modèle : blocs, sans doublons, borné. */
export function pageText(html: string, max = 3000): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of blocksOf(html)) {
    if (line.length < 25 || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  const text = lines.join("\n");
  return text.length > max ? text.slice(0, max) : text;
}

/** Comparaison tolérante : casse, accents, espaces, apostrophes et guillemets. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export const FACTS_SYSTEM = `Tu lis des pages du site d'une PME française et tu en extrais des FAITS PROPRES à cette entreprise, utiles pour un mail de prospection sur l'automatisation de tâches répétitives.

Réponds UNIQUEMENT en JSON : {"facts":[{"quote":"…","source_url":"…","page_kind":"…","distinctiveness":0,"process_hint":null}]}

Règles :
- 5 faits AU PLUS, les plus distinctifs d'abord. Aucun fait si rien n'est sûr.
- "quote" : un extrait COPIÉ MOT POUR MOT de la page (12 à 200 caractères), sans le reformuler ni le compléter. Un extrait introuvable dans la page sera rejeté.
- "source_url" : l'URL exacte de la page qui contient l'extrait (une de celles fournies).
- "page_kind" : produits | references | actualites | recrutement | apropos | autre.
- "distinctiveness" : 0 = générique au secteur (n'importe quel concurrent pourrait l'écrire) ; 1 = propre à l'entreprise (produit précis, client nommé, implantation, chiffre, certification) mais sans lien avec une tâche administrative ou commerciale répétitive ; 2 = propre ET lié à un process (devis, commandes, SAV, planning, documents, facturation, saisie, suivi de chantier…) ; 3 = comme 2, et l'extrait à lui seul le prouve.
- "process_hint" : la tâche répétitive probable que ce fait laisse deviner (« chiffrage de devis sur mesure », « saisie des commandes multi-sites »…), ou null. Jamais une supposition sans rapport avec le fait.
- N'invente rien : ni chiffre, ni client, ni produit absent des pages.`;

/** Message utilisateur : les pages, numérotées, avec leur URL et leur famille. */
export function factsPrompt(company: string, pages: readonly FactPage[]): string {
  return [
    `Entreprise : ${company}`,
    "",
    ...pages.map((page, index) => `### Page ${index + 1} — ${page.kind} — ${page.url}\n${page.text}`),
  ].join("\n\n");
}

/**
 * Faits validés à partir de la réponse du modèle : JSON lisible, extrait
 * présent dans SA page, URL connue, bornes respectées. Pur.
 */
export function validateFacts(raw: string, pages: readonly FactPage[], activity?: string | null, company?: string | null): SourcedFact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray((parsed as { facts?: unknown })?.facts) ? ((parsed as { facts: unknown[] }).facts) : [];
  const normalized = new Map(pages.map((page) => [page.url, normalizeForQuote(page.text)]));
  const facts: SourcedFact[] = [];
  for (const item of items) {
    const fact = item as Record<string, unknown>;
    const quote = typeof fact.quote === "string" ? fact.quote.trim() : typeof fact.text === "string" ? fact.text.trim() : "";
    const url = typeof fact.source_url === "string" ? fact.source_url.trim() : "";
    const page = pages.find((candidate) => candidate.url === url);
    if (!page || quote.length < 12 || quote.length > 240) continue;
    // LE garde-fou : l'extrait doit figurer dans la page qu'il cite.
    if (!normalized.get(page.url)!.includes(normalizeForQuote(quote))) continue;
    const hint = typeof fact.process_hint === "string" && fact.process_hint.trim() ? fact.process_hint.trim().slice(0, 140) : null;
    let level = Math.max(0, Math.min(3, Math.round(Number(fact.distinctiveness) || 0))) as 0 | 1 | 2 | 3;
    // Sans tâche répétitive identifiée, un fait ne dépasse pas 1.
    if (!hint && level > 1) level = 1;
    const kind = PAGE_KINDS.includes(fact.page_kind as FactPageKind) ? (fact.page_kind as FactPageKind) : page.kind;
    if (facts.some((existing) => normalizeForQuote(existing.text) === normalizeForQuote(quote))) continue;
    facts.push({ text: quote, source_url: page.url, page_kind: kind, distinctiveness: level, process_hint: hint });
  }
  // Règles déterministes (facts-rules.ts) : 3 exige une preuve, 1 pour une paraphrase de l'activité.
  return rescoreFacts(facts, activity, company).facts.slice(0, 5);
}

export const factsScore = (facts: readonly SourcedFact[]): 0 | 1 | 2 | 3 =>
  facts.reduce<0 | 1 | 2 | 3>((best, fact) => (fact.distinctiveness > best ? fact.distinctiveness : best), 0);

export interface FactsDeps {
  fetchHtml(url: string): Promise<{ html: string; url: string } | null>;
  /** Un appel de modèle peu coûteux : renvoie le JSON brut. */
  ask(system: string, user: string): Promise<string>;
}

export interface FactsRun {
  facts: SourcedFact[];
  score: 0 | 1 | 2 | 3;
  pages: string[];
  note: string | null;
}

/** Lecture du site (accueil + 6 pages au plus) et extraction des faits. */
export async function extractFacts(company: string, website: string, deps: FactsDeps, activity?: string | null): Promise<FactsRun> {
  const origin = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const home = await deps.fetchHtml(origin);
  if (!home) return { facts: [], score: 0, pages: [], note: "site illisible" };
  const pages: FactPage[] = [{ url: home.url || origin, kind: "apropos", text: pageText(home.html, 2500) }];
  for (const target of factPages(home.html, home.url || origin)) {
    const page = await deps.fetchHtml(target.url);
    if (!page) continue;
    const text = pageText(page.html);
    if (text.length > 80) pages.push({ url: target.url, kind: target.kind, text });
  }
  const readable = pages.filter((page) => page.text.length > 80);
  if (!readable.length) return { facts: [], score: 0, pages: [], note: "aucun texte exploitable" };
  const raw = await deps.ask(FACTS_SYSTEM, factsPrompt(company, readable));
  const facts = validateFacts(raw, readable, activity, company);
  return { facts, score: factsScore(facts), pages: readable.map((page) => page.url), note: null };
}

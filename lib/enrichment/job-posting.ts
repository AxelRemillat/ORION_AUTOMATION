/**
 * Datation d'une offre d'emploi publiée sur le site de l'entreprise.
 *
 * Le problème : BLUE ENERFREEZE publie une offre « Automaticien/ne » sur son
 * propre domaine, mais la page ne porte AUCUNE date — ni dans le texte, ni en
 * JSON-LD (vérifié : la page ne contient qu'un `BreadcrumbList`). Le scoring
 * traitait donc ce signal comme non daté, c'est-à-dire comme nul, et
 * l'entreprise tombait à 7/100 alors qu'elle recrute exactement le métier
 * qu'on sait automatiser.
 *
 * La règle retenue est un compromis assumé :
 *
 *   - `datePosted` lisible            → offre DATÉE, points pleins ;
 *   - `validThrough` dépassé          → offre PÉRIMÉE, zéro point ;
 *   - pas de date, mais la page est   → offre EN LIGNE, moitié des points.
 *     servie en 200 sur le domaine
 *     officiel au moment du scan
 *
 * Une offre « en ligne » reste interdite comme angle principal d'un mail :
 * on ne peut pas écrire « vous recrutez depuis peu » sans date. Elle dit
 * seulement que l'entreprise cherche quelqu'un aujourd'hui, ce qui est déjà
 * plus qu'un silence.
 */
import { toDomain } from "./http";

export type PostingFreshness = "datée" | "en ligne" | "périmée" | "introuvable";

export interface JobPostingFacts {
  datePosted: string | null;
  validThrough: string | null;
  title: string | null;
}

/** Coefficient de points appliqué au signal selon ce qu'on a pu prouver. */
export const FRESHNESS_WEIGHT: Record<PostingFreshness, number> = {
  "datée": 1,
  "en ligne": 0.5,
  "périmée": 0,
  introuvable: 0,
};

const isoDay = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

/** Aplatit `@graph`, les tableaux et les objets simples en une seule liste. */
function flattenLd(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) flattenLd(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  out.push(record);
  if (record["@graph"]) flattenLd(record["@graph"], out);
}

const typeOf = (node: Record<string, unknown>): string[] => {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
};

/**
 * Offres `schema.org/JobPosting` trouvées dans le HTML.
 *
 * On ne parse pas le HTML : on isole les blocs `application/ld+json`, qui sont
 * du JSON pur. Un bloc illisible est ignoré sans bruit — beaucoup de CMS en
 * produisent d'invalides, et ce n'est pas une raison pour perdre l'offre.
 */
export function parseJobPostings(html: string): JobPostingFacts[] {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes: Record<string, unknown>[] = [];

  for (const block of blocks) {
    try {
      flattenLd(JSON.parse(block[1].trim()), nodes);
    } catch {
      // Bloc JSON-LD invalide : fréquent, sans conséquence ici.
    }
  }

  return nodes
    .filter((node) => typeOf(node).some((type) => /JobPosting/i.test(type)))
    .map((node) => ({
      datePosted: isoDay(node.datePosted),
      validThrough: isoDay(node.validThrough),
      title: typeof node.title === "string" ? node.title.trim() : null,
    }));
}

/** Verdict de fraîcheur, à partir de ce qui a pu être lu sur la page. */
export function postingFreshness(input: {
  reachable: boolean;
  onOfficialDomain: boolean;
  facts: JobPostingFacts | null;
  now?: Date;
}): PostingFreshness {
  if (!input.reachable) return "introuvable";
  const now = input.now ?? new Date();

  const validThrough = input.facts?.validThrough;
  if (validThrough && Date.parse(validThrough) < now.getTime()) return "périmée";

  if (input.facts?.datePosted) return "datée";

  // Sans date, seule la publication sur le domaine vérifié fait foi : une
  // annonce recopiée sur un agrégateur ne prouve pas qu'elle est encore active.
  return input.onOfficialDomain ? "en ligne" : "introuvable";
}

/** `true` si l'URL appartient bien au domaine officiel (sous-domaines compris). */
export function sameDomain(url: string, officialSite: string | null | undefined): boolean {
  const official = toDomain(officialSite);
  const target = toDomain(url);
  if (!official || !target) return false;
  return target === official || target.endsWith(`.${official}`);
}

export interface PostingCheck {
  freshness: PostingFreshness;
  datePosted: string | null;
  validThrough: string | null;
}

/**
 * Va lire la page de l'offre et en tire un verdict.
 *
 * Volontairement tolérant : un timeout ou un 403 rend « introuvable », jamais
 * une erreur. Le scan ne doit pas tomber parce qu'un site est lent.
 */
export async function checkJobPosting(
  url: string,
  officialSite: string | null | undefined,
  options: { now?: Date; timeoutMs?: number } = {},
): Promise<PostingCheck> {
  const onOfficialDomain = sameDomain(url, officialSite);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": "Mozilla/5.0 (compatible; ORION/1.0)" },
    });
    if (!response.ok) {
      return { freshness: "introuvable", datePosted: null, validThrough: null };
    }

    const html = await response.text();
    const [facts] = parseJobPostings(html);
    return {
      freshness: postingFreshness({ reachable: true, onOfficialDomain, facts: facts ?? null, now: options.now }),
      datePosted: facts?.datePosted ?? null,
      validThrough: facts?.validThrough ?? null,
    };
  } catch {
    return { freshness: "introuvable", datePosted: null, validThrough: null };
  } finally {
    clearTimeout(timer);
  }
}

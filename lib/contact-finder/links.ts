/**
 * Pages à lire sur un site candidat : là où les petites entreprises écrivent
 * leur SIREN et leur adresse — mentions légales, contact, « à propos ».
 *
 * On suit d'abord les liens réellement présents sur l'accueil (le chemin varie
 * d'un site à l'autre : /mentions-legales, /legal, /mentions-legales.html…),
 * puis on complète par les chemins usuels.
 */

const KINDS: { kind: string; test: RegExp }[] = [
  { kind: "mentions", test: /mentions?[-_ ]?l[eé]gales?|legal|cgv|informations?[-_ ]l[eé]gales|imprint/i },
  { kind: "contact", test: /contact|nous[-_ ]joindre|coordonn/i },
  { kind: "propos", test: /[aà][-_ ]propos|qui[-_ ]sommes|about|notre[-_ ](histoire|entreprise|equipe)|l[-_]entreprise/i },
];

const DEFAULT_PATHS = ["/mentions-legales", "/contact", "/a-propos"];

export function pagesToVisit(html: string, base: string, max = 3): string[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const found = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = match[2].replace(/<[^>]+>/g, " ");
    let url: URL;
    try {
      url = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    const probe = `${url.pathname} ${label}`;
    const kind = KINDS.find((item) => item.test.test(probe))?.kind;
    if (kind && !found.has(kind)) found.set(kind, `${url.origin}${url.pathname}`);
  }
  const ordered = KINDS.map((item) => found.get(item.kind)).filter((url): url is string => Boolean(url));
  for (const path of DEFAULT_PATHS) {
    const kind = KINDS.find((item) => item.test.test(path))!.kind;
    if (!found.has(kind)) ordered.push(`${origin.origin}${path}`);
  }
  return [...new Set(ordered)].slice(0, max);
}

/** Texte d'une page : scripts, styles et balises retirés. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

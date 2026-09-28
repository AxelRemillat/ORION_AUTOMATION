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

/**
 * Chemins tentes quand l'accueil ne porte aucun lien exploitable.
 *
 * La variante accentuee compte : les sites francais ecrivent souvent
 * « /mentions-légales » tel quel, et c'est le cas du site qui a motive cette
 * liste. Un seul de ces chemins est essaye par famille (cf. `max`).
 */
const DEFAULT_PATHS = ["/mentions-legales", "/mentions-légales", "/contact", "/a-propos"];

export function pagesToVisit(html: string, base: string, max = 3): string[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const found = new Map<string, string>();
  /*
   * On ne lit que la balise OUVRANTE, et le libelle est pris juste apres.
   *
   * L'ancienne version exigeait un `</a>` fermant. Or la page d'accueil de
   * boulangerie-bonnin.fr contient « <a href="…francetravail.fr">France
   * Travail<a /> » — une balise fermee a l'envers. Le motif avalait alors tout
   * jusqu'au `</a>` SUIVANT, c'est-a-dire celui du lien des mentions legales,
   * qui n'etait donc jamais vu. Un HTML de site vitrine n'est pas du XML.
   */
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) {
    const start = (match.index ?? 0) + match[0].length;
    const label = html.slice(start, start + 120).split("<")[0].replace(/\s+/g, " ");
    let url: URL;
    try {
      url = new URL(match[1], origin);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    // Le chemin est percent-encode par `new URL` : « /mentions-légales » devient
    // « /mentions-l%C3%A9gales », que le motif ne reconnait plus. On le relit en
    // clair — c'est ce qui faisait manquer la page des mentions legales sur les
    // sites francais qui accentuent leurs URL.
    let path = url.pathname;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      // Sequence d'echappement invalide : on garde la forme encodee.
    }
    const probe = `${path} ${label}`;
    const kind = KINDS.find((item) => item.test.test(probe))?.kind;
    if (kind && !found.has(kind)) found.set(kind, `${url.origin}${url.pathname}`);
  }
  const ordered = KINDS.map((item) => found.get(item.kind)).filter((url): url is string => Boolean(url));
  // Un seul chemin par defaut PAR FAMILLE : « /mentions-legales » et
  // « /mentions-légales » visent la meme page, et essayer les deux gaspillait
  // une lecture sur un 404.
  const covered = new Set(found.keys());
  for (const path of DEFAULT_PATHS) {
    const kind = KINDS.find((item) => item.test.test(path))!.kind;
    if (covered.has(kind)) continue;
    covered.add(kind);
    ordered.push(`${origin.origin}${path}`);
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

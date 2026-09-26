/**
 * Dater un signal fort qui n'a pas de date.
 *
 * Le cas qui a motivé ce module : SELECTION HABITAT a ouvert une agence
 * Arieg'Immo à Lavelanet, annoncé par un article de La Dépêche. Le signal était
 * fort et vrai, mais sans date exploitable — donc écarté comme accroche, et le
 * mail retombait sur « dans l'immobilier… ». Un fait de cette qualité mérite un
 * aller-retour de plus avant d'être jeté.
 *
 * Quatre sources, de la plus fiable à la plus indirecte :
 *
 *   1. la date que la source annonce elle-même (déjà lue en amont) ;
 *   2. le JSON-LD ou `article:published_time` de la page ;
 *   3. la date de création de l'établissement, chez Pappers ;
 *   4. la création d'établissement au BODACC, puis l'annuaire public.
 *
 * Les trois dernières sont tentées ici. Aucune ne doit être NOMMÉE dans le
 * mail : le fait se dit « vous avez ouvert une agence à Lavelanet au
 * printemps », jamais « le BODACC annonce… ».
 */

/** Au-delà, l'événement ne dit plus rien du moment présent. */
export const MAX_HOOK_AGE_MONTHS = 12;

export type DateOrigin = "page" | "bodacc" | "etablissement";

export interface DatingResult {
  /** Date ISO (AAAA-MM-JJ), ou `null` si rien de fiable. */
  date: string | null;
  origin: DateOrigin | null;
}

const isoDay = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const iso = new Date(parsed).toISOString().slice(0, 10);
  // Une date dans le futur est une erreur de source, pas un scoop.
  return iso <= new Date().toISOString().slice(0, 10) ? iso : null;
};

/** La date est-elle assez récente pour porter une accroche ? */
export function isHookFresh(date: string | null, now = new Date()): boolean {
  if (!date) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - MAX_HOOK_AGE_MONTHS);
  return date >= limit.toISOString().slice(0, 10);
}

/**
 * Date de publication déclarée par une page HTML.
 *
 * On lit dans l'ordre : `article:published_time` (la plus explicite), puis le
 * `datePublished` d'un bloc JSON-LD, puis un `<time datetime>`. On ne devine
 * jamais à partir du texte : une date lue dans un paragraphe peut désigner
 * l'événement raconté comme la date d'un autre article de la colonne de droite.
 */
export function publishedDateIn(html: string): string | null {
  const meta = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const metaReversed = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i.exec(html);
  const fromMeta = isoDay(meta?.[1] ?? metaReversed?.[1]);
  if (fromMeta) return fromMeta;

  for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const nodes: unknown[] = [];
      const push = (node: unknown) => {
        if (Array.isArray(node)) node.forEach(push);
        else if (node && typeof node === "object") {
          nodes.push(node);
          const graph = (node as Record<string, unknown>)["@graph"];
          if (graph) push(graph);
        }
      };
      push(JSON.parse(block[1].trim()));
      for (const node of nodes) {
        const record = node as Record<string, unknown>;
        const found = isoDay(record.datePublished ?? record.dateCreated ?? record.uploadDate);
        if (found) return found;
      }
    } catch {
      // Bloc JSON-LD invalide : fréquent, sans conséquence ici.
    }
  }

  const time = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html);
  return isoDay(time?.[1]);
}

const BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

/*
 * Ce que les sondes reelles ont montre le 26/09/2026, sur SELECTION HABITAT
 * (SIREN 453450256) — et la lecon vaut d'etre ecrite :
 *
 *   - BODACC : 30 annonces, aucune creation d'etablissement. Les ouvertures
 *     d'agences n'y passent pas ;
 *   - annuaire public : aucun etablissement a Lavelanet. La reponse ne rend
 *     que les etablissements qui COLLENT a la requete, pas la liste complete ;
 *   - Pappers : 44 etablissements, dont Lavelanet, cree le 01/02/2022.
 *
 * L'agence Arieg'Immo existe donc bien, mais elle a plus de quatre ans : ce
 * n'est pas une nouvelle, et l'article de La Depeche ne pouvait pas porter
 * l'accroche. En revanche la meme liste montre quatre ouvertures de moins d'un
 * an (Perigueux et Montmoreau le 01/03/2026, Lauzerte et Soorts-Hossegor le
 * 01/01/2026) : voila l'accroche, elle etait sous nos yeux.
 *
 * D'ou l'ordre des sources : Pappers d'abord des qu'une cle est disponible.
 */
/**
 * Date de création d'établissement annoncée au BODACC.
 *
 * L'API est publique et sans clé. On ne retient que les annonces de création,
 * et on prend la plus récente : une entreprise qui ouvre plusieurs agences
 * apparaît plusieurs fois.
 */
export async function bodaccEstablishmentDate(
  siren: string,
  options: { fetchImpl?: typeof fetch; city?: string | null } = {},
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    where: `registre LIKE "${siren}" AND familleavis_lib LIKE "Creation"`,
    order_by: "dateparution DESC",
    limit: "5",
    select: "dateparution,ville,familleavis_lib",
  });

  try {
    const response = await doFetch(`${BODACC}?${params}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as { results?: { dateparution?: string; ville?: string }[] };
    const rows = body.results ?? [];
    // Quand on connaît la ville visée, on la préfère : une création à Lavelanet
    // n'est pas la même nouvelle qu'une création au siège.
    const target = options.city?.toLowerCase();
    const matching = target ? rows.find((row) => row.ville?.toLowerCase().includes(target)) : undefined;
    return isoDay((matching ?? rows[0])?.dateparution);
  } catch {
    return null;
  }
}

const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";

const PAPPERS = "https://api.pappers.fr/v2/entreprise";

/**
 * Date de création d'établissement, lue chez Pappers.
 *
 * La source la plus complète : la fiche entreprise porte TOUS les
 * établissements, chacun avec sa `date_de_creation`. C'est un crédit Pappers,
 * dépensé seulement quand un signal fort n'a pas de date — jamais en routine.
 */
export async function pappersEstablishmentDate(
  siren: string,
  options: { fetchImpl?: typeof fetch; city?: string | null } = {},
): Promise<string | null> {
  const token = process.env.PAPPERS_API_KEY;
  if (!token) return null;
  const doFetch = options.fetchImpl ?? fetch;

  try {
    const response = await doFetch(`${PAPPERS}?api_token=${token}&siren=${siren}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      etablissements?: { ville?: string; date_de_creation?: string; siege?: boolean; etablissement_cesse?: boolean }[];
    };

    const target = options.city?.toLowerCase();
    const dates = (body.etablissements ?? [])
      .filter((site) => site.siege !== true && site.etablissement_cesse !== true)
      .filter((site) => (target ? site.ville?.toLowerCase().includes(target) : true))
      .map((site) => isoDay(site.date_de_creation))
      .filter((date): date is string => Boolean(date))
      .sort()
      .reverse();

    return dates[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Date de création de l'établissement secondaire le plus récent.
 *
 * L'annuaire expose `date_creation` par établissement : c'est la date
 * administrative d'ouverture, donc un plancher fiable pour « vous avez ouvert
 * une agence ». Moins précise qu'un article, mais jamais fausse.
 */
export async function secondaryEstablishmentDate(
  siren: string,
  options: { fetchImpl?: typeof fetch; city?: string | null } = {},
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({ q: siren, per_page: "1" });

  try {
    const response = await doFetch(`${ANNUAIRE}?${params}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      results?: {
        matching_etablissements?: { date_creation?: string; libelle_commune?: string; est_siege?: boolean }[];
      }[];
    };

    const sites = body.results?.[0]?.matching_etablissements ?? [];
    const target = options.city?.toLowerCase();
    const candidates = sites
      .filter((site) => site.est_siege !== true)
      .filter((site) => (target ? site.libelle_commune?.toLowerCase().includes(target) : true))
      .map((site) => isoDay(site.date_creation))
      .filter((date): date is string => Boolean(date))
      .sort()
      .reverse();

    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

export interface DateSignalInput {
  siren: string | null;
  /** URL de la source du signal, quand elle est connue. */
  url?: string | null;
  /** Ville visée par l'événement (« Lavelanet »), si on la connaît. */
  city?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Cherche une date pour un signal fort qui n'en a pas.
 *
 * On s'arrête à la première source qui répond : chaque tentative coûte un
 * aller-retour, et la première est la plus précise.
 */
export async function dateStrongSignal(input: DateSignalInput): Promise<DatingResult> {
  const doFetch = input.fetchImpl ?? fetch;

  if (input.url) {
    try {
      const response = await doFetch(input.url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ORION/1.0)" },
      });
      if (response.ok) {
        const found = publishedDateIn(await response.text());
        if (found) return { date: found, origin: "page" };
      }
    } catch {
      // Page injoignable : on passe aux sources publiques.
    }
  }

  if (input.siren) {
    // Pappers avant le BODACC : il voit les ouvertures d'agences, que le
    // BODACC ne publie pas.
    const pappers = await pappersEstablishmentDate(input.siren, { fetchImpl: doFetch, city: input.city });
    if (pappers) return { date: pappers, origin: "etablissement" };

    const bodacc = await bodaccEstablishmentDate(input.siren, { fetchImpl: doFetch, city: input.city });
    if (bodacc) return { date: bodacc, origin: "bodacc" };

    const site = await secondaryEstablishmentDate(input.siren, { fetchImpl: doFetch, city: input.city });
    if (site) return { date: site, origin: "etablissement" };
  }

  return { date: null, origin: null };
}

/** Au-dela, on depense des allers-retours pour un mail qu'on ecrira quand meme. */
export const MAX_DATING_ATTEMPTS = 2;

interface DatableSignal {
  label: string;
  url?: string;
  date?: string;
  scope?: string;
  [key: string]: unknown;
}

/**
 * Derniere chance donnee aux signaux sans date.
 *
 * A n'appeler QUE lorsque la fiche n'a aucune accroche : un signal fort mais
 * non date valait mieux qu'un mail ouvert sur le code NAF, et il suffisait
 * parfois d'un aller-retour pour le sauver. Les signaux du groupe sont exclus —
 * les dater ne les rendrait pas utilisables, ce ne sont pas des nouvelles du
 * prospect.
 *
 * Rend les signaux eventuellement completes, et dit si quelque chose a bouge :
 * l'appelant decide alors de les reecrire en base.
 */
export async function dateUndatedSignals<T extends DatableSignal>(
  signals: readonly T[],
  context: { siren: string | null; city?: string | null; fetchImpl?: typeof fetch },
): Promise<{ signals: T[]; changed: boolean }> {
  const candidates = signals
    .map((signal, index) => ({ signal, index }))
    .filter((entry) => !entry.signal.date && entry.signal.scope !== "groupe" && Boolean(entry.signal.url))
    .slice(0, MAX_DATING_ATTEMPTS);

  if (!candidates.length) return { signals: [...signals], changed: false };

  const next = [...signals];
  let changed = false;

  for (const entry of candidates) {
    const found = await dateStrongSignal({
      siren: context.siren,
      url: entry.signal.url ?? null,
      city: context.city ?? null,
      fetchImpl: context.fetchImpl,
    });
    // Une date trop vieille ne sauve rien : on ne l'ecrit pas, pour ne pas
    // transformer un signal muet en signal explicitement perime.
    if (found.date && isHookFresh(found.date)) {
      next[entry.index] = { ...entry.signal, date: found.date };
      changed = true;
    }
  }

  return { signals: next, changed };
}

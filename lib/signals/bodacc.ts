import { cached } from "@/lib/enrichment/cache";
import { fetchJson, type Result } from "@/lib/enrichment/http";
import { spacerFor } from "@/lib/enrichment/rate-limit";

/**
 * BODACC — le journal officiel des annonces commerciales.
 *
 * C'est la source la plus solide qu'on puisse avoir : une annonce BODACC est
 * publiée par un greffe, elle porte une date de parution et un SIREN. Là où un
 * résultat web demande un ancrage, une expression régulière et un seuil de
 * confiance pour être cru, une annonce BODACC est vraie par construction.
 *
 * Aucune clé : l'API Explore v2.1 d'Opendatasoft est ouverte. Deux bornes
 * mesurées le 25/09/2026 contre l'API réelle, pas lues dans une doc :
 *   - `limit` doit rester ≤ 100 (au-delà : `InvalidRESTParameterError`) ;
 *   - `offset + limit` doit rester ≤ 10 000.
 *
 * Le schéma réel diffère de ce qu'on attendrait : il n'y a PAS de colonne
 * `siren`. Le SIREN vit dans `registre`, un tableau qui contient la même valeur
 * deux fois, brute puis espacée (`["911864023", "911 864 023"]`), et qui vaut
 * `null` pour une personne physique. C'est ce champ qui décide si une annonce
 * est exploitable.
 */

const BASE =
  "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

/** Page maximale acceptée par l'API. */
export const BODACC_PAGE_SIZE = 100;

/** Plafond dur d'Opendatasoft sur `offset + limit`. */
export const BODACC_MAX_WINDOW = 10_000;

/** Débit volontairement modeste : l'API est gratuite, ne pas en abuser. */
const BODACC_RATE_PER_SECOND = 4;

/** Une parution ne change jamais après coup : un jour de cache est prudent. */
const CACHE_TTL_MS = 86_400_000;

const TIMEOUT_MS = 15_000;

/**
 * Familles d'annonces retenues, et celles qu'on écarte — avec la raison.
 *
 * On ne garde que ce qui décrit une entreprise en mouvement :
 *   - `Modifications diverses` — capital, dirigeant, objet, siège. C'est le
 *     gros du gisement exploitable (3 486 sur le Rhône en 60 jours).
 *   - `Ventes et cessions` — un fonds qui change de main, signal fort.
 *   - `Créations` / `Immatriculations` — entreprise neuve.
 *
 * Écartées volontairement :
 *   - `Dépôts des comptes` — 15 154 annonces sur le Rhône en 60 jours, soit
 *     deux fois tout le reste réuni, pour une obligation annuelle qui ne dit
 *     rien d'un projet. Les garder noierait le signal utile.
 *   - `Procédures collectives`, `Radiations`, `Procédures de conciliation` —
 *     ce sont de vrais événements datés, mais négatifs : prospecter une
 *     entreprise en liquidation n'a pas de sens.
 */
export const BODACC_FAMILIES = [
  "Modifications diverses",
  "Ventes et cessions",
  "Créations",
  "Immatriculations",
] as const;

export type BodaccFamily = (typeof BODACC_FAMILIES)[number];

/** Type de signal (référentiel de scoring) pour chaque famille. */
const FAMILY_TO_SIGNAL: Record<BodaccFamily, string> = {
  "Modifications diverses": "croissance",
  "Ventes et cessions": "croissance",
  "Créations": "creation",
  "Immatriculations": "creation",
};

/** Ce qu'on retient d'une annonce, une fois le bruit écarté. */
export interface BodaccNotice {
  /** SIREN à 9 chiffres, seule clé de rapprochement fiable. */
  siren: string;
  companyName: string;
  city: string | null;
  postalCode: string | null;
  family: BodaccFamily;
  /** Nature précise quand l'annonce la donne (« Augmentation du capital »). */
  nature: string | null;
  /** Date de parution, ISO `AAAA-MM-JJ`. Toujours présente. */
  publishedAt: string;
  /** Type de signal pour le scoring. */
  signalType: string;
  url: string;
}

interface RawRecord {
  registre?: string[] | string | null;
  listepersonnes?: string | null;
  commercant?: string | null;
  ville?: string | null;
  cp?: string | null;
  familleavis_lib?: string | null;
  dateparution?: string | null;
  modificationsgenerales?: string | null;
  acte?: string | null;
  url_complete?: string | null;
}

interface RawResponse {
  total_count?: number;
  results?: RawRecord[];
}

/**
 * SIREN d'une annonce.
 *
 * `registre` arrive comme un tableau contenant deux écritures du même numéro.
 * On ne prend pas « la première » : on cherche celle qui fait exactement neuf
 * chiffres après retrait des espaces, parce que l'ordre n'est pas garanti et
 * qu'un champ mal rempli existe.
 */
export function sirenOf(registre: RawRecord["registre"]): string | null {
  const values = Array.isArray(registre) ? registre : registre ? [registre] : [];
  for (const value of values) {
    const digits = String(value).replace(/\D/g, "");
    if (digits.length === 9) return digits;
  }
  return null;
}

/**
 * Nature de l'événement, extraite du sous-objet JSON quand il existe.
 *
 * Ces colonnes sont du JSON stocké en texte : un `JSON.parse` qui échoue est
 * normal, pas exceptionnel. On retombe alors sur la famille, qui suffit.
 */
export function natureOf(record: RawRecord): string | null {
  for (const raw of [record.modificationsgenerales, record.acte]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["descriptif", "nature", "categorie", "typeAnnonce"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      // Champ non-JSON : la famille reste l'information utile.
    }
  }
  return null;
}

/**
 * L'annonce décrit-elle une fin plutôt qu'un projet ?
 *
 * La famille `Modifications diverses` est un fourre-tout : elle contient des
 * augmentations de capital et des changements de siège, mais aussi des
 * dissolutions. Mesuré sur 93 annonces du Rhône : **17 sont des dissolutions ou
 * des cessations d'activité**, soit 18 %. Écarter la famille entière coûterait
 * les 76 autres ; ne rien filtrer faisait remonter « Dissolution sans
 * liquidation de la société » comme signal d'achat, ce qui est absurde.
 *
 * On ne filtre donc pas sur la famille mais sur la nature. Une fusion où
 * l'entreprise ABSORBE (« Modification du capital. Sociétés ayant participé à
 * l'opération de fusion ») ne contient aucun de ces mots et reste retenue.
 */
export function isNegativeNature(nature: string | null): boolean {
  if (!nature) return false;
  return /dissolution|liquidation|radiation|cessation d'activit|cl[oô]ture/i.test(nature);
}

const isFamily = (value: string | null | undefined): value is BodaccFamily =>
  BODACC_FAMILIES.includes(value as BodaccFamily);

/**
 * Personne physique (entrepreneur individuel) ou personne morale ?
 *
 * Mesuré sur 100 annonces du Rhône : 24 % de `pp`. Un entrepreneur individuel
 * n'atteint jamais la tranche « 10 à 49 salariés » visée, et sa fiche coûte un
 * appel Pappers comme les autres. L'écarter ici, c'est un quart du budget de la
 * phase 2 rendu aux vraies cibles.
 *
 * `listepersonnes` est du JSON en texte, et `personne` est parfois un objet,
 * parfois un tableau. Illisible : on garde l'annonce — mieux vaut un appel de
 * trop qu'une cible perdue.
 */
export function isLegalEntity(listepersonnes: string | null | undefined): boolean {
  if (!listepersonnes) return true;
  try {
    const parsed = JSON.parse(listepersonnes) as { personne?: unknown };
    const first = Array.isArray(parsed.personne) ? parsed.personne[0] : parsed.personne;
    const type = (first as { typePersonne?: unknown } | undefined)?.typePersonne;
    return type !== "pp";
  } catch {
    return true;
  }
}

/** Traduit une annonce brute, ou `null` si elle n'est pas exploitable. */
export function toNotice(record: RawRecord): BodaccNotice | null {
  const siren = sirenOf(record.registre);
  const family = record.familleavis_lib;
  const publishedAt = record.dateparution;
  const name = record.commercant?.trim();

  // Sans SIREN on ne peut pas rapprocher, sans date on n'a pas de signal daté,
  // sans nom on n'a rien à montrer : les trois sont eliminatoires.
  if (!siren || !publishedAt || !name || !isFamily(family)) return null;
  if (!isLegalEntity(record.listepersonnes)) return null;

  const nature = natureOf(record);
  // Une dissolution est un evenement date et officiel, mais c'est une fin : on
  // ne prospecte pas une entreprise qui ferme.
  if (isNegativeNature(nature)) return null;

  return {
    siren,
    companyName: name,
    city: record.ville?.trim() || null,
    postalCode: record.cp?.trim() || null,
    family,
    nature,
    publishedAt,
    signalType: FAMILY_TO_SIGNAL[family],
    url:
      record.url_complete ??
      "https://www.bodacc.fr/pages/annonces-commerciales/",
  };
}

/** Date ISO du jour moins `days`, au format attendu par ODSQL. */
export function sinceDate(days: number, today = new Date()): string {
  const date = new Date(today.getTime() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Clause ODSQL.
 *
 * Les familles passent par une liste `in (...)` plutôt que par `refine` : un
 * `refine` par famille aurait multiplié les appels par quatre pour le même
 * résultat.
 */
export function whereClause(departement: string, days: number, today?: Date): string {
  const families = BODACC_FAMILIES.map((family) => `"${family}"`).join(", ");
  return [
    `numerodepartement="${departement}"`,
    `dateparution>=date'${sinceDate(days, today)}'`,
    `familleavis_lib in (${families})`,
  ].join(" AND ");
}

export interface BodaccQuery {
  /** Numéro de département sur deux caractères (`"69"`, `"2A"`). */
  departement: string;
  /** Fenêtre d'antériorité, en jours. */
  days: number;
  /** Annonces à ramener, toutes pages confondues. */
  max: number;
  today?: Date;
}

/**
 * Annonces récentes d'un département, les plus fraîches d'abord.
 *
 * Le tri par `dateparution DESC` n'est pas cosmétique : il garantit que le
 * plafond `max` coupe les annonces les plus anciennes, pas les plus récentes.
 */
export async function recentNotices(query: BodaccQuery): Promise<Result<BodaccNotice[]>> {
  const where = whereClause(query.departement, query.days, query.today);
  const wanted = Math.min(query.max, BODACC_MAX_WINDOW);
  const notices: BodaccNotice[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < wanted; offset += BODACC_PAGE_SIZE) {
    const limit = Math.min(BODACC_PAGE_SIZE, wanted - offset);
    const url =
      `${BASE}?where=${encodeURIComponent(where)}` +
      `&order_by=${encodeURIComponent("dateparution DESC")}` +
      `&limit=${limit}&offset=${offset}`;

    const page = await cached<RawResponse>(
      `bodacc:${query.departement}:${query.days}:${offset}:${limit}`,
      async () => {
        await spacerFor("bodacc", BODACC_RATE_PER_SECOND).wait();
        const response = await fetchJson<RawResponse>(url, {}, TIMEOUT_MS);
        // Le cache ne doit jamais mémoriser un échec : on rend `null`, et
        // l'erreur est remontée telle quelle à l'appelant.
        return response.ok ? response.data : null;
      },
      CACHE_TTL_MS,
    );

    if (!page) {
      // Une première page perdue est un échec ; une page suivante perdue laisse
      // quand même des annonces exploitables, autant les rendre.
      if (!notices.length) return { ok: false, error: "BODACC — annonces illisibles" };
      break;
    }

    const rows = page.results ?? [];
    for (const row of rows) {
      const notice = toNotice(row);
      // Une même entreprise peut avoir plusieurs annonces dans la fenêtre : on
      // ne garde que la plus récente, c'est-a-dire la premiere vue.
      if (notice && !seen.has(notice.siren)) {
        seen.add(notice.siren);
        notices.push(notice);
      }
    }

    if (rows.length < limit) break;
  }

  return { ok: true, data: notices };
}

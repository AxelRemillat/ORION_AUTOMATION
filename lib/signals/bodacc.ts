import { cached } from "@/lib/enrichment/cache";
import { fetchJson, type Result } from "@/lib/enrichment/http";
import { spacerFor } from "@/lib/enrichment/rate-limit";
import {
  capitalOf,
  classify,
  companyNameOf,
  descriptifOf,
  isLegalEntity,
  isSeller,
  newLeadersOf,
  sirenOf,
  type BodaccFamily,
  type BodaccLeader,
  type RawRecord,
  type SignalStrength,
} from "./bodacc-parse";

/**
 * BODACC — le journal officiel des annonces commerciales.
 *
 * La source la plus solide disponible : une annonce est publiée par un greffe,
 * elle porte une date de parution et un SIREN. Là où un résultat web demande
 * un ancrage, une expression régulière et un seuil de confiance pour être cru,
 * une annonce BODACC est vraie par construction.
 *
 * Aucune clé : l'API Explore v2.1 d'Opendatasoft est ouverte. Deux bornes
 * mesurées contre l'API réelle le 25/09/2026, pas lues dans une doc :
 *   - `limit` doit rester ≤ 100 (au-delà : `InvalidRESTParameterError`) ;
 *   - `offset + limit` doit rester ≤ 10 000.
 *
 * La LECTURE d'une annonce vit dans `bodacc-parse.ts` : ce fichier ne fait que
 * l'appeler et paginer.
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
 * Familles d'annonces demandées.
 *
 * `Dépôts des comptes` est écarté : 15 154 annonces sur le Rhône en 60 jours,
 * deux fois tout le reste réuni, pour une obligation annuelle qui ne dit rien
 * d'un projet. `Procédures collectives` et `Radiations` sont écartées comme
 * négatives — on ne prospecte pas une entreprise qui ferme.
 */
export const BODACC_FAMILIES: readonly BodaccFamily[] = [
  "Modifications diverses",
  "Ventes et cessions",
  "Créations",
  "Immatriculations",
];

/** Ce qu'on retient d'une annonce, une fois le bruit écarté. */
export interface BodaccNotice {
  /** SIREN à 9 chiffres, seule clé de rapprochement fiable. */
  siren: string;
  companyName: string;
  city: string | null;
  postalCode: string | null;
  family: BodaccFamily;
  /** Force commerciale du signal. */
  strength: SignalStrength;
  /** Type de signal pour le scoring. */
  signalType: string;
  /** Formulation lisible de l'événement. */
  label: string;
  /** Texte officiel de l'opération, tel que publié. */
  nature: string | null;
  /** Date de parution, ISO `AAAA-MM-JJ`. Toujours présente. */
  publishedAt: string;
  /** Dirigeants entrants nommés par l'annonce. */
  newLeaders: BodaccLeader[];
  /** Capital déclaré après l'opération. Le précédent n'est jamais donné. */
  capitalAmount: number | null;
  url: string;
}

interface RawResponse {
  total_count?: number;
  results?: RawRecord[];
}

const isFamily = (value: string | null | undefined): value is BodaccFamily =>
  BODACC_FAMILIES.includes(value as BodaccFamily);

/** Traduit une annonce brute, ou `null` si elle n'est pas exploitable. */
export function toNotice(record: RawRecord): BodaccNotice | null {
  const siren = sirenOf(record);
  const family = record.familleavis_lib;
  const publishedAt = record.dateparution;
  const companyName = companyNameOf(record);

  // Sans SIREN on ne peut pas rapprocher, sans date on n'a pas de signal daté,
  // sans nom on n'a rien à montrer : les trois sont éliminatoires.
  if (!siren || !publishedAt || !companyName || !isFamily(family)) return null;
  if (!isLegalEntity(record)) return null;

  const nature = descriptifOf(record);
  const leaders = newLeadersOf(record);
  const verdict = classify(family, nature, leaders, isSeller(record));
  if (!verdict) return null;

  return {
    siren,
    companyName,
    city: record.ville?.trim() || null,
    postalCode: record.cp?.trim() || null,
    family,
    strength: verdict.strength,
    signalType: verdict.signalType,
    label: verdict.label,
    nature,
    publishedAt,
    newLeaders: leaders,
    capitalAmount: capitalOf(record),
    url: record.url_complete ?? "https://www.bodacc.fr/pages/annonces-commerciales/",
  };
}

/** Date ISO du jour moins `days`, au format attendu par ODSQL. */
export function sinceDate(days: number, today = new Date()): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
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
 * Rend TOUTES les annonces retenues, sans dédoublonner par entreprise : une
 * entreprise qui publie trois annonces en deux mois bouge plus qu'une qui en
 * publie une, et c'est l'appelant qui décide quoi en faire (cf. `groupBySiren`).
 *
 * Le tri par `dateparution DESC` n'est pas cosmétique : il garantit que le
 * plafond `max` coupe les annonces les plus anciennes, pas les plus récentes.
 */
export async function recentNotices(query: BodaccQuery): Promise<Result<BodaccNotice[]>> {
  const where = whereClause(query.departement, query.days, query.today);
  const wanted = Math.min(query.max, BODACC_MAX_WINDOW);
  const notices: BodaccNotice[] = [];

  for (let offset = 0; offset < wanted; offset += BODACC_PAGE_SIZE) {
    const limit = Math.min(BODACC_PAGE_SIZE, wanted - offset);
    const url =
      `${BASE}?where=${encodeURIComponent(where)}` +
      `&order_by=${encodeURIComponent("dateparution DESC")}` +
      `&limit=${limit}&offset=${offset}`;

    const page = await cached<RawResponse>(
      `bodacc:v2:${query.departement}:${query.days}:${offset}:${limit}`,
      async () => {
        await spacerFor("bodacc", BODACC_RATE_PER_SECOND).wait();
        const response = await fetchJson<RawResponse>(url, {}, TIMEOUT_MS);
        // Le cache ne mémorise jamais un échec : on rend `null`, et l'erreur
        // est remontée telle quelle à l'appelant.
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
      if (notice) notices.push(notice);
    }

    if (rows.length < limit) break;
  }

  return { ok: true, data: notices };
}

const RANK: Record<SignalStrength, number> = { fort: 3, moyen: 2, faible: 1 };

/** La plus forte d'abord ; à force égale, la plus récente. */
export function compareNotices(a: BodaccNotice, b: BodaccNotice): number {
  return RANK[b.strength] - RANK[a.strength] || b.publishedAt.localeCompare(a.publishedAt);
}

/**
 * Annonces d'une même entreprise, regroupées.
 *
 * Trois annonces en deux mois disent quelque chose qu'une seule ne dit pas.
 * Elles sont donc conservées ensemble, la plus forte en tête — c'est elle qui
 * servira d'angle, les autres n'étant que du renfort.
 */
export function groupBySiren(notices: readonly BodaccNotice[]): Map<string, BodaccNotice[]> {
  const groups = new Map<string, BodaccNotice[]>();
  for (const notice of notices) {
    const list = groups.get(notice.siren);
    if (list) list.push(notice);
    else groups.set(notice.siren, [notice]);
  }
  for (const list of groups.values()) list.sort(compareNotices);
  return groups;
}

export type { BodaccFamily, BodaccLeader, SignalStrength };
export { isNegativeNature, STRENGTH_LABELS, STRENGTH_RANK } from "./bodacc-parse";

import { cached } from "@/lib/enrichment/cache";
import { fetchJson, type Result } from "@/lib/enrichment/http";
import { spacerFor } from "@/lib/enrichment/rate-limit";

/**
 * API Offres d'emploi de France Travail.
 *
 * Une offre publiée est un signal daté et de première main : l'entreprise dit
 * elle-même qu'elle recrute, à une date qu'elle a choisie. C'est plus fort
 * qu'une page d'agrégateur trouvée au scan web, et ça ne demande aucun ancrage.
 *
 * Deux différences de fond avec BODACC :
 *   1. **Il faut des identifiants** (OAuth2 client_credentials). Absents, la
 *      source se désactive — elle ne casse pas la recherche, elle s'annonce
 *      comme « à configurer ». C'est tout l'objet de `franceTravailStatus()`.
 *   2. **Il n'y a pas de SIREN dans une offre.** Le rapprochement se fait par
 *      nom d'entreprise + commune, donc il est faillible : c'est pourquoi le
 *      contrôle d'homonymie existant s'applique derrière, sans exception.
 */

const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

/** Portée exigée par l'API v2. Les deux valeurs sont nécessaires. */
const SCOPE = "api_offresdemploiv2 o2dsoffre";

/** Plafond de pagination documenté : 150 offres par appel. */
export const FT_PAGE_SIZE = 150;

/** Une offre ne change pas dans la journée ; le jeton, lui, vit moins. */
const CACHE_TTL_MS = 86_400_000;

const TIMEOUT_MS = 15_000;

/** Débit prudent : l'API est partagée entre tous les partenaires. */
const FT_RATE_PER_SECOND = 3;

/**
 * Familles de métiers retenues, par code ROME.
 *
 * Volontairement restreint à ce que cette activité sait servir : data,
 * automatisation, informatique, pilotage industriel. Un poste de commercial ou
 * de manutentionnaire est un vrai recrutement, mais pas un signal d'achat pour
 * une prestation de mise en production IA.
 */
export const FT_ROME_CODES = [
  "M1805", // Études et développement informatique
  "M1802", // Expertise et support en systèmes d'information
  "M1803", // Direction des systèmes d'information
  "M1810", // Production et exploitation de systèmes d'information
  "H1206", // Management et ingénierie études, recherche et développement
  "H1208", // Intervention technique en études et conception
  "H2502", // Management et ingénierie de production
] as const;

/**
 * Ce qu'il faut vraiment pour decider : deux cles, pas tout l'environnement.
 * Typer `NodeJS.ProcessEnv` obligeait les tests a fabriquer un faux `NODE_ENV`
 * pour une fonction qui ne le lit pas.
 */
export type EnvLike = Record<string, string | undefined>;

export type FranceTravailStatus =
  | { available: true }
  | { available: false; reason: "identifiants à configurer" };

/**
 * La source est-elle utilisable ?
 *
 * Ne renvoie JAMAIS la valeur des identifiants, seulement leur présence — cet
 * état part jusqu'au client pour griser la case dans l'écran.
 */
export function franceTravailStatus(
  env: EnvLike = process.env,
): FranceTravailStatus {
  const id = env.FRANCE_TRAVAIL_CLIENT_ID?.trim();
  const secret = env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim();
  if (!id || !secret) return { available: false, reason: "identifiants à configurer" };
  return { available: true };
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/** Jeton en mémoire du processus, avec sa péremption. */
let token: { value: string; expiresAt: number } | null = null;

/**
 * Jeton d'accès, renouvelé à l'expiration.
 *
 * Gardé en mémoire et non dans `enrichment_cache` : un jeton d'accès est un
 * secret, il n'a rien à faire dans une table qu'on lit et qu'on exporte. La
 * marge de 60 s évite d'utiliser un jeton qui expire pendant l'appel.
 */
async function accessToken(env: EnvLike = process.env): Promise<Result<string>> {
  if (token && token.expiresAt > Date.now()) return { ok: true, data: token.value };

  const id = env.FRANCE_TRAVAIL_CLIENT_ID?.trim();
  const secret = env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim();
  if (!id || !secret) return { ok: false, error: "France Travail — identifiants à configurer" };

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
    scope: SCOPE,
  });

  const response = await fetchJson<TokenResponse>(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    TIMEOUT_MS,
  );

  // Le message d'erreur de l'API peut contenir l'identifiant envoyé : on ne le
  // propage pas, on rend une phrase neutre.
  if (!response.ok) return { ok: false, error: "France Travail — authentification refusée" };

  const value = response.data.access_token;
  if (!value) return { ok: false, error: "France Travail — jeton absent de la réponse" };

  const ttl = (response.data.expires_in ?? 1200) * 1000;
  token = { value, expiresAt: Date.now() + Math.max(0, ttl - 60_000) };
  return { ok: true, data: value };
}

/** Remet le jeton à zéro (tests). */
export function resetFranceTravailToken(): void {
  token = null;
}

/** Ce qu'on retient d'une offre. */
export interface JobSignal {
  companyName: string;
  city: string | null;
  postalCode: string | null;
  /** Intitulé du poste, tel que publié. */
  title: string;
  /** Date de création de l'offre, ISO. */
  publishedAt: string;
  url: string;
}

interface RawOffer {
  intitule?: string | null;
  dateCreation?: string | null;
  entreprise?: { nom?: string | null } | null;
  lieuTravail?: { libelle?: string | null; codePostal?: string | null } | null;
  origineOffre?: { urlOrigine?: string | null } | null;
  id?: string | null;
}

interface SearchResponse {
  resultats?: RawOffer[];
}

/**
 * Commune d'une offre.
 *
 * `lieuTravail.libelle` arrive sous la forme « 69 - LYON 03 » : le préfixe
 * département est du bruit pour le rapprochement par nom de commune.
 */
export function cityOf(libelle: string | null | undefined): string | null {
  if (!libelle) return null;
  const withoutDepartement = libelle.replace(/^\s*\d{2,3}[A-B]?\s*-\s*/, "");
  return withoutDepartement.trim() || null;
}

/** Traduit une offre brute, ou `null` si elle n'est pas exploitable. */
export function toJobSignal(offer: RawOffer): JobSignal | null {
  const companyName = offer.entreprise?.nom?.trim();
  const publishedAt = offer.dateCreation?.trim();
  const title = offer.intitule?.trim();

  // Une offre sans nom d'entreprise est anonyme (elle passe par un cabinet) :
  // impossible à rapprocher, donc inutilisable ici.
  if (!companyName || !publishedAt || !title) return null;

  return {
    companyName,
    city: cityOf(offer.lieuTravail?.libelle),
    postalCode: offer.lieuTravail?.codePostal?.trim() || null,
    title,
    publishedAt,
    url:
      offer.origineOffre?.urlOrigine ??
      (offer.id ? `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}` : SEARCH_URL),
  };
}

export interface JobQuery {
  /** Numéro de département. */
  departement: string;
  /** Fenêtre d'antériorité, en jours. */
  days: number;
  /** Offres à ramener, toutes pages confondues. */
  max: number;
  today?: Date;
  env?: EnvLike;
}

/** `minCreationDate` attend un ISO complet en UTC, pas une date seule. */
export function minCreationDate(days: number, today = new Date()): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 19) + "Z";
}

/**
 * Offres récentes d'un département, les plus fraîches d'abord.
 *
 * Renvoie une erreur explicite quand les identifiants manquent : c'est
 * l'appelant qui décide de continuer sans cette source, pas ce module.
 */
export async function recentJobSignals(query: JobQuery): Promise<Result<JobSignal[]>> {
  const env = query.env ?? process.env;
  const status = franceTravailStatus(env);
  if (!status.available) {
    return { ok: false, error: `France Travail — ${status.reason}` };
  }

  const auth = await accessToken(env);
  if (!auth.ok) return auth;

  const since = minCreationDate(query.days, query.today);
  const signals: JobSignal[] = [];
  const seen = new Set<string>();

  for (let start = 0; start < query.max; start += FT_PAGE_SIZE) {
    const end = Math.min(start + FT_PAGE_SIZE, query.max) - 1;
    const params = new URLSearchParams({
      departement: query.departement,
      minCreationDate: since,
      codeROME: FT_ROME_CODES.join(","),
      range: `${start}-${end}`,
      sort: "1",
    });
    const url = `${SEARCH_URL}?${params.toString()}`;

    const page = await cached<SearchResponse>(
      `france-travail:${query.departement}:${query.days}:${start}-${end}`,
      async () => {
        await spacerFor("france-travail", FT_RATE_PER_SECOND).wait();
        const response = await fetchJson<SearchResponse>(
          url,
          { headers: { Authorization: `Bearer ${auth.data}`, Accept: "application/json" } },
          TIMEOUT_MS,
        );
        return response.ok ? response.data : null;
      },
      CACHE_TTL_MS,
    );

    if (!page) {
      if (!signals.length) return { ok: false, error: "France Travail — offres illisibles" };
      break;
    }

    const rows = page.resultats ?? [];
    for (const row of rows) {
      const signal = toJobSignal(row);
      // Une entreprise qui publie dix offres reste une seule cible : on garde
      // la plus récente, c'est-à-dire la première vue.
      const key = signal && `${signal.companyName.toLowerCase()}|${signal.city ?? ""}`;
      if (signal && key && !seen.has(key)) {
        seen.add(key);
        signals.push(signal);
      }
    }

    if (rows.length < end - start + 1) break;
  }

  return { ok: true, data: signals };
}

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
 * Familles de métiers de l'ENTONNOIR « signaux d'abord » : le BACK-OFFICE.
 *
 * L'entonnoir vend l'automatisation des tâches répétitives d'une PME ; sa
 * table des pains (lib/funnel/pain-map.ts) reconnaît ADV, commerciaux
 * sédentaires, comptables, acheteurs, magasiniers, secrétariat, RH, qualité,
 * planification. Avec les codes ci-dessus (informatique, R&D), le run du
 * 30/09/2026 ne ramenait que 4 offres utiles sur 139 : des développeurs et des
 * ingénieurs, dont l'intitulé ne révèle aucune tâche à automatiser.
 */
/*
 * ÉLARGI le 05/10/2026 (Cowork) : France Travail est le levier n° 1 — postes
 * dont les tâches sont automatisables. Libellés relus dans le référentiel
 * officiel de l'API (/referentiel/metiers, ROME 4) : M1602 y désigne
 * désormais « Secrétaire administratif de COLLECTIVITÉ TERRITORIALE » (secteur
 * public) — il est retiré ; l'assistant(e) administratif/ve est M1607.
 */
export const FUNNEL_ROME_CODES = [
  // Assistanat administratif et de direction, office management
  "M1607", // Assistant administratif / Assistante administrative
  "M1604", // Assistant / Assistante de direction
  "M1432", // Office manager
  "M1605", // Secrétaire technique
  // ADV, assistanat commercial sédentaire, gestion des commandes
  "D1401", // Assistant commercial / Assistante commerciale
  "D1409", // Assistant / Assistante administration des ventes
  "D1432", // Assistant / Assistante service clients
  "D1407", // Technico-commercial / Technico-commerciale (devis)
  // Comptabilité, facturation, recouvrement
  "M1203", // Comptable
  "M1225", // Aide-comptable
  "M1213", // Assistant / Assistante comptable
  "M1608", // Secrétaire comptable
  "M1611", // Secrétaire facturier / facturière
  "D1422", // Chargé / Chargée de recouvrement de créances
  // Stock, approvisionnement, achats
  "M1101", // Acheteur / Acheteuse
  "D1431", // Assistant / Assistante achat
  "N1303", // Approvisionneur / Approvisionneuse logistique
  "N1209", // Technicien / Technicienne logistique (gestion de stock)
  // SAV, hotline
  "H1108", // Technicien / Technicienne support client en industrie
  "I1404", // Conseiller / Conseillère support technique informatique
  // Logistique et transport
  "N1210", // Logisticien / Logisticienne
  "N1201", // Affréteur / Affréteuse (gestion transport)
  // Conservés de la liste précédente
  "M1501", // Assistant / Assistante RH
  "H1401", // Gestion industrielle et logistique (planification)
] as const;

/** Offres France Travail : publiées depuis moins de 30 jours, sur toute la France. */
export const FUNNEL_FT_DAYS = 30;

/**
 * Plafond de LECTURE France Travail par run de l'entonnoir (Cowork, 05/10/2026).
 *
 * Avant, une seule requête tous codes confondus, plafonnée à 2 000 offres : les
 * plus récentes, soit ~3 jours sur 30 (16 437 offres disponibles). La lecture
 * se fait maintenant code ROME par code ROME, sur toute la fenêtre de 30 jours.
 */
export const FUNNEL_FT_MAX_OFFERS = 8_000;

/**
 * Une requête ne pagine pas au-delà de 3 150 offres (`range` limité à
 * 3000-3149 par l'API). Au-delà, on fait glisser la fenêtre de dates : la
 * borne haute devient la date de la plus ancienne offre déjà lue.
 */
export const FT_RANGE_LIMIT = 3_150;

/** Compteurs de lecture, pour le rapport du run. */
export interface FtHarvestStats {
  /** Offres lues (toutes, avant tout écart). */
  read: number;
  /** Offres anonymes (sans nom d'employeur) : ignorées. */
  anonymous: number;
  /** Offres d'intermédiaires (intérim, cabinets) : ignorées. */
  staffing: number;
  /** Offres lues par code ROME. */
  byCode: Record<string, number>;
}

export function emptyFtStats(): FtHarvestStats {
  return { read: 0, anonymous: 0, staffing: 0, byCode: {} };
}

/** Une page de recherche : code ROME, fenêtre de dates, tranche `range`. */
export interface FtPageRequest {
  code: string;
  min: string;
  max: string;
  start: number;
  end: number;
  /** Fenêtre glissée : sa borne haute est la date d'une offre, pas « maintenant ». */
  slid?: boolean;
}

export type FtPageFetcher = (request: FtPageRequest) => Promise<{ resultats?: RawOffer[] } | null>;

export interface PaginatedJobQuery {
  days: number;
  /** Plafond total d'offres lues, tous codes confondus. */
  maxOffers: number;
  romeCodes: readonly string[];
  today?: Date;
  env?: EnvLike;
  /** Horodatage (ms) au-delà duquel on s'arrête avec ce qui est lu. */
  deadline?: number;
  /** Rempli au fil de la lecture. */
  stats?: FtHarvestStats;
  /** Injecté par les tests ; sinon l'API réelle, avec cache d'un jour. */
  fetchPage?: FtPageFetcher;
}

/**
 * Offres de TOUTE la fenêtre, code ROME par code ROME.
 *
 * Le plafond total se répartit entre les codes : chacun a droit à la part
 * restante divisée par le nombre de codes restants, si bien qu'un petit code
 * (affréteur, office manager) lit ses 30 jours entiers et que ce qu'il laisse
 * profite aux gros (assistant administratif, comptable). Offres anonymes et
 * intermédiaires ignorés, une entreprise (nom + commune) gardée une fois.
 */
export async function paginatedJobSignals(query: PaginatedJobQuery): Promise<Result<JobSignal[]>> {
  let fetchPage = query.fetchPage;
  if (!fetchPage) {
    const env = query.env ?? process.env;
    const status = franceTravailStatus(env);
    if (!status.available) return { ok: false, error: `France Travail — ${status.reason}` };
    const auth = await accessToken(env);
    if (!auth.ok) return auth;
    fetchPage = (request) => fetchFtPage(request, auth.data);
  }

  const window = creationWindow(query.days, query.today);
  const stats = query.stats ?? emptyFtStats();
  const signals: JobSignal[] = [];
  const seen = new Set<string>();
  let budget = query.maxOffers;
  let failures = 0;
  let pages = 0;

  // État de lecture de chaque code : on peut y revenir à la passe suivante.
  const cursors = query.romeCodes.map((code) => ({ code, max: window.max, start: 0, oldest: null as string | null, done: false }));

  // Passe après passe : chaque code non épuisé lit sa part du budget restant.
  // Un code saturé à la première passe (assistant administratif) récupère à la
  // suivante ce que les petits codes n'ont pas consommé.
  passes: while (budget > 0) {
    const open = cursors.filter((cursor) => !cursor.done);
    if (!open.length) break;
    let readThisPass = 0;
    for (let index = 0; index < open.length; index += 1) {
      const cursor = open[index];
      const quota = Math.max(1, Math.floor(budget / (open.length - index)));
      let readForCode = 0;

      while (readForCode < quota && !cursor.done) {
        if (query.deadline && Date.now() > query.deadline) break passes;
        if (cursor.start >= FT_RANGE_LIMIT) {
          // Fenêtre épuisée : on repart de la plus ancienne offre lue.
          const next = cursor.oldest ? isoSecond(new Date(cursor.oldest)) : null;
          if (!next || next === cursor.max || next <= window.min) {
            cursor.done = true;
            break;
          }
          cursor.max = next;
          cursor.start = 0;
        }
        const start = cursor.start;
        const end = Math.min(start + FT_PAGE_SIZE, start + quota - readForCode, FT_RANGE_LIMIT) - 1;
        const page = await fetchPage({ code: cursor.code, min: window.min, max: cursor.max, start, end, slid: cursor.max !== window.max });
        pages += 1;
        if (!page) {
          failures += 1;
          cursor.done = true;
          break;
        }
        const rows = page.resultats ?? [];
        readForCode += rows.length;
        for (const row of rows) {
          const created = row.dateCreation?.trim();
          if (created && (!cursor.oldest || created < cursor.oldest)) cursor.oldest = created;
          const signal = toJobSignal(row);
          if (!signal) {
            if (!row.entreprise?.nom?.trim()) stats.anonymous += 1;
            continue;
          }
          if (looksLikeStaffingAgency(signal.companyName)) {
            stats.staffing += 1;
            continue;
          }
          const key = `${signal.companyName.toLowerCase()}|${signal.city ?? ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            signals.push(signal);
          }
        }
        if (rows.length < end - start + 1) cursor.done = true;
        cursor.start = end + 1;
      }
      stats.read += readForCode;
      stats.byCode[cursor.code] = (stats.byCode[cursor.code] ?? 0) + readForCode;
      budget -= readForCode;
      readThisPass += readForCode;
      if (budget <= 0) break passes;
    }
    if (!readThisPass) break;
  }

  if (!signals.length && failures && failures === pages) {
    return { ok: false, error: "France Travail — offres illisibles" };
  }
  return { ok: true, data: signals };
}

/** Une page réelle de l'API, mise en cache un jour. */
async function fetchFtPage(request: FtPageRequest, token: string): Promise<SearchResponse | null> {
  const params = new URLSearchParams({
    minCreationDate: request.min,
    maxCreationDate: request.max,
    codeROME: request.code,
    range: `${request.start}-${request.end}`,
    sort: "1",
  });
  const url = `${SEARCH_URL}?${params.toString()}`;
  // La borne haute de la PREMIÈRE fenêtre bouge à chaque appel : on n'en garde
  // que le jour (comme pour la borne basse) ; une fenêtre glissée, elle, est
  // fixée par une date d'offre et entre telle quelle dans la clé.
  const maxKey = request.slid ? request.max : "now";
  return cached<SearchResponse>(
    `france-travail:rome:${request.code}:${request.min.slice(0, 10)}:${maxKey}:${request.start}-${request.end}`,
    async () => {
      await spacerFor("france-travail", FT_RATE_PER_SECOND).wait();
      const response = await fetchJson<SearchResponse>(
        url,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        TIMEOUT_MS,
      );
      return response.ok ? response.data : null;
    },
    CACHE_TTL_MS,
  );
}

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
export async function accessToken(env: EnvLike = process.env): Promise<Result<string>> {
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
  /**
   * Site de l'ENTREPRISE donné par l'offre (`entreprise.url`) — présent dans
   * ~8 % des offres nommées (échantillon de 150 offres, 05/10/2026). Une
   * piste, pas une preuve : validé comme tout site trouvé avant usage.
   */
  employerUrl?: string | null;
}

export interface RawOffer {
  intitule?: string | null;
  dateCreation?: string | null;
  entreprise?: { nom?: string | null; url?: string | null; description?: string | null } | null;
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
    employerUrl: offer.entreprise?.url?.trim() || null,
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
  /** Codes ROME demandés (défaut : FT_ROME_CODES, informatique et ingénierie). */
  romeCodes?: readonly string[];
}

/** L'API attend un ISO complet en UTC, pas une date seule. */
function isoSecond(date: Date): string {
  return date.toISOString().slice(0, 19) + "Z";
}

/**
 * Bornes de la fenêtre de publication.
 *
 * Les DEUX sont obligatoires : envoyer `minCreationDate` seul fait répondre
 * « HTTP 400 — les paramètres minCreationDate et maxCreationDate sont
 * dépendants et doivent être renseignés ensemble ». Mesuré contre l'API le
 * 25/09/2026 ; la borne haute est le moment de l'appel.
 */
export function creationWindow(days: number, today = new Date()): { min: string; max: string } {
  return { min: isoSecond(new Date(today.getTime() - days * 86_400_000)), max: isoSecond(today) };
}

/**
 * Agence d'intérim, cabinet de recrutement ou ESN de placement ?
 *
 * Mesuré sur les 150 premières offres du Rhône : Gojob, APROJOB, Randstad,
 * Michael Page… Ces entreprises publient pour LEURS CLIENTS. Les prospecter
 * revient à viser l'intermédiaire au lieu de l'employeur, exactement le faux
 * positif qui avait déjà coûté une fiche (« RAS INTERIM JERECRUTE »).
 *
 * Le filtre par NAF (78.20Z, 78.10Z) vient plus tard, à l'identification ; ce
 * filtre-ci est gratuit et s'applique tout de suite, sur le nom.
 */
const STAFFING_NAME =
  /\b(interim|intérim|int[ée]rimaire|randstad|adecco|manpower|synergie|proman|actual|groupe crit|crit interim|startpeople|start people|supplay|temporis|domino|aprojob|gojob|page ?personnel|michael ?page|hays|expectra|fed |walters people|lynx ?rh|gi group|triangle|leader ?interim|job ?link|solano|abalone|menway|kelly services|spring ?france|fiderim|nexiium|talents?|cabinet de recrutement|recrutement)\b/i;

export function looksLikeStaffingAgency(name: string): boolean {
  const normalised = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // On ne teste QUE la forme sans accents : en JS, « \b » est ASCII, donc un
  // « é » compte comme frontiere de mot et « Décrit » declencherait « crit ».
  return STAFFING_NAME.test(normalised);
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

  const window = creationWindow(query.days, query.today);
  const signals: JobSignal[] = [];
  const seen = new Set<string>();

  for (let start = 0; start < query.max; start += FT_PAGE_SIZE) {
    const end = Math.min(start + FT_PAGE_SIZE, query.max) - 1;
    const params = new URLSearchParams({
      departement: query.departement,
      minCreationDate: window.min,
      maxCreationDate: window.max,
      codeROME: (query.romeCodes ?? FT_ROME_CODES).join(","),
      range: `${start}-${end}`,
      sort: "1",
    });
    // Département vide : toute la France (option de l'entonnoir).
    if (!query.departement) params.delete("departement");
    const url = `${SEARCH_URL}?${params.toString()}`;

    const page = await cached<SearchResponse>(
      // La borne haute bouge à chaque appel : elle est volontairement HORS de
      // la clé, sinon le cache d'un jour ne servirait jamais.
      // Des codes ROME différents = des offres différentes : ils entrent dans la
      // clé (la clé par défaut ne change pas, pour garder le cache existant).
      `france-travail:v2:${query.romeCodes ? `${query.romeCodes.join("+")}:` : ""}${query.departement}:${query.days}:${start}-${end}:${window.min.slice(0, 10)}`,
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
      // Un intermédiaire recrute pour quelqu'un d'autre : ce n'est pas lui la
      // cible, et sa fiche coûterait un appel Pappers pour rien.
      if (signal && looksLikeStaffingAgency(signal.companyName)) continue;
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

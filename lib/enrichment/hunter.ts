/**
 * Client Hunter.io — trouver À QUI écrire.
 *
 * Trois tentatives, dans cet ordre, et on s'arrête à la première qui donne un
 * décideur :
 *   1. `domain-search` puis filtrage sur un POSTE décisionnaire (dirigeant,
 *      DG, directeur des opérations, DAF). Un contact « comptabilité » ou
 *      « support » ne compte pas : écrire à un service partagé ne vaut guère
 *      mieux que d'écrire à contact@.
 *   2. `email-finder` avec le prénom et le nom du dirigeant personne physique
 *      — y compris celui retrouvé derrière une holding.
 *   3. rien. L'appelant écrit « Bonjour, » et affiche un badge « sans contact
 *      nominatif ». C'est un résultat honnête, pas une panne.
 *
 * QUOTA — compte Hunter Starter depuis le 02/10/2026 : 2 000 crédits par mois,
 * remis à zéro le 2 du mois. Plutôt que de coder ce chiffre en dur et de le voir vieillir,
 * on interroge `/v2/account`, qui renvoie la consommation réelle du plan
 * souscrit. Au-delà du quota, l'API répond 429 : on le traduit en message
 * clair, jamais en exception.
 */
import { recordUnitUsage } from "@/lib/usage/record";
import { gatedHunterCall, hunterCacheKey } from "@/lib/hunter/gate";
import { supabaseHunterStore } from "@/lib/hunter/store";
import type { Result } from "./http";
import type { DecisionMakerContact } from "./types";

const BASE = "https://api.hunter.io/v2";
const TIMEOUT_MS = 12_000;

export function hasHunterKey(): boolean {
  return Boolean(process.env.HUNTER_API_KEY);
}

interface HunterEmail {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  department?: string | null;
}

interface HunterError {
  id?: string;
  code?: number;
  details?: string;
}

/** Réponse Hunter, erreurs comprises : elles arrivent en JSON, même en 4xx. */
interface HunterEnvelope<T> {
  data?: T;
  errors?: HunterError[];
  meta?: { results?: number };
}

export interface HunterFailure {
  error: string;
  /** `true` quand le plan a épuisé ses recherches : ce n'est pas une panne. */
  quotaExceeded: boolean;
}

/**
 * `cached` : réponse relue dans le cache 90 jours, AUCUNE recherche facturée.
 * `blocked` : appel non fait (budget du jour, crédits épuisés) — pas une panne.
 */
type HunterResult<T> = { ok: true; data: T; cached?: boolean } | ({ ok: false; blocked?: boolean } & HunterFailure);

/**
 * GET Hunter, derrière le garde-fou (lib/hunter/gate.ts) : cache 90 jours par
 * requête, budget quotidien, arrêt sur crédits épuisés. `account` (gratuit, et
 * qui sert à lire le quota) passe directement.
 */
async function hunterGet<T>(path: string, params: URLSearchParams): Promise<HunterResult<T>> {
  if (path === "account") return rawHunterGet<T>(path, params);
  if (!process.env.HUNTER_API_KEY) return { ok: false, error: "HUNTER_API_KEY absente", quotaExceeded: false };
  const box: { failure?: HunterFailure } = {};
  const gated = await gatedHunterCall<T>(
    supabaseHunterStore(),
    hunterCacheKey(path, Object.fromEntries(params)),
    async () => {
      const response = await rawHunterGet<T>(path, new URLSearchParams(params));
      if (response.ok) return { data: response.data, quotaExceeded: false };
      box.failure = { error: response.error, quotaExceeded: response.quotaExceeded };
      return { data: null, quotaExceeded: response.quotaExceeded };
    },
  );
  if (gated.status === "cache") return { ok: true, data: gated.data, cached: true };
  if (gated.status === "bloque") return { ok: false, error: gated.reason, quotaExceeded: false, blocked: true };
  if (gated.data !== null) return { ok: true, data: gated.data };
  return { ok: false, ...(box.failure ?? { error: "Hunter injoignable", quotaExceeded: false }) };
}

/**
 * GET Hunter brut : lit le corps JSON même en erreur, pour restituer le message du
 * fournisseur plutôt qu'un « HTTP 429 » opaque.
 */
async function rawHunterGet<T>(path: string, params: URLSearchParams): Promise<HunterResult<T>> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { ok: false, error: "HUNTER_API_KEY absente", quotaExceeded: false };
  params.set("api_key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/${path}?${params}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as HunterEnvelope<T>;

    if (!response.ok) {
      const detail = body.errors?.[0]?.details ?? `HTTP ${response.status}`;
      // 429 = quota épuisé ; 451 = domaine refusé pour raisons légales.
      return { ok: false, error: detail, quotaExceeded: response.status === 429 };
    }
    return { ok: true, data: (body.data ?? {}) as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? `délai dépassé (${TIMEOUT_MS / 1000}s)` : "Hunter injoignable",
      quotaExceeded: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface HunterQuota {
  planName: string | null;
  used: number;
  available: number;
  /** Recherches encore disponibles ce mois-ci. */
  remaining: number;
}

interface HunterAccount {
  plan_name?: string;
  requests?: { searches?: { used?: number; available?: number } };
}

/** État réel du compte : c'est la source de vérité sur le quota, pas une constante. */
export async function fetchQuota(): Promise<HunterQuota | null> {
  const response = await hunterGet<HunterAccount>("account", new URLSearchParams());
  if (!response.ok) return null;
  const searches = response.data.requests?.searches ?? {};
  const used = searches.used ?? 0;
  const available = searches.available ?? 0;
  return {
    planName: response.data.plan_name ?? null,
    used,
    available,
    remaining: Math.max(available - used, 0),
  };
}

// ---------------------------------------------------------------------------
// Recherche du décideur
// ---------------------------------------------------------------------------

/**
 * Postes qui décident d'acheter une prestation d'automatisation dans une PME.
 * Volontairement étroit : mieux vaut pas de contact qu'un contact inutile.
 */
const DECISION_MAKER =
  /\b(pr[ée]sident|p-?dg|pdg|directeur? g[ée]n[ée]ral|directrice g[ée]n[ée]rale|g[ée]rant|co-?fondat|fondat|ceo|coo|cto|cfo|owner|dirigeant|directeur des op[ée]rations|directrice des op[ée]rations|directeur administratif|directrice administrative|daf|directeur financier|directrice financi[èe]re|responsable administratif|chief)\b/i;

/**
 * Postes COMMERCIAUX.
 *
 * Ils valent mieux que rien, mais pas mieux que le dirigeant : un directeur
 * commercial n'arbitre pas la facon dont les dossiers circulent en interne. On
 * ne lui ecrit que si le besoin porte sur la vente — devis, prise de rendez-
 * vous, relance de prospects. Constate sur MAISONS TERRE D'OC, ou le mail
 * partait a un commercial alors que le pain etait operationnel et que
 * l'adresse du president etait connue.
 */
const COMMERCIAL_POSITION =
  /commercial|business development|ventes?|sales|account|charg[eé]e? d'affaires|d[eé]veloppement/i;

export function isCommercialPosition(position: string | null | undefined): boolean {
  return Boolean(position && COMMERCIAL_POSITION.test(position) && !DECISION_MAKER.test(position));
}

/** `true` si l'intitulé de poste désigne un décideur. */
export function isDecisionMakerPosition(position: string | null | undefined): boolean {
  return Boolean(position && DECISION_MAKER.test(position));
}

/** Priorise : nom du dirigeant connu > poste décisionnaire > séniorité > confiance. */
function score(email: HunterEmail, leaderLastName: string | null): number {
  let value = email.confidence ?? 0;
  if (email.type === "personal") value += 20;
  if (leaderLastName && email.last_name?.toLowerCase() === leaderLastName) value += 200;
  if (isDecisionMakerPosition(email.position)) value += 120;
  if (email.seniority === "executive") value += 60;
  else if (email.seniority === "senior") value += 25;
  if (email.department && ["executive", "management"].includes(email.department)) value += 30;
  return value;
}

function toContact(email: HunterEmail): DecisionMakerContact {
  const fullName = [email.first_name, email.last_name].filter(Boolean).join(" ").trim();
  return {
    email: email.value as string,
    full_name: fullName || null,
    position: email.position ?? null,
    confidence: email.confidence ?? null,
  };
}

/**
 * Trace d'un appel Hunter, quel qu'en soit le resultat.
 *
 * Avant, seul un appel REUSSI laissait une ligne dans `api_usage` : un appel
 * qui ne trouvait personne, ou qui echouait, ne laissait aucune trace. On
 * constatait alors « 4 credits sur 50 » sans pouvoir dire si l'API avait ete
 * appelee. Desormais chaque appel s'ecrit, avec son issue dans l'operation, et
 * `units` ne compte que ce que Hunter facture reellement.
 */
async function trace(
  operation: string,
  outcome: "trouve" | "vide" | "erreur",
  prospectId: string | null | undefined,
  billed: boolean,
): Promise<void> {
  await recordUnitUsage({
    service: "hunter",
    operation: `${operation}:${outcome}`,
    units: billed ? 1 : 0,
    ...(billed ? {} : { unitCost: 0 }),
    prospectId,
  });
}

/**
 * Étape 1 — `domain-search`, et ce qu'on en retient.
 *
 * `contact` porte le meilleur DECIDEUR ; `candidates` porte tous les contacts
 * nominatifs, tries. La distinction compte : sur SELECTION HABITAT, Hunter rend
 * dix personnes reelles — dont un « Business Development Director » a 97 % —
 * dont aucune ne passe la liste blanche des postes. Les jeter toutes pour
 * ecrire « Bonjour, » etait un gachis ; l'appelant peut maintenant se rabattre
 * sur elles sans depenser une seconde recherche.
 */
export interface DomainSearchOutcome {
  contact: DecisionMakerContact | null;
  candidates: DecisionMakerContact[];
}

export async function findDecisionMaker(
  domain: string,
  leaderName?: string | null,
  prospectId?: string | null,
): Promise<Result<DomainSearchOutcome> & { quotaExceeded?: boolean }> {
  const response = await hunterGet<{ emails?: HunterEmail[] }>(
    "domain-search",
    new URLSearchParams({ domain, limit: "10" }),
  );

  if (!response.ok) {
    if (!response.blocked) await trace("domain-search", "erreur", prospectId, false);
    return { ok: false, error: response.error, quotaExceeded: response.quotaExceeded };
  }

  const emails = (response.data.emails ?? []).filter((email) => email.value);
  // Hunter decompte une recherche de domaine, qu'elle trouve un email ou non ;
  // une reponse relue dans le cache, elle, ne coute rien.
  await trace("domain-search", emails.length ? "trouve" : "vide", prospectId, !response.cached);
  if (!emails.length) return { ok: true, data: { contact: null, candidates: [] } };

  const leaderLastName = leaderName?.trim().split(/\s+/).pop()?.toLowerCase() ?? null;
  const sorted = [...emails].sort((a, b) => score(b, leaderLastName) - score(a, leaderLastName));

  const best = sorted.find(
    (email) =>
      isDecisionMakerPosition(email.position) ||
      (leaderLastName && email.last_name?.toLowerCase() === leaderLastName),
  );

  // Candidats de repli : des PERSONNES, avec un prenom. Une adresse de service
  // (contact@, info@) n'est pas un interlocuteur et ne doit pas se faire passer
  // pour un decideur.
  const candidates = sorted
    .filter((email) => email.type === "personal" && email.first_name)
    .map(toContact);

  return { ok: true, data: { contact: best ? toContact(best) : null, candidates } };
}

/**
 * Étape 2 — `email-finder` sur le nom du dirigeant personne physique.
 * Hunter reconstruit l'adresse à partir du schéma du domaine ; le score renvoyé
 * dit à quel point il en est sûr.
 */
export async function findEmailByName(
  domain: string,
  firstName: string,
  lastName: string,
  prospectId?: string | null,
): Promise<Result<DecisionMakerContact | null> & { quotaExceeded?: boolean }> {
  const response = await hunterGet<{
    email?: string | null;
    score?: number;
    position?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }>("email-finder", new URLSearchParams({ domain, first_name: firstName, last_name: lastName }));

  if (!response.ok) {
    if (!response.blocked) await trace("email-finder", "erreur", prospectId, false);
    return { ok: false, error: response.error, quotaExceeded: response.quotaExceeded };
  }
  await trace("email-finder", response.data.email ? "trouve" : "vide", prospectId, !response.cached);
  if (!response.data.email) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      email: response.data.email,
      full_name: [firstName, lastName].filter(Boolean).join(" ").trim() || null,
      position: response.data.position ?? null,
      confidence: response.data.score ?? null,
    },
  };
}

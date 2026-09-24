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
 * QUOTA — le plan gratuit Hunter est limité (25 recherches par mois au moment
 * de l'écriture). Plutôt que de coder ce chiffre en dur et de le voir vieillir,
 * on interroge `/v2/account`, qui renvoie la consommation réelle du plan
 * souscrit. Au-delà du quota, l'API répond 429 : on le traduit en message
 * clair, jamais en exception.
 */
import { recordUnitUsage } from "@/lib/usage/record";
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

type HunterResult<T> = { ok: true; data: T } | ({ ok: false } & HunterFailure);

/**
 * GET Hunter : lit le corps JSON même en erreur, pour restituer le message du
 * fournisseur plutôt qu'un « HTTP 429 » opaque.
 */
async function hunterGet<T>(path: string, params: URLSearchParams): Promise<HunterResult<T>> {
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
 * Étape 1 — `domain-search`, puis filtrage sur un poste décisionnaire.
 * Renvoie `null` (et non une erreur) quand le domaine est connu mais ne
 * contient aucun décideur : l'étape 2 prendra le relais.
 */
export async function findDecisionMaker(
  domain: string,
  leaderName?: string | null,
  prospectId?: string | null,
): Promise<Result<DecisionMakerContact | null> & { quotaExceeded?: boolean }> {
  const response = await hunterGet<{ emails?: HunterEmail[] }>(
    "domain-search",
    new URLSearchParams({ domain, limit: "10" }),
  );

  // Hunter decompte une recherche de domaine, qu'elle trouve un email ou non.
  if (response.ok) {
    await recordUnitUsage({ service: "hunter", operation: "domain-search", units: 1, prospectId });
  }
  if (!response.ok) return { ok: false, error: response.error, quotaExceeded: response.quotaExceeded };

  const emails = (response.data.emails ?? []).filter((email) => email.value);
  if (!emails.length) return { ok: true, data: null };

  const leaderLastName = leaderName?.trim().split(/\s+/).pop()?.toLowerCase() ?? null;
  const sorted = [...emails].sort((a, b) => score(b, leaderLastName) - score(a, leaderLastName));

  // Un décideur, ou le dirigeant connu. Sinon rien : on passe à l'étape 2.
  const best = sorted.find(
    (email) =>
      isDecisionMakerPosition(email.position) ||
      (leaderLastName && email.last_name?.toLowerCase() === leaderLastName),
  );
  return { ok: true, data: best ? toContact(best) : null };
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

  if (response.ok) {
    await recordUnitUsage({ service: "hunter", operation: "email-finder", units: 1, prospectId });
  }
  if (!response.ok) return { ok: false, error: response.error, quotaExceeded: response.quotaExceeded };
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

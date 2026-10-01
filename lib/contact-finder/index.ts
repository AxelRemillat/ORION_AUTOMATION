import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database, Prospect, ProspectUpdate } from "@/types";
import { realDeps } from "./clients";
import { runContactSearch, type ContactDeps } from "./finder";
import { identityOf } from "./sources";
import { toDomain } from "./domains";
import { serviceUnit } from "@/lib/usage/pricing";
import { conclusionOf, type PastSearch, type StoredSearch } from "./report";
import { hunterPolicy } from "./policy";
import { hunterStatus, type HunterGateStore } from "@/lib/hunter/gate";
import { supabaseHunterStore } from "@/lib/hunter/store";
import type { CompanyIdentity, ContactBudget, ContactResult, ContactTrace } from "./types";

export type { ContactResult } from "./types";

/**
 * Point d'entrée du module contact — CONTRAT PARTAGÉ entre sessions :
 *
 *   findContact(prospectId: string): Promise<ContactResult>
 *
 * Cherche le site officiel et l'adresse à laquelle écrire, puis l'enregistre
 * sur la fiche (website, email, email_type, email_source_url,
 * contact_confidence, contact_found_by) avec le journal de la recherche.
 *
 * SERVEUR UNIQUEMENT (client service_role). Les options sont facultatives :
 * la signature à un argument reste valable partout.
 */
export interface FindContactOptions {
  /** Client à utiliser (celui du job) ; service_role par défaut. */
  db?: SupabaseClient<Database>;
  /** Restreint la lecture à ce propriétaire. */
  userId?: string;
  /** Site saisi à la main sur la fiche : il passe devant tout le reste. */
  website?: string | null;
  /** `false` : cherche sans rien écrire (script de test en direct). */
  persist?: boolean;
  /** Injecté par les tests. */
  deps?: ContactDeps;
  /** Compteur et cache Hunter ; injecté par les tests (aucun budget lu sinon). */
  hunterStore?: HunterGateStore;
}

/**
 * Hunter pour CETTE fiche : feu vert de la fiche (score, registre, exclusions —
 * `hunterPolicy`), puis budget du jour et crédits restants (garde-fou).
 * Le budget n'est lu que si la fiche y a droit : pas de requête pour rien.
 */
async function hunterFor(prospect: Prospect, store: HunterGateStore | null) {
  const policy = hunterPolicy(prospect.key_figures as Record<string, unknown> | null);
  if (!policy.allowed || !store) return policy;
  const status = await hunterStatus(store);
  return status.blocked ? { allowed: false as const, reason: status.blocked } : policy;
}

const TIER: Record<string, number> = { nominatif: 2, generique: 1 };

export async function findContact(prospectId: string, options: FindContactOptions = {}): Promise<ContactResult> {
  const db = options.db ?? createAdminClient();
  let query = db.from("prospects").select("*").eq("id", prospectId);
  if (options.userId) query = query.eq("user_id", options.userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`lecture du prospect impossible : ${error.message}`);
  const prospect = data as Prospect | null;
  if (!prospect) throw new Error("Prospect introuvable.");

  const website = normalizeWebsite(options.website);
  const company = await identityOf(prospect, website);
  const store = options.hunterStore ?? (options.deps ? null : supabaseHunterStore());
  const hunter = await hunterFor(prospect, store);
  const { result, trace } = await runContactSearch(company, options.deps ?? realDeps(prospect.id), undefined, { hunter });
  if (options.persist !== false) await persist(db, prospect, storedSearch(trace, result, company, prospect), result, website);
  return result;
}

function normalizeWebsite(value: string | null | undefined): string | null {
  const domain = toDomain(value);
  return domain ? `https://${domain}` : null;
}

/** Ce que la recherche a cherché sur chaque page lue : sert au compte rendu. */
export function lookedFor(company: CompanyIdentity): string[] {
  return [
    ...(company.siren ? ["SIREN"] : []),
    "raison sociale",
    ...(company.city || company.postalCode ? ["ville"] : []),
    ...(company.leader ? ["dirigeant"] : []),
    "adresses e-mail",
  ];
}

/**
 * Coût en euros, à la grille de l'écran Coûts (lib/usage/pricing) : les mêmes
 * unités que celles écrites dans api_usage par clients.ts. L'appel modèle
 * éventuel est compté à part (facturé aux tokens) et n'entre pas dans ce total.
 */
export function searchCost(spent: ContactBudget): number {
  const hunter = spent.hunterDomainSearch + spent.hunterFinder + spent.hunterVerifier;
  const total = spent.linkup * serviceUnit("linkup").unitCost + hunter * serviceUnit("hunter").unitCost;
  return Number(total.toFixed(4));
}

/** Nombre de conclusions passées gardées sur la fiche. */
const HISTORY = 5;

/** Journal + compte rendu + historique : la valeur de `contact_search`. */
export function storedSearch(
  trace: ContactTrace,
  result: ContactResult,
  company: CompanyIdentity,
  prospect: Pick<Prospect, "contact_search">,
  now = new Date(),
): StoredSearch {
  const previous = (prospect.contact_search ?? null) as StoredSearch | null;
  const history: PastSearch[] = previous?.checked_at
    ? [{ checked_at: previous.checked_at, ...conclusionOf(previous) }, ...(previous.history ?? [])].slice(0, HISTORY)
    : [];
  return {
    ...trace,
    result,
    checked_at: now.toISOString(),
    cost_eur: searchCost(trace.spent),
    // Hunter n'a pas de prix par défaut (HUNTER_SEARCH_EUR) : le total le dit.
    cost_excludes_hunter:
      trace.spent.hunterDomainSearch + trace.spent.hunterFinder + trace.spent.hunterVerifier > 0 &&
      !serviceUnit("hunter").priceKnown,
    looked_for: lookedFor(company),
    history,
  };
}

/**
 * Écrit le résultat sans jamais écraser ce qu'on n'a pas écrit soi-même :
 *   - le site : s'il est vide, ou s'il vient d'être saisi à la main ;
 *   - l'adresse : si la fiche n'en a pas, ou si l'adresse en place vient d'une
 *     recherche précédente ET que la nouvelle est meilleure (nominatif >
 *     générique, puis confiance). Une adresse saisie à la main reste.
 */
async function persist(
  db: SupabaseClient<Database>,
  prospect: Prospect,
  search: StoredSearch,
  result: ContactResult,
  typedWebsite: string | null,
): Promise<void> {
  const patch: ProspectUpdate = {
    contact_search: search as unknown as Record<string, unknown>,
    contact_checked_at: search.checked_at,
  };
  if (typedWebsite) patch.website = typedWebsite;
  else if (!prospect.website && result.website) patch.website = result.website;

  const current = prospect.email?.trim().toLowerCase() || null;
  const ours = Boolean(prospect.contact_found_by);
  const better =
    !current ||
    current === result.email ||
    (ours &&
      ((TIER[result.email_type ?? ""] ?? 0) > (TIER[prospect.email_type ?? ""] ?? 0) ||
        ((TIER[result.email_type ?? ""] ?? 0) === (TIER[prospect.email_type ?? ""] ?? 0) &&
          result.confidence > (prospect.contact_confidence ?? 0))));
  if (result.email && better) {
    Object.assign(patch, {
      email: result.email,
      email_type: result.email_type ?? null,
      email_source_url: result.email_source_url ?? null,
      contact_confidence: result.confidence,
      contact_found_by: result.found_by,
    });
  }

  // Téléphone du site et doute sur l'adresse : dans key_figures (pas de
  // colonne dédiée). Un téléphone déjà connu n'est pas remplacé.
  const figures = { ...(prospect.key_figures ?? {}) } as Record<string, unknown>;
  let figuresChanged = false;
  if (result.phone && !figures.phone) {
    figures.phone = result.phone;
    figuresChanged = true;
  }
  if (result.email && better && Boolean(figures.email_doubtful) !== Boolean(result.doubtful)) {
    figures.email_doubtful = Boolean(result.doubtful);
    figuresChanged = true;
  }
  if (figuresChanged) patch.key_figures = figures as Prospect["key_figures"];

  const { error } = await db.from("prospects").update(patch).eq("id", prospect.id);
  if (error) throw new Error(`fiche non mise à jour : ${error.message}`);
}

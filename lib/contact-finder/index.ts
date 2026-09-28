import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database, Prospect, ProspectUpdate } from "@/types";
import { realDeps } from "./clients";
import { runContactSearch, type ContactDeps } from "./finder";
import { identityOf } from "./sources";
import { toDomain } from "./domains";
import type { ContactResult, ContactTrace } from "./types";

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
  const { result, trace } = await runContactSearch(company, options.deps ?? realDeps(prospect.id));
  if (options.persist !== false) await persist(db, prospect, result, trace, website);
  return result;
}

function normalizeWebsite(value: string | null | undefined): string | null {
  const domain = toDomain(value);
  return domain ? `https://${domain}` : null;
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
  result: ContactResult,
  trace: ContactTrace,
  typedWebsite: string | null,
): Promise<void> {
  const patch: ProspectUpdate = {
    contact_search: { ...trace, result, checked_at: new Date().toISOString() } as unknown as Record<string, unknown>,
    contact_checked_at: new Date().toISOString(),
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

  const { error } = await db.from("prospects").update(patch).eq("id", prospect.id);
  if (error) throw new Error(`fiche non mise à jour : ${error.message}`);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Prospect } from "@/types";

/**
 * PORTÉE « prospects vivants » — le seul endroit où la corbeille est filtrée.
 *
 * Toute lecture de prospects destinée à un écran ou à un traitement passe par
 * `activeProspects` (ou `activeProspectCount`) ; toute table rattachée à un
 * prospect (messages, deals, relances, emails reçus) est ramenée à la même
 * portée par `scopeToActive`. Un prospect à la corbeille disparaît ainsi de
 * partout d'un coup, sans filtre à recopier écran par écran.
 */

export type Db = SupabaseClient<Database>;

/** `select *` des prospects hors corbeille ; l'appelant chaîne tri et filtres. */
export function activeProspects(db: Db) {
  return db.from("prospects").select("*").is("deleted_at", null);
}

/** Nombre de prospects hors corbeille. */
export function activeProspectCount(db: Db) {
  return db.from("prospects").select("id", { count: "exact", head: true }).is("deleted_at", null);
}

/** Prospects à la corbeille, les plus récents d'abord. */
export function trashedProspects(db: Db) {
  return db
    .from("prospects")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
}

type Owned = { prospect_id: string | null };

/**
 * Ramène des lignes rattachées à la portée des prospects vivants.
 * Une ligne sans prospect (email d'un expéditeur inconnu) est conservée.
 */
export function scopeToActive<T extends Record<string, Owned[]>>(
  prospects: ReadonlyArray<Pick<Prospect, "id">>,
  children: T,
): T {
  const alive = new Set(prospects.map((prospect) => prospect.id));
  const scoped = {} as Record<string, Owned[]>;
  for (const [key, rows] of Object.entries(children)) {
    scoped[key] = rows.filter((row) => row.prospect_id === null || alive.has(row.prospect_id));
  }
  return scoped as T;
}

/** Message renvoyé par toute route qui refuse d'agir sur un prospect à la corbeille. */
export const TRASHED_ERROR = "Prospect à la corbeille : restaurez-le depuis /corbeille pour continuer.";

/** `true` si le prospect existe et n'est pas à la corbeille. */
export async function isActiveProspect(db: Db, prospectId: string): Promise<boolean> {
  const { data } = await activeProspects(db).eq("id", prospectId).maybeSingle();
  return Boolean(data);
}

/** Nombre de prospects à la corbeille (compteur du menu). */
export function trashCount(db: Db) {
  return db.from("prospects").select("id", { count: "exact", head: true }).not("deleted_at", "is", null);
}

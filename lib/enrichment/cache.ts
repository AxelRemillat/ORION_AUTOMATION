import { createAdminClient, createClient } from "@/lib/supabase/server";

/** Hors requete HTTP (scripts), il n'y a pas de cookie : on passe en service_role. */
const client = () => (process.env.ORION_SCRIPT_USER_ID ? createAdminClient() : createClient());

/**
 * Cache des appels payants dont la réponse bouge peu (fiches de registre).
 *
 * Deux étages :
 *   1. mémoire du processus — évite de rappeler Supabase deux fois dans la
 *      même requête, cas fréquent quand plusieurs cibles partagent une holding ;
 *   2. table `enrichment_cache` — survit au recyclage des lambdas, c'est elle
 *      qui économise réellement des crédits.
 *
 * Règle : le cache ne doit JAMAIS faire échouer l'appel qu'il accélère. Toute
 * erreur de lecture ou d'écriture est avalée et traitée comme un défaut de
 * cache — on repaie l'appel, ce qui est désagréable mais pas cassant.
 */

const MEMORY = new Map<string, { value: unknown; expiresAt: number }>();

/** Durée de vie par défaut : un mois, comme demandé pour les fiches Pappers. */
export const THIRTY_DAYS_MS = 30 * 86_400_000;

export async function readCache<T>(key: string): Promise<T | null> {
  const local = MEMORY.get(key);
  if (local && local.expiresAt > Date.now()) return local.value as T;
  if (local) MEMORY.delete(key);

  try {
    const supabase = client();
    const { data } = await supabase
      .from("enrichment_cache")
      .select("payload,expires_at")
      .eq("key", key)
      .maybeSingle();

    if (!data) return null;
    const expiresAt = Date.parse(data.expires_at as string);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    MEMORY.set(key, { value: data.payload, expiresAt });
    return data.payload as T;
  } catch {
    // Hors contexte de requête (script, tâche de fond) ou base indisponible.
    return null;
  }
}

export async function writeCache(key: string, value: unknown, ttlMs = THIRTY_DAYS_MS): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  MEMORY.set(key, { value, expiresAt });

  try {
    const supabase = client();
    await supabase
      .from("enrichment_cache")
      .upsert(
        { key, payload: value as never, expires_at: new Date(expiresAt).toISOString() },
        { onConflict: "key" },
      );
  } catch {
    // Le cache mémoire tient pour la durée du processus : c'est suffisant.
  }
}

/** Lecture avec calcul à la demande. `null` n'est pas mis en cache. */
export async function cached<T>(
  key: string,
  compute: () => Promise<T | null>,
  ttlMs = THIRTY_DAYS_MS,
): Promise<T | null> {
  const hit = await readCache<T>(key);
  if (hit !== null) return hit;

  const value = await compute();
  if (value !== null) await writeCache(key, value, ttlMs);
  return value;
}

import { readCache, writeCache } from "@/lib/enrichment/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { HunterGateStore } from "./gate";

/**
 * Accès réels du garde-fou Hunter (lib/hunter/gate.ts). SERVEUR UNIQUEMENT.
 *
 *  - cache : `enrichment_cache`, déjà mutualisé et purgé à l'échéance — clés
 *    `hunter:…`, aucune table de plus ;
 *  - compteur du jour : les recherches FACTURÉES dans `api_usage` (unités > 0),
 *    celles que les clients Hunter y écrivent déjà.
 */
export function supabaseHunterStore(): HunterGateStore {
  return {
    read: (key) => readCache(key),
    write: (key, value, ttlMs) => writeCache(key, value, ttlMs),
    async usedSince(since) {
      const db = process.env.ORION_SCRIPT_USER_ID ? createAdminClient() : createClient();
      const { data, error } = await db
        .from("api_usage")
        .select("units")
        .eq("service", "hunter")
        .gte("created_at", since.toISOString());
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((total, row) => total + (Number(row.units) || 0), 0);
    },
  };
}

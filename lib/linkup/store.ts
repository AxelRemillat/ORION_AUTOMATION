import { readCache, writeCache } from "@/lib/enrichment/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LINKUP_CACHE_TTL_MS, type LinkupGateStore } from "./gate";

/**
 * Accès réels du garde-fou Linkup (lib/linkup/gate.ts). SERVEUR UNIQUEMENT.
 * Même schéma que Hunter : cache dans `enrichment_cache` (clés `linkup:…`),
 * compteur du jour sur les recherches journalisées dans `api_usage`.
 */
export function supabaseLinkupStore(): LinkupGateStore {
  return {
    read: (key) => readCache(key),
    write: (key, value) => writeCache(key, value, LINKUP_CACHE_TTL_MS),
    async usedSince(since) {
      const db = process.env.ORION_SCRIPT_USER_ID ? createAdminClient() : createClient();
      const { data, error } = await db
        .from("api_usage")
        .select("units")
        .eq("service", "linkup")
        .gte("created_at", since.toISOString());
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((total, row) => total + (Number(row.units) || 0), 0);
    },
  };
}

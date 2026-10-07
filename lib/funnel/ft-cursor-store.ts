import { createAdminClient } from "@/lib/supabase/server";
import type { FtCursorState } from "@/lib/signals/france-travail";

/**
 * Curseur France Travail persistant (Cowork #40), dans le cache mutualisé
 * `enrichment_cache` (clé `orion:ft-cursor`) : aucune table de plus. SERVEUR.
 */
export const FT_CURSOR_KEY = "orion:ft-cursor";

export function ftCursorStore() {
  return {
    async read(): Promise<FtCursorState | null> {
      const { data } = await createAdminClient().from("enrichment_cache").select("payload").eq("key", FT_CURSOR_KEY).maybeSingle();
      return ((data as { payload?: FtCursorState } | null)?.payload ?? null) as FtCursorState | null;
    },
    async write(cursor: FtCursorState): Promise<void> {
      await createAdminClient()
        .from("enrichment_cache")
        .upsert({ key: FT_CURSOR_KEY, payload: cursor as never, expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString() }, { onConflict: "key" });
    },
  };
}

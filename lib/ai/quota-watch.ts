import { appUrl, pushNtfy, type Notification } from "@/lib/notify/ntfy";
import { createAdminClient } from "@/lib/supabase/server";
import { registerOpenAiHealth, type OpenAIQuotaError } from "./quota";

/**
 * ÉTAT DU CRÉDIT OPENAI, partagé entre les instances (SERVEUR SEULEMENT).
 *
 * Gardé dans `enrichment_cache` (clé `orion:openai-quota`, aucune table de
 * plus), lu par les bandeaux du Cockpit et des Réglages :
 *   - quota → `failing: true`, notification ntfy « crédit OpenAI épuisé » au
 *     plus une fois toutes les 3 h ;
 *   - premier appel réussi ensuite → `failing: false`, notification « rétabli ».
 */

export const QUOTA_STATE_KEY = "orion:openai-quota";
export const QUOTA_NOTIFY_EVERY_MS = 3 * 3_600_000;
/** Une instance qui a vu un succès ne relit l'état qu'au plus toutes les 10 min. */
const RECHECK_MS = 10 * 60_000;

export interface OpenAiQuotaState {
  failing: boolean;
  since: string | null;
  last_error: string | null;
  notified_at: string | null;
  recovered_at: string | null;
}

export const EXHAUSTED_NOTIFICATION = (click: string | null): Notification => ({
  title: "ORION : crédit OpenAI épuisé — rédaction et analyse Codeur en pause",
  body: "Recharge le compte OpenAI : la préparation, la rédaction des mails et l'analyse des offres reprendront d'elles-mêmes.",
  priority: "high",
  tags: ["warning"],
  click,
});

export const RESTORED_NOTIFICATION = (click: string | null): Notification => ({
  title: "ORION : crédit OpenAI rétabli",
  body: "La rédaction et l'analyse des offres Codeur reprennent.",
  priority: "default",
  tags: ["white_check_mark"],
  click,
});

export interface QuotaWatchDeps {
  read(): Promise<OpenAiQuotaState | null>;
  write(state: OpenAiQuotaState): Promise<void>;
  push(notification: Notification): Promise<unknown>;
  now?: () => Date;
  baseUrl?: string;
}

/** Les deux réactions du garde-fou, injectables (tests). */
export function createQuotaWatch(deps: QuotaWatchDeps) {
  const now = () => (deps.now ?? (() => new Date()))();
  let healthyAt = 0;
  const base = deps.baseUrl ?? null;
  return {
    async onQuota(error: OpenAIQuotaError) {
      healthyAt = 0;
      const previous = await deps.read();
      const at = now();
      const notify = !previous?.notified_at || at.getTime() - Date.parse(previous.notified_at) >= QUOTA_NOTIFY_EVERY_MS;
      await deps.write({
        failing: true,
        since: previous?.failing && previous.since ? previous.since : at.toISOString(),
        last_error: error.message.slice(0, 300),
        notified_at: notify ? at.toISOString() : previous?.notified_at ?? null,
        recovered_at: previous?.recovered_at ?? null,
      });
      if (notify) await deps.push(EXHAUSTED_NOTIFICATION(base ? `${base}/reglages/couts` : null));
    },
    async onSuccess() {
      const at = now().getTime();
      if (healthyAt && at - healthyAt < RECHECK_MS) return;
      healthyAt = at;
      const previous = await deps.read();
      if (!previous?.failing) return;
      await deps.write({ ...previous, failing: false, recovered_at: new Date(at).toISOString() });
      await deps.push(RESTORED_NOTIFICATION(base ? `${base}/cockpit` : null));
    },
  };
}

/** Lecture de l'état (bandeaux). Jamais d'exception : `null` si illisible. */
export async function readOpenAiQuotaState(): Promise<OpenAiQuotaState | null> {
  try {
    const { data } = await createAdminClient().from("enrichment_cache").select("payload").eq("key", QUOTA_STATE_KEY).maybeSingle();
    return ((data as { payload?: OpenAiQuotaState } | null)?.payload ?? null) as OpenAiQuotaState | null;
  } catch {
    return null;
  }
}

async function writeState(state: OpenAiQuotaState): Promise<void> {
  try {
    await createAdminClient()
      .from("enrichment_cache")
      .upsert({ key: QUOTA_STATE_KEY, payload: state as never, expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString() }, { onConflict: "key" });
  } catch {
    // La surveillance ne fait jamais échouer l'appel observé.
  }
}

let registered = false;

/** Branche la surveillance réelle (idempotent). Appelé par lib/openai.ts. */
export function watchOpenAiQuota(): void {
  if (registered) return;
  registered = true;
  registerOpenAiHealth(createQuotaWatch({ read: readOpenAiQuotaState, write: writeState, push: (notification) => pushNtfy(notification), baseUrl: appUrl() }));
}

import { recordUnitUsage } from "@/lib/usage/record";
import { CREDITS_PER_VERIFICATION, VERIFY_TTL_MS, type HunterVerifierStatus, type RecipientDeps } from "./recipient-check";

type Db = { from: (table: string) => any };

/**
 * Accès réels de la vérification avant envoi. Le cache passe par le client `db` de l'envoi
 * (il marche aussi dans le cron, sans cookies) ; sans HUNTER_API_KEY, aucun appel : les
 * tests et les environnements sans clé ne dépensent jamais de crédit.
 */
export function realRecipientDeps(db: Db, now = new Date(), env: Record<string, string | undefined> = process.env): RecipientDeps {
  const key = env.HUNTER_API_KEY?.trim();
  return {
    now,
    async read(cacheKey) {
      const { data } = await db.from("enrichment_cache").select("payload, expires_at").eq("key", cacheKey).maybeSingle();
      const row = data as { payload: { status?: HunterVerifierStatus } | null; expires_at: string } | null;
      return row && Date.parse(row.expires_at) > now.getTime() && row.payload?.status ? { status: row.payload.status } : null;
    },
    async write(cacheKey, value) {
      await db.from("enrichment_cache").upsert({ key: cacheKey, payload: value, expires_at: new Date(now.getTime() + VERIFY_TTL_MS).toISOString() }, { onConflict: "key" });
    },
    verify: key
      ? async (email) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15_000);
          try {
            const response = await fetch(`https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email, api_key: key })}`, { signal: controller.signal, cache: "no-store" });
            if (!response.ok) return { status: null, quotaExceeded: response.status === 429 };
            const body = (await response.json().catch(() => ({}))) as { data?: { status?: HunterVerifierStatus } };
            return { status: body.data?.status ?? null, quotaExceeded: false };
          } finally {
            clearTimeout(timer);
          }
        }
      : null,
    gate: {
      read: async () => null,
      write: async () => undefined,
      async usedSince(since) {
        const { data, error } = await db.from("api_usage").select("units").eq("service", "hunter").gte("created_at", since.toISOString());
        if (error) throw new Error(error.message);
        return ((data ?? []) as { units: number | null }[]).reduce((total, row) => total + (Number(row.units) || 0), 0);
      },
    },
    record: (status) => recordUnitUsage({ service: "hunter", operation: `envoi:email-verifier:${status}`, units: CREDITS_PER_VERIFICATION }),
  };
}

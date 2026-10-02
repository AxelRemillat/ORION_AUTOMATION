import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken } from "@/lib/signals/france-travail";
import { describeHttp, integrationStatuses, type IntegrationKey, type IntegrationStatus, type TestResult } from "./integrations";

/**
 * Côté serveur : dernier appel réussi par service, et tests GRATUITS. Les clés
 * ne quittent jamais ce module ; le client ne reçoit que des états et des dates.
 */

type Loose = SupabaseClient<any, "public", any>;

async function latest(db: Loose, table: string, column: string, filter?: (query: any) => any): Promise<string | null> {
  try {
    let query = db.from(table).select(column).not(column, "is", null);
    if (filter) query = filter(query);
    const { data } = await query.order(column, { ascending: false }).limit(1).maybeSingle();
    return ((data as Record<string, string> | null)?.[column] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function loadIntegrations(db: unknown, env: Record<string, string | undefined> = process.env): Promise<IntegrationStatus[]> {
  const loose = db as Loose;
  const usage = (service: string) => latest(loose, "api_usage", "created_at", (q) => q.eq("service", service));
  const [openai, hunter, pappers, linkup, inpi, franceTravail, bodacc, envoi, reception, supabase] = await Promise.all([
    usage("openai"),
    usage("hunter"),
    usage("pappers"),
    usage("linkup"),
    latest(loose, "free_api_calls", "created_at", (q) => q.eq("service", "inpi")),
    latest(loose, "signal_candidates", "created_at", (q) => q.eq("source", "france-travail")),
    latest(loose, "signal_candidates", "created_at", (q) => q.eq("source", "bodacc")),
    latest(loose, "messages", "sent_at", (q) => q.eq("status", "sent").not("gmail_message_id", "is", null)),
    latest(loose, "inbound_messages", "received_at"),
    // Supabase répond : c'est cette lecture même.
    loose
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .then(({ error }) => (error ? null : new Date().toISOString())),
  ]);
  const last: Partial<Record<IntegrationKey, string | null>> = {
    openai, hunter, pappers, linkup, inpi, france_travail: franceTravail, bodacc, n8n_envoi: envoi, n8n_reception: reception, supabase,
  };
  return integrationStatuses(env, last);
}

const TIMEOUT_MS = 8_000;

async function get(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

/** Un appel gratuit par service ; `null` si le service n'a pas de test sans coût. */
export async function testIntegration(
  key: IntegrationKey,
  options: { db?: unknown; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<TestResult | null> {
  const env = options.env ?? process.env;
  const f = options.fetchImpl ?? fetch;
  const enc = encodeURIComponent;
  try {
    switch (key) {
      case "openai":
        return describeHttp(await get("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` } }, f), "OpenAI");
      case "hunter":
        return describeHttp(await get(`https://api.hunter.io/v2/account?api_key=${enc(env.HUNTER_API_KEY ?? "")}`, {}, f), "Hunter");
      case "pappers":
        return describeHttp(await get(`https://api.pappers.fr/v2/suivi-jetons?api_token=${enc(env.PAPPERS_API_KEY ?? "")}`, {}, f), "Pappers");
      case "linkup":
        return describeHttp(await get("https://api.linkup.so/v1/credits/balance", { headers: { Authorization: `Bearer ${env.LINKUP_API_KEY ?? ""}` } }, f), "Linkup");
      case "inpi":
        return describeHttp(
          await get(
            "https://registre-national-entreprises.inpi.fr/api/sso/login",
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: env.INPI_USERNAME, password: env.INPI_PASSWORD }) },
            f,
          ),
          "INPI",
        );
      case "france_travail": {
        const token = await accessToken(env as never);
        return token.ok ? { ok: true, detail: "France Travail : jeton OAuth obtenu" } : { ok: false, detail: `France Travail : ${token.error}` };
      }
      case "bodacc":
        return describeHttp(
          await get("https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?limit=1", {}, f),
          "BODACC",
        );
      case "supabase": {
        const { error } = await (options.db as Loose).from("prospects").select("id", { count: "exact", head: true });
        return error ? { ok: false, detail: `Supabase : ${error.message}` } : { ok: true, detail: "Supabase : lecture OK" };
      }
      default:
        return null;
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, detail: aborted ? "délai dépassé (8 s)" : "service injoignable" };
  }
}

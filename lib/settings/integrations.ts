/**
 * Réglages › Intégrations — état de chaque service, sans jamais exposer de clé.
 *
 * L'état se déduit de deux choses :
 *   - la CONFIGURATION : les variables d'environnement requises sont-elles
 *     présentes ? (on ne lit que leur présence, jamais leur valeur) ;
 *   - le DERNIER APPEL RÉUSSI, lu dans les journaux déjà tenus (api_usage,
 *     free_api_calls, signaux de l'entonnoir, envois et réceptions).
 *
 * « Tester » ne fait qu'un appel GRATUIT (solde, liste de modèles, jeton OAuth,
 * une ligne d'open data). Les webhooks n8n n'ont pas de test : tout appel
 * enverrait ou recevrait un vrai mail.
 */

export const INTEGRATIONS = [
  { key: "openai", label: "OpenAI", env: ["OPENAI_API_KEY"], test: "GET /v1/models (gratuit)" },
  { key: "hunter", label: "Hunter", env: ["HUNTER_API_KEY"], test: "GET /v2/account (gratuit)" },
  { key: "pappers", label: "Pappers", env: ["PAPPERS_API_KEY"], test: "GET /v2/suivi-jetons (gratuit)" },
  { key: "linkup", label: "Linkup", env: ["LINKUP_API_KEY"], test: "GET /v1/credits/balance (gratuit)" },
  { key: "inpi", label: "INPI (RNE)", env: ["INPI_USERNAME", "INPI_PASSWORD"], test: "connexion SSO (gratuite)" },
  { key: "france_travail", label: "France Travail", env: ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"], test: "jeton OAuth (gratuit)" },
  { key: "bodacc", label: "BODACC", env: [], test: "1 annonce en open data (gratuit)" },
  { key: "n8n_envoi", label: "n8n — envoi", env: ["N8N_WEBHOOK_SEND_URL"], test: null },
  { key: "n8n_reception", label: "n8n — réception", env: ["INBOUND_WEBHOOK_SECRET"], test: null },
  { key: "resend", label: "Resend", env: ["RESEND_API_KEY"], test: null },
  { key: "supabase", label: "Supabase", env: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE"], test: "lecture d'un compteur (gratuite)" },
] as const;

export type IntegrationKey = (typeof INTEGRATIONS)[number]["key"];
export type IntegrationState = "connecté" | "clé manquante" | "non utilisé" | "jamais appelé";

export interface IntegrationStatus {
  key: IntegrationKey;
  label: string;
  state: IntegrationState;
  /** Variables manquantes (noms seulement). */
  missing: string[];
  /** Dernier appel réussi (ISO), si les journaux le disent. */
  lastSuccess: string | null;
  /** Ce que fait « Tester », ou `null` : pas d'appel gratuit, pas de bouton. */
  test: string | null;
}

/** Resend n'est appelé nulle part dans ORION : l'envoi passe par n8n + Gmail. */
const UNUSED: ReadonlySet<IntegrationKey> = new Set(["resend"]);

export function integrationStatuses(
  env: Record<string, string | undefined>,
  lastSuccess: Partial<Record<IntegrationKey, string | null>>,
): IntegrationStatus[] {
  return INTEGRATIONS.map((item) => {
    const missing = item.env.filter((name) => !env[name]?.trim());
    const last = lastSuccess[item.key] ?? null;
    const state: IntegrationState = UNUSED.has(item.key) && missing.length
      ? "non utilisé"
      : missing.length
        ? "clé manquante"
        : last
          ? "connecté"
          : "jamais appelé";
    return { key: item.key, label: item.label, state, missing, lastSuccess: last, test: missing.length ? null : item.test };
  });
}

export type TestResult = { ok: true; detail: string } | { ok: false; detail: string };

/** Réponse HTTP → résultat lisible, sans jamais recopier de corps (qui pourrait contenir un jeton). */
export function describeHttp(status: number, label: string): TestResult {
  if (status >= 200 && status < 300) return { ok: true, detail: `${label} : réponse ${status}` };
  if (status === 401 || status === 403) return { ok: false, detail: `${label} : accès refusé (${status}) — clé invalide ou révoquée` };
  if (status === 429) return { ok: false, detail: `${label} : quota atteint (429)` };
  return { ok: false, detail: `${label} : erreur ${status}` };
}

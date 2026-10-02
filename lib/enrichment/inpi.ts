/**
 * API RNE de l'INPI — repli GRATUIT pour l'opposition à la prospection quand
 * Pappers est épuisé (compte INPI gratuit : INPI_USERNAME / INPI_PASSWORD).
 *
 * Le champ : `diffusionCommerciale`, à la racine de la formalité (documentation
 * « Accéder aux formalités données saisies JSON », v4.0, juin 2025, annexe 1 :
 * « Non-opposition à la diffusion commerciale, bool »). Il vaut `false` quand
 * le déclarant s'oppose à la réutilisation de ses données à des fins de
 * prospection (art. R.123-320 du Code de commerce). C'est la source dont
 * Pappers tire `opposition_utilisation_commerciale`.
 *
 * À ne pas confondre avec `diffusionINSEE` (« N » = entreprise non diffusible),
 * qui ne dit rien de la prospection.
 */

const BASE_URL = "https://registre-national-entreprises.inpi.fr/api";
const TIMEOUT_MS = 15_000;
/** Le jeton n'a pas de durée documentée : on le renouvelle par prudence, et sur un 401. */
const TOKEN_TTL_MS = 30 * 60_000;

export type OppositionRead =
  | { ok: true; refuses: boolean }
  | { ok: false; error: string };

export function hasInpiCredentials(): boolean {
  return Boolean(process.env.INPI_USERNAME && process.env.INPI_PASSWORD);
}

/**
 * `diffusionCommerciale` d'une réponse `/api/companies/{siren}` : `true` si
 * l'entreprise S'OPPOSE, `false` sinon, `null` si le champ est absent ou
 * illisible — l'opposition n'est alors PAS vérifiée.
 */
export function readOpposition(payload: unknown): boolean | null {
  const root = (payload ?? {}) as Record<string, unknown>;
  const formality = (root.formality ?? {}) as Record<string, unknown>;
  const raw = formality.diffusionCommerciale ?? root.diffusionCommerciale;
  if (raw === true || raw === "true") return false;
  if (raw === false || raw === "false") return true;
  return null;
}

let token: { value: string; at: number } | null = null;

/** Oublie le jeton (tests, ou 401 en cours de route). */
export function resetInpiToken(): void {
  token = null;
}

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function login(fetchImpl: typeof fetch, now: number): Promise<string | { error: string }> {
  if (token && now - token.at < TOKEN_TTL_MS) return token.value;
  const response = await call(fetchImpl, `${BASE_URL}/sso/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: process.env.INPI_USERNAME, password: process.env.INPI_PASSWORD }),
  });
  if (!response.ok) return { error: `connexion INPI refusée (HTTP ${response.status})` };
  const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || !body.token) return { error: "connexion INPI sans jeton" };
  token = { value: body.token, at: now };
  return token.value;
}

/**
 * Lit l'opposition d'un SIREN au RNE. Ne lève jamais : un échec (identifiants
 * absents, quota du jour — HTTP 429 —, réseau) rend `ok: false` et la fiche
 * reste « opposition non vérifiée ».
 */
export async function fetchInpiOpposition(
  siren: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<OppositionRead> {
  const clean = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(clean)) return { ok: false, error: "SIREN invalide" };
  if (!hasInpiCredentials()) return { ok: false, error: "INPI_USERNAME / INPI_PASSWORD absents" };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bearer = await login(fetchImpl, now);
      if (typeof bearer !== "string") return { ok: false, error: bearer.error };
      const response = await call(fetchImpl, `${BASE_URL}/companies/${clean}`, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
      });
      // Jeton expiré : une seule reconnexion.
      if (response.status === 401 && attempt === 0) {
        resetInpiToken();
        continue;
      }
      if (response.status === 429) return { ok: false, error: "quota INPI du jour atteint" };
      if (!response.ok) return { ok: false, error: `INPI HTTP ${response.status}` };
      const refuses = readOpposition(await response.json().catch(() => null));
      return refuses === null ? { ok: false, error: "champ diffusionCommerciale absent" } : { ok: true, refuses };
    }
    return { ok: false, error: "INPI : jeton refusé" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, error: "INPI : délai dépassé" };
    return { ok: false, error: error instanceof Error ? `INPI : ${error.message}` : "INPI injoignable" };
  }
}

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Authentification des points d'entrée n8n des Opportunités (/ingest,
 * /ingest-email) : en-tête `x-ingest-secret` égal à
 * `OPPORTUNITIES_INGEST_SECRET`, comparé à temps constant. Propriétaire des
 * lignes et URL publique d'ORION, communs aux deux routes.
 */

/** Comparaison à temps constant, quelle que soit la longueur (empreintes de même taille). */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/** Secret valide dans l'en-tête de la requête (jamais journalisé). */
export function ingestAuthorized(request: Request, expected = process.env.OPPORTUNITIES_INGEST_SECRET): boolean {
  const secret = expected?.trim();
  const given = request.headers.get("x-ingest-secret")?.trim() ?? "";
  return Boolean(secret && given && sameSecret(given, secret));
}

type AdminDb = { auth: { admin: { listUsers: (options: { page: number; perPage: number }) => Promise<{ data: { users?: { id: string }[] } | null }> } } };

/** Propriétaire des opportunités : variable dédiée, sinon l'unique compte de l'app. */
export async function opportunitiesOwner(db: AdminDb): Promise<string | null> {
  const configured = process.env.OPPORTUNITIES_USER_ID?.trim();
  if (configured) return configured;
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 2 });
  const users = data?.users ?? [];
  return users.length === 1 ? users[0].id : null;
}

export function publicAppUrl(request: Request): string {
  const configured = process.env.ORION_PUBLIC_URL?.trim() || process.env.JOBS_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

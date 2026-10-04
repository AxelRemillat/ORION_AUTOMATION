import { resolveMx } from "node:dns/promises";

/**
 * Le domaine d'une adresse reçoit-il du courrier ? (enregistrement MX)
 *
 * Dernier filet avant de garder une adresse : une adresse générique lue sur un
 * site dont le domaine n'a pas de MX ne recevra jamais le mail. Gratuit (DNS).
 * Incertain (DNS muet, délai) : `null` — on ne rejette pas sur un doute.
 */
const CACHE = new Map<string, boolean | null>();

export async function hasMx(domain: string, timeoutMs = 4_000): Promise<boolean | null> {
  const key = domain.trim().toLowerCase();
  if (!key) return false;
  if (CACHE.has(key)) return CACHE.get(key) ?? null;
  const verdict = await Promise.race([
    resolveMx(key).then(
      (records) => records.some((record) => Boolean(record.exchange)),
      (error: NodeJS.ErrnoException) => (error.code === "ENOTFOUND" || error.code === "ENODATA" ? false : null),
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  CACHE.set(key, verdict);
  return verdict;
}

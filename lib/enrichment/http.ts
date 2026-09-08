/**
 * Enveloppe fetch commune aux clients d'enrichissement.
 * Aucun appel externe ne doit pouvoir faire tomber une route : tout est ramené
 * à un `Result` explicite (timeout, DNS, 4xx/5xx, JSON invalide).
 */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...init.headers },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `délai dépassé (${timeoutMs / 1000}s)` };
    }
    return { ok: false, error: error instanceof Error ? error.message : "erreur inconnue" };
  } finally {
    clearTimeout(timer);
  }
}

/** Exécute des tâches par vagues pour ne pas saturer les APIs tierces. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Extrait un domaine exploitable (sans www) d'une URL ou d'une saisie libre. */
export function toDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

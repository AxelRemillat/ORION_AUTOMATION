/**
 * Limiteur de débit et reprise sur 429.
 *
 * L'incident : « GOUV — page 463/41/57 illisible : HTTP 429 Too Many
 * Requests ». Le scan élargi lit désormais jusqu'à 60 pages d'annuaire et
 * interrogeait l'API aussi vite que le réseau le permettait. Une page perdue
 * était signalée comme « illisible » — un message qui laisse croire à une
 * donnée manquante alors que c'est nous qui tapions trop fort.
 *
 * La limite officielle de `recherche-entreprises.api.gouv.fr` est de
 * **7 appels par seconde** (annoncée sur la page d'accueil de l'API). On se
 * place volontairement en dessous : le débit n'est pas ce qui coûte cher ici,
 * un scan de 60 pages tient largement dans le temps d'une requête.
 */

/** Débit visé, sous la limite officielle de 7/s. */
export const ANNUAIRE_RATE_PER_SECOND = 5;

/** Appels simultanés vers une même API pendant le scan. */
export const ANNUAIRE_CONCURRENCY = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espacement minimal entre deux départs, par clé d'API.
 *
 * Volontairement simple : une file qui décale chaque départ d'au moins
 * `1000 / débit` millisecondes. Pas de seau à jetons — il autoriserait une
 * rafale au démarrage, exactement ce qui déclenche le 429.
 */
class Spacer {
  private next = 0;
  constructor(private readonly minGapMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.next);
    this.next = start + this.minGapMs;
    if (start > now) await sleep(start - now);
  }
}

const spacers = new Map<string, Spacer>();

export function spacerFor(key: string, ratePerSecond: number): Spacer {
  const existing = spacers.get(key);
  if (existing) return existing;
  const created = new Spacer(Math.ceil(1000 / Math.max(1, ratePerSecond)));
  spacers.set(key, created);
  return created;
}

/** Remet les compteurs à zéro (tests). */
export function resetRateLimiters(): void {
  spacers.clear();
}

/**
 * Délai avant la prochaine tentative.
 *
 * `Retry-After` fait autorité quand le serveur le fournit — il sait mieux que
 * nous. Sinon, exponentiel avec un bruit aléatoire : sans ce bruit, plusieurs
 * requêtes reparties en même temps se retrouveraient à nouveau en collision.
 */
export function backoffDelayMs(attempt: number, retryAfter?: string | null, random = Math.random): number {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(30_000, header * 1000);

  const base = Math.min(8_000, 500 * 2 ** attempt);
  return Math.round(base * (0.7 + random() * 0.6));
}

export interface LimitedFetchOptions {
  /** Clé de débit : une par API tierce. */
  key: string;
  ratePerSecond?: number;
  /** Tentatives au TOTAL, reprises comprises. */
  attempts?: number;
  init?: RequestInit;
  timeoutMs?: number;
  /** Injecté par les tests. */
  fetchImpl?: typeof fetch;
  onRetry?: (message: string) => void;
}

export interface LimitedResult {
  response: Response | null;
  /** Renseigné quand toutes les tentatives ont échoué. */
  error?: string;
  attempts: number;
}

/**
 * `fetch` sous limite de débit, avec reprise sur 429 et 5xx.
 *
 * Rend un `Response` ou une erreur EXPLICITE : plus de « page illisible » qui
 * masque un throttling. L'appelant peut dire à l'utilisateur ce qui s'est
 * réellement passé.
 */
export async function limitedFetch(url: string, options: LimitedFetchOptions): Promise<LimitedResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, options.attempts ?? 3);
  const spacer = spacerFor(options.key, options.ratePerSecond ?? ANNUAIRE_RATE_PER_SECOND);
  let lastError = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await spacer.wait();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      const response = await doFetch(url, {
        ...options.init,
        signal: controller.signal,
        cache: "no-store",
      });

      // 429 et 5xx sont temporaires : on attend et on recommence.
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        if (attempt < attempts - 1) {
          const delay = backoffDelayMs(attempt, response.headers.get("retry-after"));
          options.onRetry?.(
            `[rate-limit] ${options.key} ${response.status} — nouvelle tentative dans ${delay} ms ` +
              `(${attempt + 2}/${attempts})`,
          );
          await sleep(delay);
          continue;
        }
        return { response, error: `${lastError} après ${attempts} tentatives`, attempts: attempt + 1 };
      }

      return { response, attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "erreur réseau";
      if (attempt < attempts - 1) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      return { response: null, error: lastError, attempts: attempt + 1 };
    } finally {
      clearTimeout(timer);
    }
  }

  return { response: null, error: lastError || "échec inconnu", attempts };
}

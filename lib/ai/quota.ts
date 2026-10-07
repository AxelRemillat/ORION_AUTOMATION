import { readOpenAiError } from "./params";

/**
 * CRÉDIT OPENAI ÉPUISÉ — garde-fou du point d'appel commun (Cowork #35,
 * 07/10/2026). Le compte était à 0 et le blocage est resté invisible : chaque
 * appel échouait en 429, avalé par des `catch` qui en faisaient un « tri
 * indisponible » ou un « profil inexploitable ».
 *
 *   - quota / facturation (429 insufficient_quota, « no credits remaining »,
 *     401/403 de facturation) → `OpenAIQuotaError`, JAMAIS réessayé ;
 *   - simple limite de débit (429 « rate limit ») → réessayé avec attente ;
 *   - le reste → inchangé.
 *
 * Module PUR (aucune base, aucun réseau) : l'état persistant et la
 * notification vivent dans lib/ai/quota-watch.ts (serveur), branché par
 * `registerOpenAiHealth`.
 */

export class OpenAIQuotaError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenAIQuotaError";
    this.status = status;
  }
}

/** Vrai pour une `OpenAIQuotaError`, y compris rejetée à travers une frontière de module. */
export function isOpenAIQuotaError(error: unknown): error is OpenAIQuotaError {
  return error instanceof OpenAIQuotaError || (error as { name?: string } | null)?.name === "OpenAIQuotaError";
}

export type OpenAiFailure = "quota" | "rate_limit" | "other";

const QUOTA_TEXT = /insufficient[_ ]quota|no credits remaining|exceeded your current quota|billing|credit balance|payment|plan and billing|quota/i;

export function classifyOpenAiError(error: unknown): OpenAiFailure {
  const info = readOpenAiError(error);
  const text = `${info.code ?? ""} ${info.message ?? ""}`;
  if (info.status === 429) return info.code === "insufficient_quota" || QUOTA_TEXT.test(text) ? "quota" : "rate_limit";
  if ((info.status === 401 || info.status === 403 || info.status === 402) && QUOTA_TEXT.test(text)) return "quota";
  if (info.code === "insufficient_quota") return "quota";
  return "other";
}

export const QUOTA_MESSAGE = "Crédit OpenAI épuisé : rédaction et analyse en pause jusqu'à la recharge du compte.";

// --- Santé du compte, partagée dans le processus -----------------------------

let lastQuotaAt = 0;

/** Une erreur de quota a-t-elle eu lieu depuis `since` (ms) dans ce processus ? */
export function quotaHitSince(since: number): boolean {
  return lastQuotaAt >= since;
}

export interface OpenAiHealthHooks {
  onQuota?(error: OpenAIQuotaError): void | Promise<void>;
  onSuccess?(): void | Promise<void>;
}

let hooks: OpenAiHealthHooks = {};

/** Branché par lib/ai/quota-watch.ts (état en base + notification). */
export function registerOpenAiHealth(next: OpenAiHealthHooks): void {
  hooks = next;
}

/** Réinitialisation — tests uniquement. */
export function resetOpenAiHealth(): void {
  hooks = {};
  lastQuotaAt = 0;
}

async function safe(run: (() => void | Promise<void>) | undefined) {
  try {
    await run?.();
  } catch {
    // La surveillance ne fait jamais échouer l'appel qu'elle observe.
  }
}

export interface GuardOptions {
  /** Attentes entre deux essais sur limite de débit (ms). */
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BACKOFF = [2_000, 6_000, 15_000];

/**
 * Un appel OpenAI sous garde-fou : quota → `OpenAIQuotaError` (et signal) ;
 * limite de débit → nouvel essai après attente ; succès → signal « rétabli ».
 */
export async function guardOpenAi<T>(send: () => Promise<T>, options: GuardOptions = {}): Promise<T> {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await send();
      await safe(hooks.onSuccess);
      return result;
    } catch (error) {
      const kind = classifyOpenAiError(error);
      if (kind === "quota") {
        const info = readOpenAiError(error);
        const quota = new OpenAIQuotaError(`${QUOTA_MESSAGE} (${info.status ?? "?"} ${info.code ?? info.message})`, info.status);
        lastQuotaAt = Date.now();
        await safe(() => hooks.onQuota?.(quota));
        throw quota;
      }
      if (kind === "rate_limit" && attempt < backoff.length) {
        await sleep(backoff[attempt]);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Chaîne de ticks : chaque étape terminée déclenche la suivante.
 *
 * Une fonction Vercel s'arrête dès que sa réponse est partie. `waitUntil`
 * prolonge sa vie jusqu'à la fin d'une promesse (dans la limite de
 * maxDuration). Next 14 n'expose pas encore `after()` : on lit directement le
 * contexte de requête que Vercel pose sur `globalThis` — c'est exactement ce
 * que fait `@vercel/functions`, sans ajouter de dépendance. Hors Vercel
 * (`next dev`, `next start`), le processus reste vivant : la promesse court
 * simplement toute seule.
 */

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

interface VercelContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function waitUntil(promise: Promise<unknown>): void {
  const safe = promise.catch((error) => console.error("[jobs] tâche de fond :", error));
  const holder = (globalThis as unknown as Record<symbol, { get?: () => VercelContext } | undefined>)[
    REQUEST_CONTEXT
  ];
  const context = holder?.get?.();
  if (context?.waitUntil) context.waitUntil(safe);
}

export interface TickBody {
  jobId?: string;
  /** Réveil par pg_cron : relance jusqu'à N ticks en parallèle. */
  fanout?: number;
}

/** URL de base de l'app : réglable, sinon celle de la requête en cours. */
export function baseUrl(request: Request): string {
  const configured = process.env.JOBS_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

/**
 * Appelle /api/jobs/tick. Le tick répond tout de suite (202) et travaille en
 * `waitUntil` : on n'attend donc que l'accusé de réception, jamais l'étape.
 */
export async function dispatchTick(base: string, body: TickBody = {}): Promise<void> {
  const secret = process.env.JOBS_TICK_SECRET;
  if (!secret) {
    console.warn("[jobs] JOBS_TICK_SECRET absent : la chaîne de ticks est coupée.");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(`${base}/api/jobs/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    // Un tick perdu n'est pas grave : le filet pg_cron repasse dans la minute.
    console.warn("[jobs] tick non déclenché :", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
  }
}

/** Déclenche un tick sans retarder la réponse en cours. */
export function kickTick(base: string, body: TickBody = {}): void {
  waitUntil(dispatchTick(base, body));
}

/** Borne le fanout : jamais plus de ticks que de jobs simultanés possibles, x2. */
export function clampFanout(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return 0;
  return Math.min(parsed, 6);
}

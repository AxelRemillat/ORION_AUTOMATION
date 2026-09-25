/**
 * Règles de rétention de la corbeille. Module pur : importable côté client
 * (compte à rebours de /corbeille) comme côté serveur (purge).
 */

export const TRASH_RETENTION_DAYS = 14;

const DAY_MS = 86_400_000;

/** Date à laquelle un prospect mis à la corbeille sera purgé. */
export function purgeAt(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS);
}

/** Jours restants avant la purge, arrondis au jour supérieur, jamais négatifs. */
export function daysBeforePurge(deletedAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((purgeAt(deletedAt).getTime() - now.getTime()) / DAY_MS));
}

/** Tout prospect mis à la corbeille AVANT cette date est à purger. */
export function purgeCutoff(now = new Date()): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}

export const isTrashed = (prospect: { deleted_at?: string | null }): boolean =>
  Boolean(prospect.deleted_at);

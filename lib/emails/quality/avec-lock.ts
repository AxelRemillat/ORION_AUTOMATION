/**
 * QUOTA « AVEC » ATOMIQUE (Cowork #31).
 *
 * Jusqu'à trois jobs de rédaction tournent en parallèle par utilisateur :
 * chacun comptait les ouvertures du jour AVANT que l'autre n'enregistre son
 * brouillon, et deux mails pouvaient s'ouvrir sur « Avec » là où le quota
 * n'en permettait qu'un.
 *
 * Verrou en base, NON bloquant (`try_generation_lock`, une ligne par
 * utilisateur) : le job qui le tient compte les ouvertures et peut ouvrir sur
 * « Avec » ; il le relâche une fois son brouillon enregistré. Un job qui ne
 * l'obtient pas rédige SANS « Avec ». Le quota ne peut donc jamais être
 * dépassé ; au pire, une ouverture « Avec » permise n'est pas utilisée.
 */

export const AVEC_LOCK_NAME = "mail-avec";
/** Durée de vie du verrou : une rédaction (2 réécritures, double juge) tient largement dedans. */
export const AVEC_LOCK_SECONDS = 300;

/** Le strict nécessaire du client Supabase : un appel RPC. */
export interface LockDb {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type AvecLock = { held: true; release: () => Promise<void> } | { held: false; reason: "occupé" | "indisponible" };

export async function acquireAvecLock(db: LockDb, userId: string, holder: string): Promise<AvecLock> {
  const { data, error } = await db.rpc("try_generation_lock", { p_user: userId, p_name: AVEC_LOCK_NAME, p_holder: holder, p_seconds: AVEC_LOCK_SECONDS });
  // Fonction absente (migration pas encore appliquée) : on ne bloque pas la
  // rédaction, on rédige sans « Avec » — c'est le choix sûr.
  if (error) return { held: false, reason: "indisponible" };
  if (data !== true) return { held: false, reason: "occupé" };
  return {
    held: true,
    release: async () => {
      await db.rpc("release_generation_lock", { p_user: userId, p_name: AVEC_LOCK_NAME, p_holder: holder });
    },
  };
}

/** Ouvertures du jour vues par un job SANS le verrou : « Avec » fermé (sur la journée et dans chaque famille). */
export function closeAvec<T extends { total: number; avec: number; byFamily?: Record<string, { total: number; avec: number }> }>(day: T): T {
  const shut = (value: { total: number; avec: number }) => ({ total: value.total, avec: value.total + 1 });
  return {
    ...day,
    ...shut(day),
    ...(day.byFamily ? { byFamily: Object.fromEntries(Object.entries(day.byFamily).map(([family, value]) => [family, shut(value)])) } : {}),
  };
}

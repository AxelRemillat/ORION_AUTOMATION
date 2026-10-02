/**
 * Lecture COMPLÈTE d'une requête Supabase, page par page.
 *
 * PostgREST plafonne chaque réponse à 1 000 lignes, quel que soit `.limit()` :
 * au-delà, les lignes manquent EN SILENCE. QA du 03/10/2026 : `api_usage`
 * comptait 2 792 lignes sur 30 jours, le Cockpit n'en agrégeait que les 1 000
 * plus anciennes (dépense d'octobre affichée « 0 € »). Toute agrégation passe
 * donc par ici, avec un ORDRE STABLE pour que les pages ne se chevauchent pas.
 */

export const PAGE_SIZE = 1000;

/** `build()` doit rendre une requête neuve, déjà triée, à laquelle on ajoute `.range()`. */
export async function readAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const maxRows = options.maxRows ?? 200_000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

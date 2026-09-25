import type { Db } from "./scope";

/** Fenêtre pendant laquelle une entreprise déjà scannée n'est pas repassée. */
export const SCAN_MEMORY_DAYS = 30;

/**
 * SIREN que la recherche ne doit pas (re)proposer.
 *
 * Quatre sources : le portefeuille (corbeille COMPRISE — un prospect à la
 * corbeille se restaure, il ne se rescanne pas), les favoris, la mémoire de
 * scan des 30 derniers jours, et les SIREN exclus après une suppression
 * définitive (`excluded_companies`).
 */
export async function knownSirens(db: Db, now = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - SCAN_MEMORY_DAYS * 86_400_000).toISOString();

  const [prospects, favorites, scans, excluded] = await Promise.all([
    db.from("prospects").select("siren"),
    db.from("favorites").select("siren"),
    db.from("scan_history").select("siren").gte("scanned_at", since),
    db.from("excluded_companies").select("siren"),
  ]);

  const known = new Set<string>();
  for (const rows of [prospects.data, favorites.data, scans.data, excluded.data]) {
    for (const row of rows ?? []) {
      const siren = (row as { siren: string | null }).siren;
      if (siren) known.add(siren);
    }
  }
  return known;
}

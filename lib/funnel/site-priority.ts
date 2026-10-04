import type { SupabaseClient } from "@supabase/supabase-js";
import { siteIdentity, type FreeSite } from "@/lib/contact-finder/free-site";
import type { Database, SignalCandidateRow } from "@/types";
import { baseOf, candidatesOf, pendingDigOf, updateCandidate } from "./store";
import type { Triage } from "./types";
import { digOrder } from "./dig";

/**
 * « SITE TROUVÉ » AVANT LES APPELS PAYANTS (décision Cowork, itération 2).
 *
 * Une fiche sans site ne peut pas recevoir de mail (aucun fait propre) : la
 * creuser (Pappers, recherche de contact, Hunter) dépense des crédits pour rien.
 * Étape GRATUITE entre le tri et le creusage : chaque retenu reçoit, s'il n'en a
 * pas, une recherche de site gratuite (lib/contact-finder/free-site.ts). Le
 * creusage passe ensuite les fiches AVEC site devant, puis celles pas encore
 * vérifiées, puis celles sans site. Le plafond et les budgets ne changent pas :
 * seul l'ORDRE change.
 */

type Db = SupabaseClient<Database>;
type SiteFree = { website: string | null; checked_at: string };

export type SiteState = "trouvé" | "à chercher" | "aucun";
const RANK: Record<SiteState, number> = { trouvé: 0, "à chercher": 1, aucun: 2 };

const siteFreeOf = (row: SignalCandidateRow) => ((row.contact as { site_free?: SiteFree } | null)?.site_free ?? null);

/** Le site connu d'un candidat : annuaire ou recherche gratuite. */
export function siteOf(row: SignalCandidateRow): string | null {
  return baseOf(row)?.website ?? siteFreeOf(row)?.website ?? null;
}

export function siteState(row: SignalCandidateRow): SiteState {
  if (siteOf(row)) return "trouvé";
  return siteFreeOf(row)?.checked_at ? "aucun" : "à chercher";
}

/** Tri STABLE par état du site : l'ordre de score est gardé à état égal. */
export function bySite<T extends { row: SignalCandidateRow }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[siteState(a.item.row)] - RANK[siteState(b.item.row)] || a.index - b.index)
    .map(({ item }) => item);
}

export async function runSiteStage(
  db: Db,
  userId: string,
  runId: string,
  options: {
    /** Résolution du site d'UN retenu (le candidat est fourni : offre, score de tri). */
    findSite: (identity: ReturnType<typeof siteIdentity>, row: SignalCandidateRow) => Promise<FreeSite | null>;
    deadline: number;
    limit?: number;
    now?: Date;
  },
) {
  const current = await candidatesOf(db, userId, runId);
  const earlier = await pendingDigOf(db, userId).catch(() => [] as SignalCandidateRow[]);
  const pool = [...current, ...earlier.filter((row) => row.run_id !== runId)].filter(
    (row) => row.statut === "retenu" && row.triage && baseOf(row) && siteState(row) === "à chercher",
  );
  const ordered = digOrder(pool.map((row) => ({ row, triage: row.triage as unknown as Triage, weight: row.weight ?? 0 }))).map(({ row }) => row);
  let checked = 0;
  let found = 0;
  for (const row of ordered) {
    if (Date.now() > options.deadline || checked >= (options.limit ?? 40)) break;
    const base = baseOf(row)!;
    const identity = siteIdentity({ id: row.id, name: base.company_name, siren: base.siren, city: base.city, postalCode: base.postal_code });
    const site = await options.findSite(identity, row).catch(() => null);
    checked += 1;
    if (site) found += 1;
    await updateCandidate(db, row.id, {
      contact: { ...((row.contact as Record<string, unknown> | null) ?? {}), site_free: { website: site?.website ?? null, checked_at: (options.now ?? new Date()).toISOString() } },
    });
  }
  return { checked, found, remaining: Math.max(0, ordered.length - checked) };
}

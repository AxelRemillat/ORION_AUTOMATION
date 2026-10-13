/**
 * REPRISE DES « SANS SITE » (Cowork #27) — gratuit en soi, aucune écriture hors signal.
 *
 * Une fiche retenue par le tri (score 4-5) dont l'étape « sites » n'a rien trouvé était
 * perdue (« Sans site : … », hors creusage) — souvent faute de budget Linkup le jour même,
 * l'enrichissement l'ayant consommé. On la remet « retenu », site « à chercher » : la
 * prochaine préparation la recherche de nouveau (Linkup désormais prioritaire pour les
 * sites), puis la creuse si un site est trouvé. Seuls `statut`, `motif_rejet` et
 * `contact` (site_free retiré, trace `reprise`) changent ; rien n'est supprimé, aucune règle de cible n'est assouplie
 * (opposés et hors cible ne sont jamais repris).
 *
 *   … reprise-sans-site.js --dry            (combien, lesquelles)
 *   … reprise-sans-site.js --limit 40       (remet en file au plus 40, les plus récentes d'abord)
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";

const dry = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Math.max(1, Number(process.argv[limitArg + 1]) || 40) : 40;
const DAYS = 14;
/**
 * Trace de la reprise, dans `contact.reprise` : le motif reste VIDE, car les étapes « sites »
 * et « creusage » ne reprennent un retenu d'un ancien run que sans motif (lib/funnel/store.ts).
 */
export const REPRISE_TRACE = "site à rechercher de nouveau (Cowork #27)";

type Row = { id: string; company_name: string | null; score: number | null; contact: Record<string, unknown> | null; prospect_id: string | null; created_at: string };

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const rows = await readAll<Row>(() =>
    table.from("signal_candidates").select("id, company_name, score, contact, prospect_id, created_at").eq("user_id", userId).eq("statut", "rejeté").like("motif_rejet", "Sans site%").gte("created_at", since).order("id"),
  );
  const eligible = rows.filter((row) => (row.score ?? 0) >= 4 && !row.prospect_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const chosen = eligible.slice(0, LIMIT);
  console.log(`${rows.length} « Sans site » sur ${DAYS} j · ${eligible.length} de score ≥ 4 · ${chosen.length} remise(s) en file${dry ? " (lecture seule)" : ""}`);
  console.log(chosen.slice(0, 12).map((row) => `  · ${row.company_name} (score ${row.score})`).join("\n"));
  if (dry) return process.exit(0);
  let done = 0;
  for (const row of chosen) {
    const contact = { ...(row.contact ?? {}) };
    delete contact.site_free;
    contact.reprise = REPRISE_TRACE;
    const { error } = await table.from("signal_candidates").update({ statut: "retenu", motif_rejet: null, contact }).eq("id", row.id).eq("statut", "rejeté");
    if (!error) done += 1;
  }
  console.log(`${done} fiche(s) remise(s) en file pour la prochaine préparation.`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

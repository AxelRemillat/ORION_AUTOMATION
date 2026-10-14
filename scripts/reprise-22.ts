/**
 * LES 22 FICHES DU LOT #27 (Cowork #28) — SIMULATION PAR DÉFAUT, écriture seulement avec
 * `--appliquer`, sur accord d'Axel.
 *
 * Le 13/10, 22 fiches ont été remises « retenu » avec un MOTIF de traçage (10 « Sans site »
 * repris, 12 offres de score 3). Or les étapes « sites » et « creusage » ne reprennent un
 * retenu d'un ancien run que sans motif (lib/funnel/store.ts, pendingDigOf) : elles sont
 * restées inertes. Cette commande vide UNIQUEMENT ce motif et range la trace dans
 * `contact.reprise` ; la prochaine préparation les reprend. Rien d'autre ne change, rien
 * n'est supprimé, aucune fiche hors de ces deux motifs n'est touchée.
 *
 *   … reprise-22.js               simulation : liste, avant → après
 *   … reprise-22.js --appliquer   écrit (accord d'Axel requis)
 *   … reprise-22.js --seulement-sans-site [--appliquer]   les 10 « Sans site » seulement (Cowork #30) ;
 *     les 12 offres de score 3 restent telles quelles (essai #28 : 0 creusée sur 12)
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";

/** Motif de traçage posé le 13/10 → trace rangée dans `contact.reprise`. */
export const TRACES: Record<string, string> = {
  "repris : site à rechercher de nouveau (Cowork #27)": "site à rechercher de nouveau (Cowork #27)",
  "essai score 3 (Cowork #27)": "essai score 3 (Cowork #27, lot du 13/10)",
};
const apply = process.argv.includes("--appliquer");
const onlyNoSite = process.argv.includes("--seulement-sans-site");
const NO_SITE_MOTIF = "repris : site à rechercher de nouveau (Cowork #27)";

type Row = { id: string; company_name: string | null; score: number | null; statut: string; motif_rejet: string; contact: Record<string, unknown> | null };

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const rows = await readAll<Row>(() =>
    table.from("signal_candidates").select("id, company_name, score, statut, motif_rejet, contact").eq("user_id", userId).eq("statut", "retenu").in("motif_rejet", onlyNoSite ? [NO_SITE_MOTIF] : Object.keys(TRACES)).order("id"),
  );
  console.log(`${rows.length} fiche(s) « retenu » portant un motif de traçage du 13/10${onlyNoSite ? " (« Sans site » seulement)" : ""}${apply ? "" : " — SIMULATION, rien n'est écrit"}\n`);
  for (const row of rows) {
    console.log(`· ${row.company_name} (score ${row.score})\n    avant : retenu · motif « ${row.motif_rejet} »\n    après : retenu · motif vide · contact.reprise « ${TRACES[row.motif_rejet]} »`);
  }
  if (!apply) return process.exit(0);
  let done = 0;
  for (const row of rows) {
    const contact = { ...(row.contact ?? {}), reprise: TRACES[row.motif_rejet] };
    // Garde : seulement si la fiche porte encore ce motif et ce statut.
    const { error } = await table.from("signal_candidates").update({ motif_rejet: null, contact }).eq("id", row.id).eq("statut", "retenu").eq("motif_rejet", row.motif_rejet);
    if (!error) done += 1;
  }
  console.log(`\n${done} fiche(s) remise(s) en file.`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

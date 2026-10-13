/**
 * ESSAI « SCORE DE TRI 3 » (Cowork #27) — mesure seulement, sur un petit échantillon.
 *
 * France Travail rejette ~50 offres par jour à 3/5 (seuil de rétention : 4). Avant de toucher
 * au seuil, on mesure : N offres récentes notées 3, trouvées au registre, ni opposées ni hors
 * cible (leur motif est uniquement « score 3/5 sous le seuil »), sont remises « retenu » avec un
 * motif d'essai ; la préparation de mesure (prepare:lot, plafonnée) les cherche, les creuse et
 * rédige. On compare ensuite leur taux de mails prêts à celui des retenus habituels.
 * Seuls `statut` et `motif_rejet` changent ; rien n'est supprimé.
 *
 *   … essai-score-3.js --dry | --limit 12 | --bilan
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";

export const ESSAI_MOTIF = "essai score 3 (Cowork #27)";
const dry = process.argv.includes("--dry");
const bilan = process.argv.includes("--bilan");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Math.max(1, Number(process.argv[limitArg + 1]) || 12) : 12;

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  if (bilan) {
    const rows = await readAll<{ id: string; company_name: string; statut: string; motif_rejet: string | null; prospect_id: string | null }>(() =>
      table.from("signal_candidates").select("id, company_name, statut, motif_rejet, prospect_id").eq("user_id", userId).or(`motif_rejet.eq.${ESSAI_MOTIF},motif_rejet.like.%${ESSAI_MOTIF}%`).order("id"),
    );
    const creuses = rows.filter((row) => row.prospect_id);
    const ids = creuses.map((row) => row.prospect_id as string);
    const drafts = ids.length ? ((await table.from("messages").select("prospect_id, quality_score, quality_reason").in("prospect_id", ids).eq("type", "intro").is("deleted_at", null)).data ?? []) : [];
    const ready = (drafts as { quality_score: number | null; quality_reason: string | null }[]).filter((draft) => (draft.quality_score ?? 0) >= 9 && !draft.quality_reason);
    console.log(`Essai score 3 : ${rows.length} remis en file · ${creuses.length} creusé(s) · ${drafts.length} brouillon(s) · ${ready.length} prêt(s) ≥ 9/10`);
    for (const row of rows) console.log(`  ${row.statut.padEnd(8)} ${row.company_name} ${row.motif_rejet && row.motif_rejet !== ESSAI_MOTIF ? `· ${row.motif_rejet.slice(0, 70)}` : ""}`);
    return process.exit(0);
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = await readAll<{ id: string; company_name: string; created_at: string }>(() =>
    table.from("signal_candidates").select("id, company_name, created_at").eq("user_id", userId).eq("source", "france-travail").eq("statut", "rejeté").eq("score", 3).like("motif_rejet", "score 3/5 sous le seuil%").not("identity", "is", null).is("prospect_id", null).gte("created_at", since).order("id"),
  );
  // Organismes publics et associatifs : hors de la cible PME, jamais dans l'essai.
  const PUBLIC = /(association|d[ée]partement|commune|mairie|ville de|r[ée]gion|emma[üu]s|syndicat|office|cpam|caf|centre hospitalier|ehpad|entraide|fondation)/i;
  const chosen = rows.filter((row) => !PUBLIC.test(row.company_name ?? "")).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LIMIT);
  console.log(`${rows.length} offre(s) France Travail notée(s) 3/5 sur 7 j · ${chosen.length} retenue(s) pour l'essai${dry ? " (lecture seule)" : ""}`);
  console.log(chosen.map((row) => `  · ${row.company_name}`).join("\n"));
  if (dry) return process.exit(0);
  let done = 0;
  for (const row of chosen) {
    const { error } = await table.from("signal_candidates").update({ statut: "retenu", motif_rejet: ESSAI_MOTIF }).eq("id", row.id).eq("statut", "rejeté");
    if (!error) done += 1;
  }
  console.log(`${done} offre(s) remise(s) en file.`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

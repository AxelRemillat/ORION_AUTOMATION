/**
 * REMISE EN « À VOIR » (plateformes #11, aucun appel au modèle) : les fiches Codeur
 * reçues par e-mail dont l'annonce se réduit au TITRE et qui ont été notées 0 à 5 sur
 * ce seul titre (rattrapage du 09/10) repassent « À voir » — champs d'état seulement
 * (status, analysis_state « titre_seul ») ; rien n'est supprimé, le score reste en base
 * mais n'est plus affiché ni utilisé pour le classement. Le pré-filtre sur le titre
 * (titleOnlyReason) garde à l'écart ce qui est clairement hors cible : statut inchangé.
 *
 *   npm run titre-seul:codeur -- --dry     (lecture seule)
 *   npm run titre-seul:codeur -- 5         (5 derniers jours, écrit en base)
 */
import { db, ownerId } from "./quality-live";
import { titleOnlyReason } from "@/lib/opportunities/prefilter";
import { TITLE_ONLY } from "@/lib/opportunities/title-only";

const dry = process.argv.includes("--dry");
const days = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 5);

type Row = { id: string; title: string; body: string; status: string; fit_score: number | null; analysis_state: string | null; filter_reason: string | null; budget: string | null };

async function main() {
  const userId = await ownerId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const table = db as never as { from: (t: string) => any };
  const { data, error } = await table
    .from("opportunities")
    .select("id, title, body, status, fit_score, analysis_state, filter_reason, budget")
    .eq("user_id", userId)
    .eq("platform", "codeur")
    .eq("source", "email")
    .eq("analysis_state", "ok")
    .lte("fit_score", 5)
    .gte("created_at", since);
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).filter((row) => row.body.trim() === row.title.trim() && !row.filter_reason);
  let moved = 0;
  let kept = 0;
  console.log(`${rows.length} fiche(s) Codeur à titre seul notées 0–5 depuis ${since}${dry ? " (lecture seule)" : ""}`);
  for (const row of rows) {
    const reason = titleOnlyReason(row.title, row.budget);
    if (reason) {
      kept += 1;
      console.log(`  écartée par le titre · ${row.title.slice(0, 60)} · ${reason}`);
      continue;
    }
    moved += 1;
    console.log(`  → À voir · ${row.title.slice(0, 60)} (ancienne note ${row.fit_score}/10, statut ${row.status})`);
    if (!dry) await table.from("opportunities").update({ status: "a_repondre", analysis_state: TITLE_ONLY }).eq("id", row.id);
  }
  console.log(`\nÀ voir : ${moved} · écartées par le titre : ${kept}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

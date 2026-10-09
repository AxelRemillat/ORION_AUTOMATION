/**
 * RATTRAPAGE (plateformes #10, PAYANT : ≈ 0,005 € par analyse, plafond 0,25 €)
 *
 * Le 08/10, les alertes Codeur « Nouveau projet » ont été écartées par le
 * pré-filtre à cause de l'URL du logo Codeur (« logo » → graphisme, design).
 * Pour les fiches Codeur reçues par e-mail ces N derniers jours et JAMAIS
 * analysées : texte nettoyé (sans liens ni pied de page), pré-filtre rejoué ;
 * si elles passent, analyse par le même code que l'ingestion, proposition si
 * score ≥ 7, alerte ntfy si verdict « alerte » (≥ 8). Rien n'est supprimé.
 *
 *   npm run rattrapage:codeur -- --dry      (lecture seule : ce qui serait fait)
 *   npm run rattrapage:codeur -- 3          (3 derniers jours, écrit en base)
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { codeurProjectAlert, codeurProjectDescription } from "@/lib/opportunities/email/ingest-email";
import { mainContent, withoutLinks } from "@/lib/opportunities/email/parse";
import { ALERT_SCORE, reanalyzeOpportunity, type IngestBody } from "@/lib/opportunities/ingest";
import { prefilterReason } from "@/lib/opportunities/prefilter";
import { pushNtfy } from "@/lib/notify/ntfy";

const BUDGET_EUR = 0.25;
const dry = process.argv.includes("--dry");
const days = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 3);

type Row = { id: string; title: string; body: string; budget: string | null; url: string | null; external_id: string; filter_reason: string | null; published_at: string | null; created_at: string };

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const table = db as never as { from: (t: string) => any };
  const { data, error } = await table
    .from("opportunities")
    .select("id, title, body, budget, url, external_id, filter_reason, published_at, created_at")
    .eq("user_id", userId)
    .eq("platform", "codeur")
    .eq("source", "email")
    .is("analyzed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const baseUrl = (process.env.ORION_PUBLIC_URL || "https://orion.axelremillat.com").replace(/\/$/, "");
  const deps = { db: table, userId, ask: liveAsk(null), baseUrl };
  let kept = 0;
  let analyzed = 0;
  let alerted = 0;
  const strong: string[] = [];
  console.log(`${rows.length} fiche(s) Codeur par e-mail jamais analysées depuis ${since}${dry ? " (lecture seule)" : ""}`);
  for (const row of rows) {
    const description = codeurProjectDescription(withoutLinks(mainContent(row.body)), row.title);
    const reason = prefilterReason({ title: row.title, description, categories: [], budgetText: row.budget });
    if (reason) {
      kept += 1;
      console.log(`  filtre confirmé · ${row.title.slice(0, 60)} · ${reason}`);
      if (!dry && reason !== row.filter_reason) await table.from("opportunities").update({ filter_reason: reason, body: description }).eq("id", row.id);
      continue;
    }
    if (dry) {
      console.log(`  à analyser · ${row.title.slice(0, 60)} (ancien motif : ${row.filter_reason ?? "—"})`);
      continue;
    }
    if ((await spentSince(userId, started)) > BUDGET_EUR) {
      console.log("Plafond de dépense atteint : arrêt.");
      break;
    }
    await table.from("opportunities").update({ body: description, filter_reason: null, status: "a_repondre", analysis_state: "pending", updated_at: new Date().toISOString() }).eq("id", row.id);
    const body: IngestBody = { platform: "codeur", external_id: row.external_id, url: row.url, title: row.title, description, description_truncated: true, budget_text: row.budget, categories: [], published_at: row.published_at ?? row.created_at, source: "email" };
    const analysis = await reanalyzeOpportunity(deps, row.id, body);
    analyzed += 1;
    const score = analysis?.score ?? null;
    console.log(`  analysée · ${row.title.slice(0, 60)} · ${score ?? "non analysée"}/10`);
    if (score !== null && score >= 7) strong.push(`${score}/10 · ${row.title} · ${baseUrl}/opportunites?id=${row.id}`);
    if (score !== null && score >= ALERT_SCORE) {
      const sent = await pushNtfy(codeurProjectAlert({ title: row.title, score, reasons: analysis?.reasons ?? [], budget: row.budget }, `${baseUrl}/opportunites?id=${row.id}`, "Rattrapage du 08/10 (écartée à tort par le filtre)."));
      if (sent) alerted += 1;
    }
  }
  console.log(`\nFiltre confirmé : ${kept} · analysées : ${analyzed} · alertes envoyées : ${alerted} · coût : ${(await spentSince(userId, started)).toFixed(4)} €`);
  console.log(strong.length ? `\nScore ≥ 7 :\n${strong.map((line) => `  - ${line}`).join("\n")}` : "\nAucune fiche à 7 ou plus.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

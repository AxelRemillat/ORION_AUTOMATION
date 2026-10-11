/**
 * PROPOSITIONS DES ALERTES « LANCEMENT » (Cowork #21) — PAYANT, plafond dur 0,27 € (≈ 0,30 $).
 *
 * Les missions de lancement Codeur de moins de 7 jours, à répondre, sans proposition :
 * rédaction par le MÊME code que le bouton (« Rédiger la proposition ») — sur le titre seul
 * pour une alerte e-mail, sinon analyse puis proposition de lancement. Rien n'est envoyé,
 * rien n'est marqué envoyé : la proposition attend qu'Axel la copie.
 *
 *   npm run propositions:lancement -- --dry   (lecture seule : la liste visée)
 *   npm run propositions:lancement
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { laneOf, LAUNCH_FRESH_DAYS } from "@/lib/opportunities/lane";
import { analyzeAndPropose } from "@/lib/opportunities/run";
import type { Opportunity } from "@/lib/opportunities/types";

const BUDGET_EUR = 0.27;
const dry = process.argv.includes("--dry");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const since = new Date(Date.now() - LAUNCH_FRESH_DAYS * 86_400_000).toISOString();
  const table = db as never as { from: (t: string) => any };
  const { data, error } = await table
    .from("opportunities")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "codeur")
    .eq("status", "a_repondre")
    .is("proposal", null)
    .is("filter_reason", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const targets = ((data ?? []) as Opportunity[]).filter((row) => laneOf(row) === "lancement");
  console.log(`${targets.length} alerte(s) Lancement sans proposition${dry ? " (lecture seule)" : ""} :`);
  let ok = 0;
  for (const row of targets) {
    if (dry) {
      console.log(`  · ${row.title} · ${row.budget ?? "budget non indiqué"}`);
      continue;
    }
    if ((await spentSince(userId, started)) > BUDGET_EUR) {
      console.log("Plafond de dépense atteint : arrêt.");
      break;
    }
    // prospectId null : une opportunité n'est pas un prospect (clé étrangère d'api_usage), sinon le coût n'est pas enregistré.
    const run = await analyzeAndPropose(table as never, userId, row.id, liveAsk(null));
    if (run.ok) ok += 1;
    console.log(`  ${run.ok ? "PRÊTE" : "ÉCHEC"} · ${row.title}${run.ok ? ` · note ${run.proposalScore ?? "?"}/10` : ` · ${run.error}`}`);
  }
  if (!dry) console.log(`\n${ok}/${targets.length} proposition(s) rédigée(s) · coût ${(await spentSince(userId, started)).toFixed(4)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

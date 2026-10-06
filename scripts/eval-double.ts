/**
 * ÉVALUATION DU DOUBLE JUGE sur des fiches réelles (PAYANT, plafond 0,90 €).
 *
 *   npm run eval:double -- 15     15 fiches réelles avec e-mail, famille attribuée comme en production
 *
 * Rien n'est écrit en base (aucun brouillon, aucun envoi). Affiche, par fiche,
 * la famille, la note retenue (la plus basse des deux juges), le nombre
 * d'essais et le coût ; puis le taux ≥ 9 et le coût par mail prêt.
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import type { Prospect } from "@/types";

const BUDGET_EUR = 0.9;
const count = Math.max(1, Number(process.argv[2]) || 15);

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  // Fiches récentes avec e-mail et profil métier lu : celles que la préparation rédige.
  const { data } = await (db as never as { from: (table: string) => any })
    .from("prospects")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("email", "is", null)
    .not("business_profile", "is", null)
    .order("created_at", { ascending: false })
    .limit(count * 3);
  const prospects = ((data ?? []) as Prospect[]).filter((prospect) => prospect.business_profile && Object.keys(prospect.business_profile).length).slice(0, count);
  let ready = 0;
  let drafted = 0;
  const lines: string[] = [];
  for (const prospect of prospects) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.05) {
      lines.push("Arrêt : plafond atteint.");
      break;
    }
    const before = await spentSince(userId, started);
    const { outcome } = await prepareMail({ ...prospect }, userId, {});
    const cost = (await spentSince(userId, started)) - before;
    if (!("body" in outcome)) {
      lines.push(`- ${prospect.company_name} : ${"blocked" in outcome ? `bloqué (${outcome.blocked})` : outcome.error}`);
      continue;
    }
    drafted += 1;
    if (!outcome.needsReview) ready += 1;
    lines.push(`- ${prospect.company_name} · ${outcome.family} · ${outcome.score ?? "?"}/10 en ${outcome.attempts} essai(s) · ${cost.toFixed(3)} €${outcome.needsReview ? ` · À revoir : ${outcome.reviewReason}` : " · PRÊT"}`);
    if (!outcome.needsReview) lines.push(`    ${outcome.body.split("\n\nSi le sujet")[0].replace(/\n+/g, " / ")}`);
  }
  const spent = await spentSince(userId, started);
  console.log(lines.join("\n"));
  console.log(`\nPrêts (double juge ≥ 9) : ${ready}/${drafted} rédigés (${prospects.length} fiches) · coût ${spent.toFixed(3)} € · ${ready ? (spent / ready).toFixed(3) : "—"} € par mail prêt`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

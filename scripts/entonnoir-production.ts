/**
 * ENTONNOIR DE PRODUCTION des 14 derniers jours (Cowork #27) — LECTURE SEULE, gratuit.
 *
 *   npx tsc -p tsconfig.test.json && node -r ./scripts/alias.cjs .test-build/scripts/entonnoir-production.js [jours]
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { buildProductionFunnel, STAGES, type FunnelDraft, type FunnelProspect, type FunnelSignal, type FunnelUsage } from "@/lib/funnel/production-funnel";
import { utcToParis } from "@/lib/outbox/paris-time";

async function main() {
  const userId = await ownerId();
  const windowDays = Number(process.argv[2] ?? 14);
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const table = db as never as { from: (t: string) => any };
  const [signals, prospects, drafts, usage] = await Promise.all([
    readAll<FunnelSignal>(() => table.from("signal_candidates").select("created_at, source, statut, motif_rejet, identity, publication, contact, prospect_id").eq("user_id", userId).gte("created_at", sinceIso).order("id")),
    readAll<FunnelProspect>(() => table.from("prospects").select("id, created_at, business_profile, key_figures, website, email").eq("user_id", userId).gte("created_at", sinceIso).order("id")),
    readAll<FunnelDraft>(() => table.from("messages").select("prospect_id, created_at, quality_score, quality_reason, origin").eq("user_id", userId).eq("type", "intro").is("deleted_at", null).order("id")),
    readAll<FunnelUsage>(() => table.from("api_usage").select("created_at, service, operation, units, cost").gte("created_at", sinceIso).order("id")),
  ]);
  const report = buildProductionFunnel({ signals, prospects, drafts, usage, since: utcToParis(new Date(sinceIso)).date, until: utcToParis(new Date()).date });
  const n = report.days.length;
  console.log(`Entonnoir ${report.days[0]} → ${report.days.at(-1)} (${n} jours ouvrés)\n`);
  let previous: number | null = null;
  for (const stage of STAGES) {
    const total = report.totals[stage];
    const pass = previous && stage !== "hors cible écartés" ? `${((total / previous) * 100).toFixed(0)} %` : "";
    console.log(`${stage.padEnd(22)} ${String(total).padStart(6)}  ${(total / n).toFixed(1).padStart(7)}/j  ${pass}`);
    if (stage !== "hors cible écartés") previous = total;
  }
  console.log(`\nDétails : ${JSON.stringify(report.extra)}`);
  console.log("\nCoûts sur la fenêtre :");
  let eur = 0;
  for (const row of report.cost) {
    eur += row.eur;
    console.log(`  ${row.family.padEnd(36)} ${row.eur.toFixed(2).padStart(7)} € · ${row.units.toFixed(0)} unités`);
  }
  const ready = report.totals["prêt (≥ 9/10)"];
  console.log(`  TOTAL ${eur.toFixed(2)} € · ${ready} prêts → ${(ready ? eur / ready : 0).toFixed(3)} €/mail prêt`);
  console.log("\nPar jour (collectés · retenus · creusés/site · e-mail · brouillon · prêts) :");
  for (const value of report.days) {
    const row = report.byDay[value];
    console.log(`  ${value} ${[row["collectés"], row["retenus (tri)"], row["site trouvé"], row["e-mail trouvé"], row["brouillon rédigé"], row["prêt (≥ 9/10)"]].map((x) => String(x).padStart(5)).join(" ")}`);
  }
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

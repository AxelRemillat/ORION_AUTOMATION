/**
 * POINT DÉLIVRABILITÉ (Cowork #26) — LECTURE SEULE, gratuit.
 *
 *   npx tsc -p tsconfig.test.json && node -r ./scripts/alias.cjs .test-build/scripts/point-delivrabilite.js
 */
import { db, ownerId } from "./quality-live";
import { loadDeliverabilityReport } from "@/lib/settings/deliverability-report-server";
import { rate, recommendation } from "@/lib/settings/deliverability-report";

async function main() {
  const userId = await ownerId();
  const report = await loadDeliverabilityReport(db, userId);
  console.log(`Depuis le ${report.since}\n`);
  console.log("Semaine     | Intros | Relances | Rebonds durs | mous | Réponses | Refus/stop | Absences | Anti-spam | Taux rebond dur | Taux réponse");
  for (const week of [...report.weeks, report.totals]) {
    const sent = week.intros + week.relances;
    console.log(
      `${week.week.padEnd(11)} | ${String(week.intros).padStart(6)} | ${String(week.relances).padStart(8)} | ${String(week.hardBounces).padStart(12)} | ${String(week.softBounces).padStart(4)} | ${String(week.replies).padStart(8)} | ${String(week.stops).padStart(10)} | ${String(week.absences).padStart(8)} | ${String(week.antispam).padStart(9)} | ${rate(week.hardBounces, sent).padStart(15)} | ${rate(week.replies, sent)}`,
    );
  }
  console.log("\nRebonds par type d'adresse :");
  for (const [kind, value] of Object.entries(report.bouncesByKind)) console.log(`  ${kind.padEnd(10)} ${value.sent} envois · ${value.hard} durs · ${value.soft} mous · ${rate(value.hard, value.sent)}`);
  console.log(`  destinataire non retrouvé : ${report.unmatchedBounces}`);
  console.log(`\nMails prêts ≥ 9/10 par jour ouvré : ${report.readyPerBusinessDay.toFixed(1)} (${report.readyDays.map((day) => `${day.day.slice(5)}:${day.ready}`).join(" ")})`);
  console.log(`\n${recommendation(report, 30).text}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

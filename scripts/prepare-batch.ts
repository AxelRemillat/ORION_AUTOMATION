/**
 * PRÉPARATION MANUELLE d'un lot de mesure (Cowork #34/#35) — un job
 * `search_signals` / `kind: "prepare"` mis en file comme « Lancer maintenant »,
 * exécuté par le tick des jobs (jamais le cron de 5 h, qui reste coupé).
 *
 *   npm run prepare:lot -- --target 25 --hunter-cap 40           (sans brouillons)
 *   npm run prepare:lot -- --target 25 --hunter-cap 40 --drafts  (avec brouillons)
 *   npm run prepare:lot -- --target 10 --linkup-cap 8 --segment agences (plafond Linkup du job, segment)
 *   npm run prepare:lot -- --target 30 --days 30 --france              (entonnoir élargi pour ce run)
 *   npm run prepare:lot -- --target 30 --ft-days 60                    (fenêtre France Travail de 60 jours)
 *   npm run prepare:lot -- --status <jobId>                      (avancement)
 *
 * Aucun envoi : au plus des brouillons non validés.
 */
import { db, ownerId } from "./quality-live";
import { createJob } from "@/lib/jobs/store";

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main() {
  const status = value("--status");
  if (status) {
    const { data } = await db.from("jobs").select("status, progress, error, created_at, updated_at").eq("id", status).maybeSingle();
    console.log(JSON.stringify(data));
    return;
  }
  const userId = await ownerId();
  const target = Math.max(1, Math.min(30, Number(value("--target")) || 25));
  const hunterCap = Math.max(0, Number(value("--hunter-cap")) || 40);
  const skipDrafts = !process.argv.includes("--drafts");
  const created = await createJob(
    db,
    {
      type: "search_signals",
      target: { label: `Préparation (lot de mesure, ${target} fiches)` },
      params: {
        kind: "prepare", digLimit: target, dailyTarget: target, skipDrafts, hunterCap, trigger: "manuel",
        // Linkup (Cowork #37) : plafond du job et segment (part réservée LINKUP_RESERVE).
        ...(value("--linkup-cap") ? { linkupCap: Math.max(0, Number(value("--linkup-cap")) || 0) } : {}),
        ...(value("--segment") ? { segment: value("--segment") } : {}),
        // Entonnoir élargi pour ce run seulement (réglages inchangés) : fenêtre en jours, toute la France.
        ...(value("--days") ? { days: Math.max(1, Math.min(90, Number(value("--days")) || 7)) } : {}),
        ...(process.argv.includes("--france") ? { departements: [] } : {}),
        // Fenêtre France Travail du run (30 jours par défaut ; le lot de stock passe 60).
        ...(value("--ft-days") ? { ftDays: Math.max(1, Math.min(90, Number(value("--ft-days")) || 30)) } : {}),
      },
    },
    userId,
  );
  if ("error" in created) throw new Error(created.error);
  console.log(`job ${created.id} en file — ${target} fiches, ${skipDrafts ? "sans brouillons" : "avec brouillons"}, Hunter ≤ ${hunterCap} crédits`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

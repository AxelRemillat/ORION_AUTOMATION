/**
 * PRÉPARATION MANUELLE d'un lot de mesure (Cowork #34/#35) — un job
 * `search_signals` / `kind: "prepare"` mis en file comme « Lancer maintenant »,
 * exécuté par le tick des jobs (jamais le cron de 5 h, qui reste coupé).
 *
 *   npm run prepare:lot -- --target 25 --hunter-cap 40           (sans brouillons)
 *   npm run prepare:lot -- --target 25 --hunter-cap 40 --drafts  (avec brouillons)
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
      params: { kind: "prepare", digLimit: target, dailyTarget: target, skipDrafts, hunterCap, trigger: "manuel" },
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

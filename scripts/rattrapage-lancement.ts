/**
 * RATTRAPAGE « MISSIONS DE LANCEMENT » (Cowork #20, 11/10/2026) — GRATUIT, aucun appel au modèle.
 *
 * Les fiches Codeur « Ignorées » par le pré-filtre ces N derniers jours (7 par défaut)
 * repassent au NOUVEAU pré-filtre (développement web accepté, CMS imposé = à voir).
 * Seuls `status`, `filter_reason` et `analysis_state` sont écrits ; rien n'est supprimé.
 * Celles qui deviennent « Mission de lancement » passent en Alerte (calculée sur le texte)
 * SANS notification par fiche : une seule notification récapitulative au plus.
 *
 *   npm run rattrapage:lancement -- --dry   (lecture seule : ce qui serait fait)
 *   npm run rattrapage:lancement            (écrit en base)
 */
import { db, ownerId } from "./quality-live";
import { prefilterReason, titleOnlyReason } from "@/lib/opportunities/prefilter";
import { laneOf } from "@/lib/opportunities/lane";
import { TITLE_ONLY } from "@/lib/opportunities/title-only";
import { appUrl, pushNtfy } from "@/lib/notify/ntfy";
import type { Platform } from "@/lib/opportunities/types";

const dry = process.argv.includes("--dry");
const days = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 7);

type Row = { id: string; platform: Platform; title: string; body: string; budget: string | null; categories: string[] | null; filter_reason: string | null; analysis_state: string | null; source: string | null; status: string; seen_at: string | null; published_at: string | null; created_at: string };

/** Fiche née d'une alerte e-mail réduite au titre (le corps EST le titre). */
const titleOnly = (row: Row) => row.analysis_state === TITLE_ONLY || (row.source === "email" && row.body.trim() === row.title.trim());

async function main() {
  const userId = await ownerId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const table = db as never as { from: (t: string) => any };
  const columns = "id, platform, title, body, budget, categories, filter_reason, analysis_state, source, status, seen_at, published_at, created_at";
  const { data, error } = await table.from("opportunities").select(columns).eq("user_id", userId).eq("platform", "codeur").gte("created_at", since).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const launches: Row[] = [];
  const lines: string[] = [];
  let kept = 0;

  for (const row of rows.filter((item) => item.status === "ignoree" && item.filter_reason)) {
    const only = titleOnly(row);
    const reason = only ? titleOnlyReason(row.title, row.budget) : prefilterReason({ title: row.title, description: row.body, categories: row.categories ?? [], budgetText: row.budget });
    if (reason) {
      // Toujours écartée : le motif est mis à jour s'il a changé (nouveaux libellés), rien d'autre.
      if (reason !== row.filter_reason && !dry) await table.from("opportunities").update({ filter_reason: reason }).eq("id", row.id).eq("status", "ignoree");
      kept += 1;
      continue;
    }
    const lane = laneOf(row);
    const patch = { status: "a_repondre", filter_reason: null, analysis_state: only ? TITLE_ONLY : null };
    if (!dry) await table.from("opportunities").update(patch).eq("id", row.id).eq("status", "ignoree");
    const label = lane === "lancement" ? "ALERTE (Lancement)" : lane === "cms_impose" ? "À voir (CMS imposé)" : "À voir";
    if (lane === "lancement") launches.push(row);
    lines.push(`  ${label} · ${row.title} · ${row.budget ?? "budget non indiqué"}`);
  }

  // Fiches déjà « À voir » qui deviennent missions de lancement par la seule nouvelle règle (rien à écrire).
  const derived = rows.filter((row) => row.status !== "ignoree" && !row.filter_reason && !row.seen_at && laneOf(row) === "lancement" && !launches.includes(row));

  console.log(`${dry ? "[lecture seule] " : ""}${rows.filter((row) => row.status === "ignoree" && row.filter_reason).length} fiche(s) Codeur ignorées par le filtre depuis ${days} j :`);
  console.log(lines.join("\n") || "  aucune");
  console.log(`\nDéjà « À voir », désormais en Alerte (Lancement) sans écriture : ${derived.length}`);
  for (const row of derived) console.log(`  ALERTE (Lancement) · ${row.title} · ${row.budget ?? "budget non indiqué"}`);

  const all = [...launches, ...derived];
  if (!dry && all.length) {
    const sent = await pushNtfy({
      title: `${all.length} mission(s) de lancement Codeur à reprendre`,
      body: all.slice(0, 6).map((row) => `• ${row.title}`).join("\n"),
      priority: "default",
      tags: ["briefcase"],
      click: `${appUrl()}/opportunites?p=codeur`,
    }).catch(() => false);
    console.log(sent ? "\nNotification récapitulative envoyée (une seule)." : "\nNotification récapitulative non envoyée (NTFY_TOPIC absent ici).");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

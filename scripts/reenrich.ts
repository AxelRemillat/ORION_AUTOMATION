/**
 * Re-enrichissement ciblé de prospects déjà en base.
 *
 * Rejoue la chaîne complète — Annuaire, Linkup, site officiel, extraction
 * structurée, Pappers, holding — sur des prospects existants, puis réécrit
 * leurs signaux et chiffres clés. Sert à valider le pipeline sur des cas
 * réels, et à rattraper des fiches enrichies avant une amélioration.
 *
 *   npx tsx scripts/reenrich.ts RAS "BLUE ENERFREEZE" JACQUET
 *   npx tsx scripts/reenrich.ts --all --limit 3
 *   npx tsx scripts/reenrich.ts --dry-run RAS        (n'écrit rien en base)
 *
 * CONSOMME DES APPELS PAYANTS. Les coûts sont journalisés dans api_usage grâce
 * à ORION_SCRIPT_USER_ID, positionné ici depuis le propriétaire du prospect.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Prospect } from "../types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 3 : 10;
  const names = args.filter((arg) => !arg.startsWith("--") && arg !== String(limit));

  // Corbeille exclue : on ne repaie pas l'enrichissement d'un prospect supprimé.
  const query = supabase
    .from("prospects")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const { data, error } = await query.limit(50);
  if (error) throw new Error(error.message);

  const all = (data ?? []) as Prospect[];
  const targets = names.length
    ? names
        .map((name) =>
          all.find((prospect) =>
            prospect.company_name.toLowerCase().includes(name.toLowerCase()),
          ),
        )
        .filter((prospect): prospect is Prospect => Boolean(prospect))
    : all.slice(0, limit);

  if (!targets.length) {
    console.log("Aucun prospect ne correspond.");
    return;
  }

  // Les couts du script sont imputes au proprietaire des fiches traitees.
  process.env.ORION_SCRIPT_USER_ID = targets[0].user_id;

  // Import tardif : ces modules lisent ORION_SCRIPT_USER_ID au premier appel.
  const { resolveCompany } = await import("../lib/enrichment/gouv");
  const { enrichCompany } = await import("../lib/enrichment/index");
  const { heatContextOf, heatScore } = await import("../lib/scoring");

  const before = await totalCost();

  for (const prospect of targets) {
    console.log(`\n=== ${prospect.company_name} (${prospect.siren ?? "sans SIREN"})`);

    const resolved = await resolveCompany(prospect.siren ?? prospect.company_name);
    if (!resolved.ok) {
      console.log(`  resolution impossible : ${resolved.error}`);
      continue;
    }

    // On repart de l'annuaire MAIS on conserve ce que la fiche sait deja :
    // l'adresse de contact sert de candidat gratuit pour retrouver le site.
    const enriched = await enrichCompany({
      ...resolved.data,
      email: resolved.data.email ?? prospect.email,
      website: resolved.data.website ?? prospect.website,
    });
    const figures = enriched.key_figures;
    const score = heatScore(enriched.signals, {
      seed: enriched.company_name,
      context: heatContextOf(figures),
    });

    console.log(`  site        : ${figures.site_status ?? "—"} ${enriched.website ?? ""}`);
    console.log(
      `  dirigeant   : ${figures.leader_person ?? "—"}${figures.leader_via ? ` (via ${figures.leader_via})` : ""}`,
    );
    console.log(
      `  groupe      : ${figures.parent_group ?? figures.parent_company ?? "—"}${
        figures.is_large_group_subsidiary ? "  [GRAND GROUPE]" : ""
      }`,
    );
    for (const line of (figures.group_evidence as string[] | undefined) ?? []) {
      console.log(`                ${line}`);
    }
    console.log(`  score       : ${score.value}/100 (${score.level})`);
    for (const line of score.breakdown) {
      console.log(`                ${line.points >= 0 ? "+" : ""}${line.points}  ${line.label}`);
    }
    console.log(`  signaux     : ${enriched.signals.length}`);
    for (const signal of enriched.signals) {
      console.log(
        `    - [${signal.type}${signal.category ? `/${signal.category}` : ""}] ${signal.label}`,
      );
      if (signal.quote) console.log(`      « ${String(signal.quote).slice(0, 140)} »`);
    }
    for (const warning of enriched.warnings) {
      console.log(`  ! ${warning.source} : ${warning.message}`);
    }

    if (dryRun) continue;

    const { error: updateError } = await supabase
      .from("prospects")
      .update({
        website: enriched.website,
        email: enriched.email ?? prospect.email,
        sector: enriched.sector,
        size_range: enriched.size_range,
        signals: enriched.signals,
        key_figures: figures,
      })
      .eq("id", prospect.id);
    if (updateError) console.log(`  ecriture KO : ${updateError.message}`);
    else console.log("  fiche mise a jour");
  }

  const after = await totalCost();
  console.log(
    `\nCout de ce run : ${(after - before).toFixed(4)} € sur ${targets.length} prospect(s) ` +
      `(${((after - before) / targets.length).toFixed(4)} € par prospect)`,
  );
}

/** Somme de api_usage, pour mesurer le coût réel du run. */
async function totalCost(): Promise<number> {
  const { data } = await supabase.from("api_usage").select("cost");
  return ((data ?? []) as { cost: number }[]).reduce((sum, row) => sum + Number(row.cost), 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

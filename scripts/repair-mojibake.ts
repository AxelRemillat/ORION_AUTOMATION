/**
 * Rattrapage du mojibake déjà stocké (« PyrÃ©nÃ©es », « FondÃ », « â€¯ »).
 *
 * Le correctif d'encodage (lib/enrichment/charset.ts) protège les nouvelles
 * fiches ; celles déjà en base gardent leurs citations abîmées. Ce script les
 * relit et les répare, sans aucun appel payant :
 *
 *   npx tsx scripts/repair-mojibake.ts                  (simulation, n'écrit rien)
 *   npx tsx scripts/repair-mojibake.ts --apply          (écrit les corrections)
 *   npx tsx scripts/repair-mojibake.ts --apply --reclasser
 *        (+ retire des signaux les pages « À propos / Recrutement » génériques
 *         et les range dans key_figures.site_facts)
 *
 * IDEMPOTENT : une ligne saine n'est jamais réécrite, et une seconde exécution
 * ne trouve plus rien. Aucune suppression : seules des chaînes sont corrigées.
 *
 * Tables relues : prospects (signals, key_figures, pain_point, brief),
 * favorites (company), search_runs (results), enrichment_cache (payload).
 * `messages` n'est PAS touchée : un mail envoyé reste tel qu'il est parti.
 *
 * Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE dans `.env.local`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { repairValue } from "../lib/enrichment/charset";
import { dedupeFacts, separateSiteFacts, type SiteFact } from "../lib/enrichment/site-facts";
import type { ProspectSignal } from "../types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const PAGE = 200;

interface Target {
  table: string;
  key: string;
  columns: string[];
}

const TARGETS: Target[] = [
  { table: "prospects", key: "id", columns: ["signals", "key_figures", "pain_point", "brief"] },
  { table: "favorites", key: "id", columns: ["company"] },
  { table: "search_runs", key: "id", columns: ["results"] },
  { table: "enrichment_cache", key: "key", columns: ["payload"] },
];

type Row = Record<string, unknown>;

/** Range les signaux non datables d'une fiche en faits « site ». */
function reclassify(row: Row): { signals: ProspectSignal[]; keyFigures: Row } | null {
  const signals = Array.isArray(row.signals) ? (row.signals as ProspectSignal[]) : [];
  const separated = separateSiteFacts(signals);
  if (!separated.siteFacts.length) return null;
  const keyFigures = (row.key_figures ?? {}) as Row;
  const previous = Array.isArray(keyFigures.site_facts) ? (keyFigures.site_facts as SiteFact[]) : [];
  return {
    signals: separated.signals,
    keyFigures: { ...keyFigures, site_facts: dedupeFacts([...previous, ...separated.siteFacts]) },
  };
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis (.env.local)");

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const reclasser = args.includes("--reclasser");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(apply ? "Mode ÉCRITURE" : "Mode SIMULATION (ajouter --apply pour écrire)");

  for (const target of TARGETS) {
    let scanned = 0;
    let rowsFixed = 0;
    let stringsFixed = 0;
    let reclassified = 0;

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(target.table)
        .select([target.key, ...target.columns].join(","))
        .order(target.key, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        // Table absente (migration pas encore passée) : on le dit et on continue.
        console.log(`  ${target.table} : ignorée (${error.message})`);
        break;
      }
      const rows = (data ?? []) as unknown as Row[];
      scanned += rows.length;

      for (const row of rows) {
        const patch: Row = {};
        for (const column of target.columns) {
          const result = repairValue(row[column]);
          if (result.changed) {
            patch[column] = result.value;
            stringsFixed += result.changed;
          }
        }

        if (reclasser && target.table === "prospects") {
          const moved = reclassify({ ...row, ...patch });
          if (moved) {
            patch.signals = moved.signals;
            patch.key_figures = moved.keyFigures;
            reclassified += 1;
          }
        }

        if (!Object.keys(patch).length) continue;
        rowsFixed += 1;
        if (!apply) continue;
        const { error: updateError } = await supabase
          .from(target.table)
          .update(patch)
          .eq(target.key, row[target.key] as string);
        if (updateError) console.log(`  ! ${target.table} ${String(row[target.key])} : ${updateError.message}`);
      }

      if (rows.length < PAGE) break;
    }

    console.log(
      `  ${target.table} : ${scanned} lignes lues, ${rowsFixed} à corriger (${stringsFixed} textes)` +
        (reclasser && target.table === "prospects" ? `, ${reclassified} fiches reclassées` : ""),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

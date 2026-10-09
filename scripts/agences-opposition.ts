/**
 * MESURE GRATUITE du taux d'opposition à la prospection des agences (#4).
 *
 * La mesure du 07/10 a trouvé 5 agences qualifiées en zone 69, et les 5 étaient
 * opposées au RNE. Une seule zone ne dit pas si c'est un effet local ou une
 * caractéristique du métier. Ce script le mesure sur trois autres zones, SANS
 * RIEN DÉPENSER : annuaire des entreprises (gratuit) pour le vivier, RNE/INPI
 * (gratuit) pour l'opposition. Aucun crédit Hunter, aucun appel OpenAI, aucune
 * recherche Linkup — donc aucune lecture de site : on compte les
 * « qualifiables » (NAF + tranche d'effectif), pas les « qualifiées ».
 *
 *   npm run opposition:agences
 *   npm run opposition:agences -- --zones 75,33,13 --pool 60
 */
import { searchCompanies } from "@/lib/enrichment/gouv";
import { resolveZone } from "@/lib/enrichment/geo";
import { fetchInpiOpposition } from "@/lib/enrichment/inpi";
import { AGENCES_EFFECTIF_CODES, AGENCES_NAF } from "@/lib/segments/agences";
import type { CompanyBase } from "@/lib/enrichment/types";

const flag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const ZONES = flag("zones", "75,33,13").split(",").map((zone) => zone.trim()).filter(Boolean);
const POOL = Number(flag("pool", "60")) || 60;
const NAF_ORDER = ["73.11Z", "70.21Z", "74.10Z", "62.01Z", "62.02A"] as const;

type Row = { name: string; siren: string | null; naf: string | null; opposed: boolean | null; reason: string };

/**
 * Vivier d'une zone : l'annuaire seul, réparti sur les codes NAF du segment.
 *
 * ATTENTION — `criteria.zone` n'est qu'un LIBELLÉ : le filtre géographique de
 * l'annuaire vient de `options.zone`, une zone déjà résolue par `resolveZone`
 * (lib/enrichment/gouv.ts, ligne 296). Passer la chaîne « 75 » dans les
 * critères ne filtre RIEN — les trois zones rendaient la même liste, et la
 * mesure du 07/10 annoncée « zone 69 » portait en réalité sur un vivier
 * national.
 */
async function poolFor(zone: string): Promise<CompanyBase[]> {
  const pool: CompanyBase[] = [];
  const perNaf = Math.ceil(POOL / NAF_ORDER.length);
  const resolved = await resolveZone(zone);
  if (!resolved.ok) {
    console.log(`  (zone ${zone} non résolue : ${resolved.error})`);
    return pool;
  }
  for (const naf of NAF_ORDER) {
    if (pool.length >= POOL) break;
    const search = await searchCompanies(
      { naf: [naf], tranches: [...AGENCES_EFFECTIF_CODES], zone },
      25,
      { zone: resolved.data },
    );
    if (!search.ok) {
      console.log(`  (${zone} ${naf} : ${search.error})`);
      continue;
    }
    pool.push(...search.data.companies.slice(0, Math.min(perNaf, POOL - pool.length)));
  }
  return pool;
}

async function measure(zone: string): Promise<Row[]> {
  const pool = await poolFor(zone);
  console.log(`\n=== Zone ${zone} — ${pool.length} agences qualifiables (NAF + effectif 3-50)`);
  const rows: Row[] = [];
  for (const base of pool) {
    if (!base.siren) {
      rows.push({ name: base.company_name, siren: null, naf: base.naf_code, opposed: null, reason: "pas de SIREN" });
      continue;
    }
    const inpi = await fetchInpiOpposition(base.siren);
    rows.push({
      name: base.company_name,
      siren: base.siren,
      naf: base.naf_code,
      opposed: inpi.ok ? inpi.refuses : null,
      reason: inpi.ok ? (inpi.refuses ? "opposée" : "contactable") : inpi.error,
    });
  }
  const opposed = rows.filter((row) => row.opposed === true).length;
  const known = rows.filter((row) => row.opposed !== null).length;
  console.log(
    `  opposées : ${opposed}/${known} lues (${known ? Math.round((opposed / known) * 100) : 0} %) · ${rows.length - known} indéterminées`,
  );
  return rows;
}

async function main(): Promise<void> {
  console.log(`Zones : ${ZONES.join(", ")} · vivier ${POOL} par zone · NAF ${Object.keys(AGENCES_NAF).join(", ")}`);
  console.log("Étapes gratuites uniquement : annuaire + RNE/INPI. Aucune génération, aucun envoi.\n");

  const all: { zone: string; rows: Row[] }[] = [];
  for (const zone of ZONES) all.push({ zone, rows: await measure(zone) });

  console.log("\n\n## Taux d'opposition par zone\n");
  console.log("| Zone | Qualifiables | Opposition lue | Opposées | % opposées |");
  console.log("| --- | --- | --- | --- | --- |");
  let totalKnown = 0;
  let totalOpposed = 0;
  for (const { zone, rows } of all) {
    const known = rows.filter((row) => row.opposed !== null).length;
    const opposed = rows.filter((row) => row.opposed === true).length;
    totalKnown += known;
    totalOpposed += opposed;
    console.log(`| ${zone} | ${rows.length} | ${known} | ${opposed} | ${known ? Math.round((opposed / known) * 100) : 0} % |`);
  }
  console.log(
    `| **global** | ${all.reduce((sum, item) => sum + item.rows.length, 0)} | ${totalKnown} | ${totalOpposed} | **${totalKnown ? Math.round((totalOpposed / totalKnown) * 100) : 0} %** |`,
  );

  // Les contactables, nommément : c'est la seule liste qui sert à quelque chose.
  const contactable = all.flatMap(({ zone, rows }) =>
    rows.filter((row) => row.opposed === false).map((row) => `${zone} · ${row.name} (${row.naf ?? "NAF ?"})`),
  );
  console.log(`\n## Contactables (${contactable.length})\n`);
  console.log(contactable.length ? contactable.map((item) => `- ${item}`).join("\n") : "- aucune");

  const unknown = all.flatMap(({ rows }) => rows.filter((row) => row.opposed === null));
  if (unknown.length) {
    console.log(`\n## Opposition non lue (${unknown.length})\n`);
    const reasons = new Map<string, number>();
    for (const row of unknown) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    for (const [reason, count] of reasons) console.log(`- ${reason} : ${count}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

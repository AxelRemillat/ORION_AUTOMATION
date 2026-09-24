/**
 * Mesure de la qualité de l'enrichissement.
 *
 * Deux modes :
 *
 *   npx tsx scripts/enrichment-metrics.ts [--limit 20]
 *       Calcule les taux de couverture sur les N derniers prospects, écrit
 *       `enrichment-report.md` et exporte `enrichment-audit.csv` — un fait par
 *       ligne, avec une colonne `correct_o_n` vide, à remplir à la main.
 *
 *   npx tsx scripts/enrichment-metrics.ts --audit enrichment-audit.csv
 *       Relit le CSV annoté et calcule la PRÉCISION par source : sur les faits
 *       jugés, quelle proportion est correcte. C'est la seule mesure qui dise
 *       si une source ment.
 *
 * Le script lit `.env.local` lui-même et parle à Supabase avec la clé
 * service_role : il tourne hors de toute requête HTTP, donc hors RLS.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildFacts } from "../lib/emails/derived-facts";
import { isFresh } from "../lib/enrichment/dates";
import { heatContextOf, heatScore } from "../lib/scoring";
import type { Prospect, ProspectSignal } from "../types";

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

/** Charge `.env.local` sans dépendance : une ligne `CLE=valeur` à la fois. */
function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const percent = (part: number, total: number): string =>
  total === 0 ? "—" : `${Math.round((part / total) * 100)} %`;

const euros = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 4 }).format(value);

/** Adresses de rôle : elles ne désignent personne. */
const GENERIC_MAILBOX =
  /^(contact|info|infos|accueil|bonjour|hello|commercial|commerce|vente|ventes|sav|support|admin|administration|compta|comptabilite|rh|recrutement|secretariat|direction|standard|no-?reply|service-?client)@/i;

/** Un contact est NOMINATIF s'il désigne une personne, pas une boîte de service. */
export function isNominative(email: string | null | undefined): boolean {
  return Boolean(email && !GENERIC_MAILBOX.test(email.trim()));
}

/** Signaux d'actualité, hors déductions structurelles. */
const webSignals = (signals: ProspectSignal[] | null | undefined): ProspectSignal[] =>
  (signals ?? []).filter((signal) => signal.type !== "structure");

function csvCell(value: string): string {
  const clean = value.replace(/\r?\n/g, " ").trim();
  return /[",;]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

// ---------------------------------------------------------------------------
// Mode 1 — métriques
// ---------------------------------------------------------------------------

interface Metrics {
  total: number;
  withNominativeContact: number;
  withPhysicalLeader: number;
  withSiteRead: number;
  withFreshSignal: number;
  undatedSignals: number;
  totalSignals: number;
  subsidiaries: number;
}

function measure(prospects: Prospect[]): Metrics {
  const metrics: Metrics = {
    total: prospects.length,
    withNominativeContact: 0,
    withPhysicalLeader: 0,
    withSiteRead: 0,
    withFreshSignal: 0,
    undatedSignals: 0,
    totalSignals: 0,
    subsidiaries: 0,
  };

  for (const prospect of prospects) {
    const figures = prospect.key_figures ?? {};
    if (isNominative(prospect.email)) metrics.withNominativeContact += 1;
    if (typeof figures.leader_person === "string" && figures.leader_person.trim()) {
      metrics.withPhysicalLeader += 1;
    }
    // « Trouvé ET lu » : un site listé mais jamais ouvert ne compte pas.
    if (figures.site_status === "lu") metrics.withSiteRead += 1;
    if (figures.is_large_group_subsidiary === true) metrics.subsidiaries += 1;

    const signals = webSignals(prospect.signals);
    metrics.totalSignals += signals.length;
    metrics.undatedSignals += signals.filter((signal) => typeof signal.date !== "string").length;
    if (signals.some((signal) => isFresh(typeof signal.date === "string" ? signal.date : null))) {
      metrics.withFreshSignal += 1;
    }
  }
  return metrics;
}

interface CostSummary {
  attributed: number;
  perProspect: number;
  byService: Record<string, number>;
  unattributed: number;
}

function report(metrics: Metrics, costs: CostSummary, prospects: Prospect[]): string {
  const rows: [string, string, string][] = [
    ["Contact nominatif", percent(metrics.withNominativeContact, metrics.total), `${metrics.withNominativeContact}/${metrics.total}`],
    ["Dirigeant personne physique", percent(metrics.withPhysicalLeader, metrics.total), `${metrics.withPhysicalLeader}/${metrics.total}`],
    ["Site trouvé ET lu", percent(metrics.withSiteRead, metrics.total), `${metrics.withSiteRead}/${metrics.total}`],
    ["Au moins 1 signal frais daté", percent(metrics.withFreshSignal, metrics.total), `${metrics.withFreshSignal}/${metrics.total}`],
    ["Signaux non datés", percent(metrics.undatedSignals, metrics.totalSignals), `${metrics.undatedSignals}/${metrics.totalSignals}`],
    ["Filiales de grands groupes", percent(metrics.subsidiaries, metrics.total), `${metrics.subsidiaries}/${metrics.total}`],
  ];

  const services = Object.entries(costs.byService)
    .sort((a, b) => b[1] - a[1])
    .map(([service, cost]) => `| ${service} | ${euros(cost)} |`)
    .join("\n");

  const detail = prospects
    .map((prospect) => {
      const figures = prospect.key_figures ?? {};
      const score = heatScore(prospect.signals, {
        seed: prospect.company_name,
        context: heatContextOf(figures),
      });
      const fresh = webSignals(prospect.signals).filter((signal) =>
        isFresh(typeof signal.date === "string" ? signal.date : null),
      ).length;
      return `| ${prospect.company_name} | ${score.value} | ${figures.site_status ?? "—"} | ${
        typeof figures.leader_person === "string" ? figures.leader_person : "—"
      } | ${prospect.email ?? "—"} | ${fresh}/${webSignals(prospect.signals).length} | ${
        figures.is_large_group_subsidiary === true ? "oui" : "non"
      } |`;
    })
    .join("\n");

  return `# Qualité de l'enrichissement

Généré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} sur les ${metrics.total} derniers prospects.

## Couverture

| Indicateur | Taux | Détail |
| --- | --- | --- |
${rows.map(([label, rate, count]) => `| ${label} | ${rate} | ${count} |`).join("\n")}

## Coût

| Poste | Montant |
| --- | --- |
| **Moyenne par prospect** | **${euros(costs.perProspect)}** |
| Total imputé à ces prospects | ${euros(costs.attributed)} |
| Dépenses non imputées (scan, recherches) | ${euros(costs.unattributed)} |

Par service, sur les appels imputés à ces prospects :

| Service | Coût |
| --- | --- |
${services || "| — | — |"}

> Les crédits Pappers et les recherches Hunter valent 0 € tant que
> \`PAPPERS_CREDIT_EUR\` et \`HUNTER_SEARCH_EUR\` ne sont pas renseignés : leur
> consommation est comptée exactement, leur prix dépend du forfait.

## Détail par prospect

| Entreprise | Score | Site | Dirigeant | Contact | Signaux frais | Filiale |
| --- | --- | --- | --- | --- | --- | --- |
${detail}

## Précision des faits

Remplissez la colonne \`correct_o_n\` de \`enrichment-audit.csv\` (o / n), puis :

\`\`\`
npx tsx scripts/enrichment-metrics.ts --audit enrichment-audit.csv
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Mode 2 — audit
// ---------------------------------------------------------------------------

/** Découpe une ligne CSV en respectant les guillemets doublés. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function auditReport(file: string): string {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const sourceIndex = header.indexOf("source");
  const verdictIndex = header.indexOf("correct_o_n");
  if (sourceIndex < 0 || verdictIndex < 0) {
    throw new Error("colonnes `source` et `correct_o_n` attendues dans le CSV");
  }

  const tally = new Map<string, { ok: number; ko: number }>();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const verdict = (cells[verdictIndex] ?? "").trim().toLowerCase();
    if (!verdict) continue; // non jugé : n'entre pas dans le calcul
    const source = (cells[sourceIndex] ?? "inconnue").trim();
    const bucket = tally.get(source) ?? { ok: 0, ko: 0 };
    if (verdict === "o" || verdict === "oui" || verdict === "y") bucket.ok += 1;
    else bucket.ko += 1;
    tally.set(source, bucket);
  }

  const rows = [...tally.entries()]
    .sort((a, b) => b[1].ok + b[1].ko - (a[1].ok + a[1].ko))
    .map(([source, bucket]) => {
      const judged = bucket.ok + bucket.ko;
      return `| ${source} | ${percent(bucket.ok, judged)} | ${bucket.ok}/${judged} |`;
    });

  const judgedTotal = [...tally.values()].reduce((sum, bucket) => sum + bucket.ok + bucket.ko, 0);
  const okTotal = [...tally.values()].reduce((sum, bucket) => sum + bucket.ok, 0);

  return `
## Précision des faits (audit manuel du ${new Date().toISOString().slice(0, 10)})

${judgedTotal} fait(s) jugé(s) sur ${lines.length - 1} exporté(s).

| Source | Précision | Détail |
| --- | --- | --- |
${rows.join("\n")}
| **Toutes sources** | **${percent(okTotal, judgedTotal)}** | ${okTotal}/${judgedTotal} |
`;
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const auditIndex = args.indexOf("--audit");

  if (auditIndex >= 0) {
    const file = args[auditIndex + 1] ?? "enrichment-audit.csv";
    const section = auditReport(file);
    console.log(section);
    if (existsSync("enrichment-report.md")) {
      writeFileSync("enrichment-report.md", readFileSync("enrichment-report.md", "utf8") + section);
      console.log("Section ajoutée à enrichment-report.md");
    }
    return;
  }

  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");

  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 20 : 20;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const prospects = (data ?? []) as Prospect[];
  if (!prospects.length) {
    console.log("Aucun prospect en base.");
    return;
  }

  const ids = prospects.map((prospect) => prospect.id);
  const { data: usage } = await supabase
    .from("api_usage")
    .select("service, cost, prospect_id")
    .gte("created_at", prospects[prospects.length - 1].created_at);

  const byService: Record<string, number> = {};
  let attributed = 0;
  let unattributed = 0;
  for (const row of (usage ?? []) as { service: string; cost: number; prospect_id: string | null }[]) {
    const cost = Number(row.cost) || 0;
    if (row.prospect_id && ids.includes(row.prospect_id)) {
      attributed += cost;
      byService[row.service] = (byService[row.service] ?? 0) + cost;
    } else {
      unattributed += cost;
    }
  }

  const metrics = measure(prospects);
  const costs: CostSummary = {
    attributed,
    perProspect: attributed / prospects.length,
    byService,
    unattributed,
  };

  writeFileSync("enrichment-report.md", report(metrics, costs, prospects));

  // --- Export d'audit ------------------------------------------------------
  const rows = ["prospect,fait,valeur,source,url,correct_o_n"];
  for (const prospect of prospects) {
    for (const fact of buildFacts(prospect, null).facts) {
      rows.push(
        [
          csvCell(prospect.company_name),
          csvCell(fact.label),
          csvCell(fact.value),
          csvCell(fact.source),
          csvCell(fact.url ?? ""),
          "",
        ].join(","),
      );
    }
  }
  writeFileSync("enrichment-audit.csv", `${rows.join("\n")}\n`);

  console.log(`enrichment-report.md — ${prospects.length} prospects`);
  console.log(`enrichment-audit.csv — ${rows.length - 1} faits à juger`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

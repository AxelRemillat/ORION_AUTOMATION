/**
 * COÛT OPENAI PAR ÉTAPE (Cowork #54) — lecture seule, gratuit.
 *
 *   npx tsx scripts/cost-report.ts            # 14 derniers jours
 *   npx tsx scripts/cost-report.ts --days 7
 *
 * Lit `api_usage` (service openai ; VEGA n'y est pas) : appels, tokens, coût (€) par étape de la chaîne,
 * part prod / agents, et coût de la chaîne mail par intro prête (score ≥ 9, sans réserve).
 */
import { db } from "./quality-live";

type Usage = { operation: string; cost: number; units: number; source: string | null };

/** Étape de la chaîne d'après le nom d'opération. */
export function stageOf(operation: string): string {
  const op = operation.replace(/:\d+$/, "");
  if (/^strategie/.test(op)) return "stratège";
  if (/raccourci/.test(op)) return "raccourci";
  if (/^opportunites|proposition|upwork|codeur/.test(op)) return "opportunités / propositions";
  if (/^relance/.test(op)) return "relances";
  if (/redaction:rewrite|direct:rewrite/.test(op)) return "réécritures";
  if (/^qualite:redaction$|^redaction:direct$/.test(op)) return "rédaction";
  if (/checklist|juge|etalonnage|critique/.test(op)) return "juges";
  if (/^facts|profil-metier|extract/.test(op)) return "faits / profil";
  if (/reponse|reply/.test(op)) return "réponses assistées";
  if (/entonnoir|tri|triage/.test(op)) return "tri entonnoir";
  return "autres";
}

const MAIL_CHAIN = ["stratège", "rédaction", "réécritures", "raccourci", "juges"];

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) || 14 : 14;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const loose = db as never as { from: (table: string) => any };
  let rows: Usage[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await loose.from("api_usage").select("operation, cost, units, source").eq("service", "openai").gte("created_at", since).range(from, from + 999);
    rows = rows.concat((data ?? []) as Usage[]);
    if (!data || data.length < 1000) break;
  }
  const by: Record<string, { calls: number; cost: number; tokens: number }> = {};
  for (const row of rows) {
    const stage = stageOf(String(row.operation));
    by[stage] ??= { calls: 0, cost: 0, tokens: 0 };
    by[stage].calls += 1;
    by[stage].cost += Number(row.cost) || 0;
    by[stage].tokens += Number(row.units) || 0;
  }
  const total = Object.values(by).reduce((sum, v) => sum + v.cost, 0);
  const prod = rows.filter((row) => row.source === "prod").reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  console.log(`| Étape (${days} j) | Appels | Tokens | Coût (€) | Part |`);
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const [stage, v] of Object.entries(by).sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`| ${stage} | ${v.calls} | ${(v.tokens / 1e6).toFixed(2)} M | ${v.cost.toFixed(2)} | ${Math.round((100 * v.cost) / (total || 1))} % |`);
  }
  console.log(`\nTotal : ${total.toFixed(2)} € (${(total / days).toFixed(2)} €/jour, ~${((total / days) * 30).toFixed(0)} €/mois) · prod ${prod.toFixed(2)} € · agents ${(total - prod).toFixed(2)} €`);
  const { data: intros } = await loose.from("messages").select("quality_score, quality_reason").eq("type", "intro").gte("created_at", since);
  const ready = ((intros ?? []) as { quality_score: number | null; quality_reason: string | null }[]).filter((m) => (m.quality_score ?? 0) >= 9 && !m.quality_reason).length;
  const chain = MAIL_CHAIN.reduce((sum, stage) => sum + (by[stage]?.cost ?? 0), 0);
  console.log(`Chaîne mail : ${chain.toFixed(2)} € · intros prêtes ≥ 9 : ${ready} → ${(chain / Math.max(1, ready)).toFixed(3)} € par mail prêt (régénérations comprises)`);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

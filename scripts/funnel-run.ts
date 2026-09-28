/**
 * Mesure de l'entonnoir « signaux d'abord » sur un vrai run, SANS rien écrire
 * en base : moisson BODACC + France Travail, filtre déterministe, tri LLM.
 * Le creusage (Pappers, contact, brief) n'est pas lancé ici : il crée des
 * fiches, il se mesure depuis l'onglet « Signaux » (bandeau du run).
 *
 *   npx tsx scripts/funnel-run.ts --deps 69,31 --days 14 [--no-llm] [--record]
 *
 * --no-llm   s'arrête après le filtre (gratuit).
 * --record   écrit les réponses brutes (signaux + fiches annuaire) dans
 *            scripts/fixtures/funnel-live.json, pour remplacer les fixtures
 *            reconstituées de scripts/funnel-fixtures.ts.
 *
 * Lit `.env.local` (OPENAI_API_KEY, FRANCE_TRAVAIL_*). N'affiche aucune clé.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "../lib/ai/chat";
import type { CompanyBase } from "../lib/enrichment/types";
import { filterSignal } from "../lib/funnel/filter";
import { harvest } from "../lib/funnel/harvest";
import { annuaireLookup, toIdentity } from "../lib/funnel/identify";
import { KEEP_SCORE, triage, triageModel, type TriageInput } from "../lib/funnel/triage";
import type { HarvestedSignal } from "../lib/funnel/types";
import { getOpenAI } from "../lib/openai";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const histogram = (reasons: string[]) => {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const key = reason.replace(/\s*\([^)]*\)/g, "").split(" : ")[0];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

(async () => {
  loadEnv();
  const departements = arg("deps", "69,31").split(",").map((item) => item.trim());
  const days = Number(arg("days", "14"));

  console.log(`Moisson ${departements.join(", ")} · ${days} jours…`);
  const collected = await harvest({ departements, days });
  console.log(`  ${collected.signals.length} signaux bruts`, collected.bySource);

  const rejected: string[] = [];
  const kept: TriageInput[] = [];
  const record: { signal: HarvestedSignal; company: CompanyBase | null }[] = [];
  for (const signal of collected.signals.slice(0, 250)) {
    const found = await annuaireLookup(signal);
    const company = found.ok ? found.company : null;
    record.push({ signal, company });
    if (!found.ok) {
      rejected.push("annuaire saturé : identité non vérifiée, à rejouer");
      continue;
    }
    const identity = company ? toIdentity(signal, company) : null;
    const verdict = filterSignal(signal, identity);
    if (verdict.status === "rejeté" || !identity) rejected.push(verdict.reason ?? "sans motif");
    else kept.push({ id: signal.hash, signal, identity, verdict });
  }
  console.log(`  ${kept.length} filtrés, ${rejected.length} rejetés`);
  for (const [reason, count] of histogram(rejected)) console.log(`    ${String(count).padStart(4)}  ${reason}`);

  if (flag("record")) {
    mkdirSync("scripts/fixtures", { recursive: true });
    writeFileSync("scripts/fixtures/funnel-live.json", JSON.stringify(record, null, 2));
    console.log("  réponses brutes → scripts/fixtures/funnel-live.json");
  }
  if (flag("no-llm") || !kept.length) return;

  let tokens = 0;
  const outcomes = await triage(
    (system, user) =>
      chatJson({
        client: getOpenAI(),
        role: "extract",
        model: triageModel(),
        system,
        user,
        temperature: 0,
        operation: "entonnoir:tri",
        onUsage: (usage) => {
          tokens += usage.promptTokens + usage.completionTokens;
        },
      }),
    kept,
  );
  const retained = outcomes.filter((outcome) => outcome.retained);
  console.log(`  ${retained.length} retenus (score ≥ ${KEEP_SCORE}) sur ${outcomes.length} triés · ${tokens} tokens (${triageModel()})`);
  for (const [reason, count] of histogram(outcomes.filter((o) => !o.retained).map((o) => o.reason ?? "sans motif"))) {
    console.log(`    ${String(count).padStart(4)}  ${reason}`);
  }
  for (const outcome of retained) {
    const input = kept.find((item) => item.id === outcome.id)!;
    console.log(`  ${outcome.triage?.score}/5  ${input.identity.name} · ${input.signal.date} · ${input.signal.facts.label} → ${outcome.triage?.pain_probable}`);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

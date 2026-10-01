/**
 * Mesure de l'entonnoir « signaux d'abord » sur un vrai run, SANS créer de fiche :
 * moisson (France Travail d'abord), budget d'examen par source, filtre, tri LLM,
 * quota de variété — exactement les règles du job.
 *
 *   npx tsx scripts/funnel-run.ts --deps 69,38,42,01,73,74 --days 14 [--no-llm] [--dig] [--out rapport.json]
 *
 * --no-llm   s'arrête après le filtre (gratuit).
 * --dig      creusage À BLANC des retenus : fiche Pappers (opposition, effectif,
 *            capitaux propres) puis recherche de contact. PAYANT (Pappers, Linkup,
 *            Hunter) ; aucune fiche n'est créée, seul le journal des coûts d'API
 *            est alimenté. Donne le nombre de contactables.
 * --out      écrit le rapport complet en JSON.
 *
 * Lit `.env.local` (OPENAI_API_KEY, FRANCE_TRAVAIL_*, PAPPERS…). N'affiche aucune clé.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chatJson } from "../lib/ai/chat";
import { effectifLabel } from "../lib/enrichment/naf";
import { examinationPlan } from "../lib/funnel/budget";
import { digFactsOf, disqualify } from "../lib/funnel/eligible";
import { hunterPolicy } from "../lib/contact-finder/policy";
import { DEFAULT_EXCLUDED_SECTORS, DEFAULT_PREFERRED_SECTORS, filterSignal, NO_PAIN_TITLE } from "../lib/funnel/filter";
import { painForJob } from "../lib/funnel/pain-map";
import { harvest } from "../lib/funnel/harvest";
import { annuaireLookup, toIdentity } from "../lib/funnel/identify";
import { GOVERNANCE_ONLY, MAX_LOOKUPS } from "../lib/funnel/stages";
import { KEEP_SCORE, triage, triageModel, type TriageInput } from "../lib/funnel/triage";
import type { HarvestedSignal } from "../lib/funnel/types";
import { getOpenAI } from "../lib/openai";
import type { Prospect } from "../types";

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

const STRENGTH: Record<string, number> = { fort: 3, moyen: 2, faible: 1 };

(async () => {
  loadEnv();
  // « --deps all » : toute la France (aucun département), comme l'option de l'écran.
  const rawDeps = arg("deps", "69,31");
  const departements = rawDeps === "all" ? [] : rawDeps.split(",").map((item) => item.trim()).filter(Boolean);
  const days = Number(arg("days", "14"));
  const now = new Date();
  const perSource: Record<string, { bruts: number; examines: number; filtres: number; retenus: number; contactables: number }> = {};
  const bump = (source: string, key: keyof (typeof perSource)[string]) => {
    perSource[source] ??= { bruts: 0, examines: 0, filtres: 0, retenus: 0, contactables: 0 };
    perSource[source][key] += 1;
  };

  console.log(`Moisson ${departements.join(", ")} · ${days} jours (France Travail d'abord)…`);
  const collected = await harvest({ departements, days });
  for (const signal of collected.signals) bump(signal.source, "bruts");
  console.log(`  ${collected.signals.length} signaux bruts`, collected.bySource);

  // Offres sans pain dans l'intitulé : écartées avant le budget (comme le job).
  const precheck = collected.signals.filter((signal) => signal.source === "france-travail" && !painForJob(signal.facts.jobTitle ?? signal.text));
  console.log(`  ${precheck.length} offres écartées sans examen : ${NO_PAIN_TITLE}`);
  const governance = collected.signals.filter(
    (signal) => signal.source === "bodacc" && /commissaire aux comptes|administrateur|membre du (conseil|directoire|comit)|conseil de surveillance|censeur/i.test(signal.facts.label),
  );
  console.log(`  ${governance.length} annonces écartées sans examen : ${GOVERNANCE_ONLY}`);
  precheck.push(...governance);
  const plan = examinationPlan(
    collected.signals.filter((signal) => !precheck.includes(signal)).map((signal) => ({ id: signal.hash, source: signal.source, date: signal.date, strength: STRENGTH[signal.facts.strength] ?? 0, label: signal.facts.label, signal })),
    MAX_LOOKUPS,
  );
  console.log(`  budget d'examen : ${plan.examine.length} (${JSON.stringify(plan.bySource)}), ${plan.skip.length} non examinés`);

  const rejected: string[] = [];
  const rejectedDetail: Record<string, unknown>[] = [];
  const kept: TriageInput[] = [];
  for (const { signal } of plan.examine) {
    bump(signal.source, "examines");
    const found = await annuaireLookup(signal);
    if (!found.ok) {
      rejected.push("annuaire saturé : identité non vérifiée, à rejouer");
      continue;
    }
    const identity = found.company ? toIdentity(signal, found.company) : null;
    const verdict = filterSignal(signal, identity, {
      preferredSectors: DEFAULT_PREFERRED_SECTORS,
      excludedSectors: DEFAULT_EXCLUDED_SECTORS,
      now,
    });
    if (verdict.status === "rejeté" || !identity) {
      rejected.push(verdict.reason ?? "sans motif");
      rejectedDetail.push({
        source: signal.source,
        entreprise: signal.companyName,
        poste: signal.facts.jobTitle ?? null,
        naf: identity?.naf ?? null,
        effectif: identity?.effectifCode ?? null,
        motif: verdict.reason,
      });
    }
    else {
      kept.push({ id: signal.hash, signal, identity, verdict });
      bump(signal.source, "filtres");
    }
  }
  console.log(`  ${kept.length} filtrés, ${rejected.length} rejetés au filtre`);
  for (const [reason, count] of histogram(rejected)) console.log(`    ${String(count).padStart(4)}  ${reason}`);
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
  console.log(`  ${retained.length} retenus (score ≥ ${KEEP_SCORE}, quota appliqué) sur ${outcomes.length} triés · ${tokens} tokens (${triageModel()})`);
  for (const [reason, count] of histogram(outcomes.filter((o) => !o.retained).map((o) => o.reason ?? "sans motif"))) {
    console.log(`    ${String(count).padStart(4)}  ${reason}`);
  }

  const report: Record<string, unknown>[] = [];
  for (const outcome of retained) {
    const input = kept.find((item) => item.id === outcome.id)!;
    bump(input.signal.source, "retenus");
    report.push({
      nom: input.identity.name,
      siren: input.identity.siren,
      naf: input.identity.naf,
      effectif: effectifLabel(input.identity.effectifCode) ?? "non déclaré",
      source: input.signal.source,
      signal: input.signal.source === "france-travail" ? `Offre : ${input.signal.facts.jobTitle ?? input.signal.text}` : input.signal.facts.label,
      date: input.signal.date,
      score: outcome.triage?.score,
      raison: outcome.triage?.raison,
      pain: outcome.triage?.pain_probable,
      note: outcome.note ?? null,
    });
  }

  if (flag("dig") && retained.length) {
    console.log(`\nCreusage à blanc de ${retained.length} retenus (Pappers + contact, aucune fiche créée)…`);
    const { deepEnrich } = await import("../lib/enrichment");
    const { identityOf } = await import("../lib/contact-finder/sources");
    const { runContactSearch } = await import("../lib/contact-finder/finder");
    const { realDeps } = await import("../lib/contact-finder/clients");
    const { toProspectSignal } = await import("../lib/funnel/dig");
    for (const entry of report) {
      const input = kept.find((item) => item.identity.siren === entry.siren)!;
      const found = await annuaireLookup(input.signal as HarvestedSignal);
      const base = found.ok ? found.company : null;
      if (!base) {
        entry.creusage = "fiche annuaire introuvable";
        continue;
      }
      try {
        const company = await deepEnrich(base, [], [], { attachedSignals: [toProspectSignal(input.signal)] });
        const figures = company.key_figures ?? {};
        // Le job ne publierait pas sans Pappers (lib/funnel/dig.ts). Le rejeu
        // cherche quand même le contact, pour mesurer, et le signale.
        entry.pappers = figures.pappers_read === true ? "lu" : "NON LU (opposition et groupe non vérifiés)";
        const verdict = disqualify(digFactsOf(figures));
        if (verdict) {
          entry.creusage = `écarté : ${verdict.reason}`;
          console.log(`  ${entry.nom} → ${entry.creusage}`);
          continue;
        }
        const prospect = { id: "dry", company_name: company.company_name, siren: company.siren, website: company.website ?? null, email: null, city: company.city ?? null, key_figures: figures } as unknown as Prospect;
        const identity = await identityOf(prospect);
        // Même feu vert Hunter que le job : sans Pappers lu, ou sous le score 4,
        // la mesure se fait en gratuit seulement — le rejeu ne dépense plus de
        // crédit sur une fiche que le job aurait écartée.
        const hunter = hunterPolicy({ ...figures, funnel_run_id: "rejeu", funnel_score: entry.score });
        const { result } = await runContactSearch(identity, realDeps(null), undefined, { hunter });
        entry.contact = result.email
          ? `${result.email} (${result.email_type}${result.doubtful ? ", DOUTEUX" : ""})`
          : result.phone
            ? `aucun email · tél. ${result.phone}`
            : "aucun email, aucun téléphone";
        entry.creusage = result.email ? "contactable" : result.phone ? "à appeler" : "à compléter (ni email ni téléphone)";
        if (result.email) bump(input.signal.source, "contactables");
      } catch (error) {
        entry.creusage = `erreur : ${error instanceof Error ? error.message : String(error)}`;
      }
      console.log(`  ${entry.nom} → ${entry.creusage}${entry.contact ? ` · ${entry.contact}` : ""}${entry.pappers && entry.pappers !== "lu" ? " · Pappers NON LU" : ""}`);
    }
  }

  console.log("\nRetenus :");
  for (const entry of report) {
    console.log(`  ${entry.score}/5  ${entry.nom} · NAF ${entry.naf} · ${entry.effectif} · ${entry.signal} (${entry.date}) — ${entry.raison}${entry.creusage ? ` → ${entry.creusage}` : ""}`);
  }
  console.log("\nRendement par source :");
  for (const [source, y] of Object.entries(perSource)) {
    console.log(`  ${source.padEnd(15)} ${y.bruts} bruts → ${y.examines} examinés → ${y.filtres} filtrés → ${y.retenus} retenus${flag("dig") ? ` → ${y.contactables} contactables` : ""}`);
  }
  const out = arg("out", "");
  if (out) {
    const triaged = outcomes.map((outcome) => {
      const input = kept.find((item) => item.id === outcome.id)!;
      return { nom: input.identity.name, naf: input.identity.naf, effectif: input.identity.effectifCode, signal: input.signal.facts.label, score: outcome.triage?.score, raison: outcome.triage?.raison, pain: outcome.triage?.pain_probable, retenu: outcome.retained, motif: outcome.reason };
    });
    writeFileSync(out, JSON.stringify({ departements, days, perSource, retained: report, triaged, rejected: histogram(rejected), rejectedDetail }, null, 2));
    console.log(`\nRapport → ${out}`);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

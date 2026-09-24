/**
 * Évaluation de la génération d'emails : STRATÈGE → RÉDACTEUR → JUGE.
 *
 * À LANCER EN LOCAL : ce script consomme des appels OpenAI réels (et lit la
 * base en mode --ab). Rien ici ne tourne en CI.
 *
 * ─── Commandes ──────────────────────────────────────────────────────────────
 *
 *   # Rapport simple (fixtures, 4 registres) avec la config de l'environnement
 *   npm run eval:emails
 *
 *   # Même chose en forçant les modèles du stratège et du rédacteur
 *   npm run eval:emails -- --strategist <modele> --writer <modele>
 *
 *   # A/B : config actuelle vs config forte, mêmes prospects
 *   #   RAS, BLUE ENERFREEZE, JACQUET + 7 autres prospects de la base
 *   #   → ab-report.md (paires anonymisées) + ab-key.json (clé, ne pas lire avant)
 *   npm run eval:emails -- --ab --strategist <modele-fort> --writer <modele-moyen>
 *
 *   # Révèle quelle config a produit quelle version (aucun appel OpenAI)
 *   #   → ab-reveal.md
 *   npm run eval:emails -- --reveal
 *
 * ─── Variables ──────────────────────────────────────────────────────────────
 *
 *   OPENAI_API_KEY                         obligatoire (sauf --reveal)
 *   OPENAI_MODEL_STRATEGIST / _WRITER / _JUDGE   config « actuelle » (défaut :
 *                                          OPENAI_MODEL, sinon gpt-4o-mini)
 *   EVAL_STRONG_STRATEGIST / _WRITER       alternative à --strategist / --writer
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, ORION_SCRIPT_USER_ID
 *                                          --ab : lecture des prospects en base
 *                                          (sinon repli sur les fixtures)
 *   OPENAI_PRICES_JSON                     prix des modèles hors grille
 *   EVAL_ONLY="ras,blue"  EVAL_TONES="direct"  EVAL_AB_TONE="direct"
 *
 * Le juge est le même pour les deux configs (OPENAI_MODEL_JUDGE) : on compare
 * des rédactions, pas des correcteurs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { chatJson, type AskFn } from "@/lib/ai/chat";
import { modelFor, type AiRole } from "@/lib/ai/models";
import { buildFacts } from "@/lib/emails/derived-facts";
import { runStrategist, type StrategyBrief } from "@/lib/emails/strategist";
import { bodyParagraphs } from "@/lib/emails/validate";
import { openAiCost } from "@/lib/usage/pricing";
import { maxSimilarity } from "@/lib/similarity";
import { TONES, type ToneKey } from "@/lib/tones";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
import { draftFromBrief } from "@/app/api/emails/generate/pipeline";
import { averageScore, CRITERIA_LABELS, failingCriteria, type Critique } from "@/app/api/emails/generate/critic";
import { FIXTURES, REFERENCE_SECTION, type Fixture } from "./eval-fixtures";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
};

const list = (raw: string | undefined) =>
  (raw ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
const only = list(process.env.EVAL_ONLY);
const toneFilter = list(process.env.EVAL_TONES);

interface ModelConfig {
  name: "actuelle" | "forte" | "surchargée";
  strategist: string;
  writer: string;
}

const CURRENT: ModelConfig = {
  name: "actuelle",
  strategist: modelFor("strategist"),
  writer: modelFor("writer"),
};

// ---------------------------------------------------------------------------
// Mesure : coût et latence de chaque mail
// ---------------------------------------------------------------------------

interface Meter {
  costEur: number;
  latencyMs: number;
  calls: number;
  priceKnown: boolean;
}

const newMeter = (): Meter => ({ costEur: 0, latencyMs: 0, calls: 0, priceKnown: true });

function makeAsk(client: OpenAI, config: ModelConfig, meter: Meter): AskFn {
  const override: Partial<Record<AiRole, string>> = { strategist: config.strategist, writer: config.writer };
  return (role, system, user, temperature, operation) =>
    chatJson({
      client,
      role,
      system,
      user,
      temperature,
      operation,
      model: override[role] ?? modelFor(role),
      onUsage: (usage) => {
        const cost = openAiCost(usage.model, usage.promptTokens, usage.completionTokens);
        meter.costEur += cost.cost;
        meter.latencyMs += usage.latencyMs;
        meter.calls += 1;
        meter.priceKnown &&= cost.priceKnown;
      },
    });
}

// ---------------------------------------------------------------------------
// Une génération complète — exactement la chaîne de la route
// ---------------------------------------------------------------------------

interface Row {
  prospectId: string;
  company: string;
  tone: ToneKey;
  config: ModelConfig;
  brief: StrategyBrief | null;
  plan: string;
  rewritten: boolean;
  subject: string;
  body: string;
  failures: string[];
  critique: Critique | null;
  meter: Meter;
  error?: string;
}

async function generate(
  client: OpenAI,
  config: ModelConfig,
  fixture: Fixture,
  tone: ToneKey,
  avoid: string[],
): Promise<Row> {
  const meter = newMeter();
  const ask = makeAsk(client, config, meter);
  const { prospect, contact } = fixture;
  const factsResult = buildFacts(prospect, contact);
  const figures = prospect.key_figures ?? {};
  const base: Row = {
    prospectId: prospect.id, company: prospect.company_name, tone, config, brief: null, plan: "-",
    rewritten: false, subject: "", body: "", failures: [], critique: null, meter,
  };

  const outcome = await runStrategist((system, user, operation) => ask("strategist", system, user, 0.2, operation), {
    facts: factsResult.facts,
    companyName: factsResult.companyName,
    isLargeGroupSubsidiary: factsResult.isLargeGroupSubsidiary,
    parentGroup: (typeof figures.parent_group === "string" ? figures.parent_group : null) ?? factsResult.parent,
    foreignEntities: factsResult.foreignEntities,
    history: [],
  });
  if (!outcome.brief) return { ...base, error: `brief KO : ${outcome.error}` };

  const draft = await draftFromBrief({
    ask,
    brief: outcome.brief,
    facts: factsResult.facts,
    tone,
    contact,
    prospectId: prospect.id,
    registryName: prospect.company_name,
    avoid,
    leaderPerson: factsResult.leaderPerson,
    forbiddenNames: factsResult.foreignEntities,
  });
  if ("error" in draft) return { ...base, brief: outcome.brief, error: draft.error };

  return {
    ...base,
    brief: outcome.brief,
    plan: draft.plan,
    rewritten: draft.rewritten,
    subject: draft.email.subject,
    body: draft.email.body,
    failures: draft.validation.failures,
    critique: draft.critique,
  };
}

// ---------------------------------------------------------------------------
// Prospects de la base (--ab)
// ---------------------------------------------------------------------------

const AB_NAMED = ["%RAS%INTERIM%", "%ENERFREEZE%", "%JACQUET%"];
const AB_OTHERS = 7;

async function loadAbProspects(): Promise<Fixture[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  const userId = process.env.ORION_SCRIPT_USER_ID;
  if (!url || !key || !userId) {
    console.warn(
      "⚠️  Base non configurée (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, ORION_SCRIPT_USER_ID) : repli sur les fixtures.",
    );
    return FIXTURES;
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const picked: Prospect[] = [];
  for (const pattern of AB_NAMED) {
    const { data } = await db
      .from("prospects")
      .select("*")
      .eq("user_id", userId)
      .ilike("company_name", pattern)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data?.[0]) picked.push(data[0] as Prospect);
    else console.warn(`⚠️  Aucun prospect ${pattern} en base.`);
  }
  const { data: others } = await db
    .from("prospects")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "perdu")
    .order("updated_at", { ascending: false })
    .limit(AB_OTHERS + picked.length);
  for (const row of (others ?? []) as Prospect[]) {
    if (picked.length >= AB_NAMED.length + AB_OTHERS) break;
    if (!picked.some((item) => item.id === row.id)) picked.push(row);
  }
  return picked.map((prospect) => ({ prospect, contact: null as DecisionMakerContact | null }));
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

const score = (critique: Critique | null) => (critique ? averageScore(critique).toFixed(1) : "—");
const euros = (value: number) => `${value.toFixed(4)} €`;

function briefLines(brief: StrategyBrief | null): string[] {
  if (!brief) return ["_Pas de brief._"];
  return [
    `- **Angle** (${brief.angle.type}, faits ${brief.angle.hookFactIds.join(", ")}) : ${brief.angle.insight}`,
    `- **Pain** : ${brief.pain.task} — ${brief.pain.automationIdea}`,
    `- **Preuve** : ${brief.proofId ?? "aucune"} · **CTA** : ${brief.cta}`,
    ...(brief.targetingWarning ? [`- ⚠️ **Ciblage** : ${brief.targetingWarning}`] : []),
    ...(brief.avoid.length ? [`- **À éviter** : ${brief.avoid.join(" ; ")}`] : []),
  ];
}

function mailLines(row: Row): string[] {
  if (row.error) return [`_Échec : ${row.error}_`, ""];
  const lines = [`**Objet :** ${row.subject}`, "", "```", row.body, "```", ""];
  lines.push(
    row.failures.length ? `Validateurs : ${row.failures.map((failure) => `\n- ${failure}`).join("")}` : "Validateurs : aucun échec.",
    "",
  );
  if (row.critique) {
    lines.push("| Critère | Note | Commentaire |", "| --- | --- | --- |");
    for (const key of Object.keys(CRITERIA_LABELS) as (keyof Critique)[]) {
      lines.push(`| ${CRITERIA_LABELS[key]} | ${row.critique[key].score}/5 | ${row.critique[key].note} |`);
    }
    lines.push("");
  }
  return lines;
}

function simpleReport(rows: Row[], config: ModelConfig): string {
  const lines: string[] = [
    "# Évaluation de la génération d'emails",
    "",
    `Généré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} · stratège \`${config.strategist}\` · rédacteur \`${config.writer}\` · juge \`${modelFor("judge")}\``,
    "",
    "## Synthèse",
    "",
    "| Entreprise | Ton | Angle | Plan | Objet | Réécrit | Validateurs | Note | Coût | Latence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.company} | ${row.tone} | ${row.brief?.angle.type ?? "—"} | ${row.plan} | ${row.subject} | ${row.rewritten ? "oui" : "non"} | ${row.error ? "échec" : row.failures.length === 0 ? "OK" : `${row.failures.length} échec(s)`} | ${score(row.critique)}/5 | ${euros(row.meter.costEur)}${row.meter.priceKnown ? "" : "*"} | ${(row.meter.latencyMs / 1000).toFixed(1)} s |`,
    );
  }
  lines.push("", "\\* prix du modèle absent de la grille : coût approximatif (voir OPENAI_PRICES_JSON).");

  // Similarite croisee entre entreprises DIFFERENTES : seule signature d'un moule.
  lines.push("", "## Similarité entre entreprises différentes", "");
  let worst = 0;
  for (const row of rows) {
    const value = maxSimilarity(row.body, rows.filter((other) => other.company !== row.company).map((other) => other.body));
    worst = Math.max(worst, value);
    if (value > 0.35) lines.push(`- ⚠️ ${row.company} / ${row.tone} : ${(value * 100).toFixed(0)} %`);
  }
  lines.push(`- Maximum observé : **${(worst * 100).toFixed(0)} %** (seuil d'alerte : 35 %)`);

  // Squelette : deux mails peuvent partager 0 % de vocabulaire et le même plan.
  lines.push("", "## Squelette : premiers mots des paragraphes", "");
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const key = bodyParagraphs(row.body)
      .map((block) => (block.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-zà-ÿ']/g, ""))
      .join(" · ");
    if (key) seen.set(key, [...(seen.get(key) ?? []), `${row.company} / ${row.tone}`]);
  }
  const shared = [...seen].filter(([, owners]) => new Set(owners.map((owner) => owner.split(" / ")[0])).size > 1);
  for (const [key, owners] of shared) lines.push(`- ⚠️ « ${key} » : ${owners.join(", ")}`);
  if (!shared.length) lines.push("- Aucune entreprise ne partage la suite de ses mots d'ouverture.");

  lines.push("", "## Mails générés", "");
  for (const row of rows) {
    lines.push(`### ${row.company} — ton ${row.tone}`, "", ...briefLines(row.brief), "", ...mailLines(row));
    if (row.critique && failingCriteria(row.critique).length) {
      lines.push(`Sous le seuil : ${failingCriteria(row.critique).length} critère(s).`, "");
    }
  }
  lines.push("", ...REFERENCE_SECTION);
  return lines.join("\n");
}

interface AbKey {
  generatedAt: string;
  tone: ToneKey;
  /** Code anonyme → config. */
  codes: Record<"α" | "β", ModelConfig>;
  pairs: {
    company: string;
    versions: { code: "α" | "β"; score: number | null; failures: number; costEur: number; latencyMs: number }[];
  }[];
}

function abReport(pairs: Row[][], key: AbKey): string {
  const lines: string[] = [
    "# A/B de modèles — paires anonymisées",
    "",
    `Généré le ${key.generatedAt.slice(0, 16).replace("T", " ")} · ton \`${key.tone}\` · juge \`${modelFor("judge")}\``,
    "",
    "Dans chaque paire, l'ordre des versions est tiré au sort. Notez vos préférences",
    "AVANT de lancer `npm run eval:emails -- --reveal`.",
    "",
  ];
  pairs.forEach((pair, index) => {
    lines.push(`## ${index + 1}. ${pair[0].company}`, "");
    pair.forEach((row, version) => {
      lines.push(`### Version ${version + 1}`, "", ...briefLines(row.brief), "", ...mailLines(row));
    });
    lines.push("Préférence : ☐ Version 1 ☐ Version 2 ☐ égalité", "");
  });

  // Agrégats par config, sous code anonyme : ils ne disent pas quelle version
  // de chaque paire vient de quelle config.
  lines.push("## Coût et latence par config", "", "| Config | Coût moyen / mail | Latence moyenne / mail | Note moyenne | Mails en échec validateurs |", "| --- | --- | --- | --- | --- |");
  for (const code of ["α", "β"] as const) {
    const entries = key.pairs.flatMap((pair) => pair.versions.filter((version) => version.code === code));
    const scored = entries.filter((entry) => entry.score !== null);
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    lines.push(
      `| ${code} | ${euros(avg(entries.map((entry) => entry.costEur)))} | ${(avg(entries.map((entry) => entry.latencyMs)) / 1000).toFixed(1)} s | ${scored.length ? avg(scored.map((entry) => entry.score as number)).toFixed(2) : "—"}/5 | ${entries.filter((entry) => entry.failures > 0).length}/${entries.length} |`,
    );
  }
  lines.push("", "Coût calculé sur les tokens réellement facturés (grille de lib/usage/pricing.ts + OPENAI_PRICES_JSON).");
  return lines.join("\n");
}

function reveal(): void {
  let key: AbKey;
  try {
    key = JSON.parse(readFileSync("ab-key.json", "utf8")) as AbKey;
  } catch {
    throw new Error("ab-key.json introuvable : lancez d'abord `npm run eval:emails -- --ab ...`.");
  }
  const describe = (code: "α" | "β") => {
    const config = key.codes[code];
    return `${config.name} (stratège \`${config.strategist}\`, rédacteur \`${config.writer}\`)`;
  };
  const lines = [
    "# A/B de modèles — révélation",
    "",
    `- **α** = ${describe("α")}`,
    `- **β** = ${describe("β")}`,
    "",
    "| # | Entreprise | Version 1 | Version 2 | Notes du juge (V1 / V2) |",
    "| --- | --- | --- | --- | --- |",
    ...key.pairs.map(
      (pair, index) =>
        `| ${index + 1} | ${pair.company} | ${key.codes[pair.versions[0].code].name} | ${key.codes[pair.versions[1].code].name} | ${pair.versions.map((version) => version.score?.toFixed(1) ?? "—").join(" / ")} |`,
    ),
  ];
  writeFileSync("ab-reveal.md", lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (flag("reveal")) return reveal();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente : ce script appelle OpenAI.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const strategist = option("strategist") ?? process.env.EVAL_STRONG_STRATEGIST;
  const writer = option("writer") ?? process.env.EVAL_STRONG_WRITER;

  if (flag("ab")) {
    if (!strategist && !writer) {
      throw new Error("--ab exige la config forte : --strategist <modele> et/ou --writer <modele>.");
    }
    const strong: ModelConfig = {
      name: "forte",
      strategist: strategist ?? CURRENT.strategist,
      writer: writer ?? CURRENT.writer,
    };
    const tone = (process.env.EVAL_AB_TONE ?? "direct") as ToneKey;
    const prospects = await loadAbProspects();
    const codes = Math.random() < 0.5 ? { α: CURRENT, β: strong } : { α: strong, β: CURRENT };
    const codeOf = (config: ModelConfig) => (codes.α === config ? "α" : "β") as "α" | "β";
    const key: AbKey = { generatedAt: new Date().toISOString(), tone, codes, pairs: [] };
    const pairs: Row[][] = [];

    for (const fixture of prospects) {
      const rows: Row[] = [];
      for (const config of [CURRENT, strong]) {
        rows.push(await generate(client, config, fixture, tone, []));
        console.log(`  ${fixture.prospect.company_name} / ${config.name} — ${rows[rows.length - 1].error ?? "ok"}`);
      }
      if (Math.random() < 0.5) rows.reverse();
      pairs.push(rows);
      key.pairs.push({
        company: fixture.prospect.company_name,
        versions: rows.map((row) => ({
          code: codeOf(row.config),
          score: row.critique ? averageScore(row.critique) : null,
          failures: row.error ? 1 : row.failures.length,
          costEur: row.meter.costEur,
          latencyMs: row.meter.latencyMs,
        })),
      });
    }
    writeFileSync("ab-key.json", JSON.stringify(key, null, 2), "utf8");
    writeFileSync("ab-report.md", abReport(pairs, key), "utf8");
    console.log(`\nRapport écrit : ab-report.md (${pairs.length} paires). Clé : ab-key.json (--reveal pour l'ouvrir).`);
    return;
  }

  const config: ModelConfig =
    strategist || writer
      ? { name: "surchargée", strategist: strategist ?? CURRENT.strategist, writer: writer ?? CURRENT.writer }
      : CURRENT;
  const selected = only.length
    ? FIXTURES.filter((fixture) => only.some((needle) => fixture.prospect.id.toLowerCase().includes(needle)))
    : FIXTURES;
  const tones = toneFilter.length ? TONES.filter((tone) => toneFilter.includes(tone.key)) : TONES;

  const rows: Row[] = [];
  for (const fixture of selected) {
    for (const tone of tones) {
      const avoid = rows.map((row) => row.body.split("\n")[2] ?? "").filter(Boolean).slice(-6);
      const row = await generate(client, config, fixture, tone.key, avoid);
      rows.push(row);
      console.log(`  ${row.company} / ${tone.key} — ${row.error ?? `${row.failures.length} echec(s)`}`);
    }
  }
  writeFileSync("eval-report.md", simpleReport(rows, config), "utf8");
  console.log(`\nRapport écrit : eval-report.md (${rows.length} mails)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

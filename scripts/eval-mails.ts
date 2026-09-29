/**
 * `npm run eval:mails` — mails générés contre mails écrits à la main.
 *
 * À LANCER EN LOCAL (agent VS Code) : lit `.env.local`, consomme des appels
 * OpenAI PAYANTS (profil métier, stratège, rédacteur, juge) et écrit un
 * brouillon sur chaque prospect évalué — c'est le vrai pipeline, le job
 * `email`, en mode « Générer quand même ». Un brouillon PROGRAMMÉ n'est jamais
 * réécrit (lib/jobs/handlers/email.ts).
 *
 *   npm run eval:mails
 *   npm run eval:mails -- --only briol,bonnin
 *
 * Variables : OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE
 * (obligatoires) ; EVAL_MAILS_JUDGE_MODEL (défaut gpt-6-sol).
 *
 * Cas : evals/mails/cases.json. Rapport : evals/mails/report-AAAA-MM-JJ.md.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Prospect } from "@/types";
import {
  buildJudgePrompt,
  generatedIsA,
  goalReached,
  parseVerdict,
  renderReport,
  type CaseResult,
  type EvalCase,
  type MailText,
} from "./eval-mails-core";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const REQUIRED = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Variables manquantes : ${missing.join(", ")}. À lancer en local : npm run eval:mails`);
  process.exit(1);
}

const JUDGE_MODEL = process.env.EVAL_MAILS_JUDGE_MODEL?.trim() || "gpt-6-sol";
const GENERATION_BUDGET_MS = 280_000;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!, {
  auth: { persistSession: false },
});

const only = (() => {
  const index = process.argv.indexOf("--only");
  return index >= 0 ? (process.argv[index + 1] ?? "").split(",").filter(Boolean) : [];
})();

async function findProspect(pattern: string): Promise<Prospect | null> {
  const { data } = await db
    .from("prospects")
    .select("*")
    .is("deleted_at", null)
    .ilike("company_name", pattern)
    .order("updated_at", { ascending: false })
    .limit(1);
  return (data?.[0] as Prospect | undefined) ?? null;
}

/** La version programmée (ou partie) : celle qu'Axel a retouchée à la main. Lecture seule. */
async function scheduledReference(prospectId: string): Promise<MailText | null> {
  const { data } = await db
    .from("messages")
    .select("subject, body, send_status, scheduled_at, sent_at")
    .eq("prospect_id", prospectId)
    .eq("type", "intro")
    .in("send_status", ["scheduled", "sending", "sent"])
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const row = data?.[0] as { subject: string | null; body: string } | undefined;
  return row ? { subject: row.subject ?? "", body: row.body } : null;
}

/** Le vrai pipeline : un job `email_generate` piloté ici, comme /api/emails/generate. */
async function generate(prospect: Prospect): Promise<MailText | { error: string }> {
  process.env.ORION_SCRIPT_USER_ID = prospect.user_id;
  const { HANDLERS } = await import("@/lib/jobs/handlers");
  const { driveJob } = await import("@/lib/jobs/runner");
  const { EMPTY_PROGRESS } = await import("@/lib/jobs/types");

  const { data: job, error } = await db
    .from("jobs")
    .insert({
      user_id: prospect.user_id,
      // Le type du job est `email_generate` : « email » n'existe ni dans
      // JOB_TYPES ni dans la contrainte `jobs_type_check` de la base, et
      // l'évaluation échouait donc sur les quatre cas avant d'avoir rien
      // généré (« violates check constraint »).
      type: "email_generate",
      target: { prospectId: prospect.id, label: `Éval · ${prospect.company_name}`.slice(0, 160) },
      params: { prospectId: prospect.id, tone: "direct", mode: "full", force: true, saveDraft: true },
      status: "queued",
      progress: EMPTY_PROGRESS,
    })
    .select("id")
    .single();
  if (error || !job) return { error: `job non créé : ${error?.message}` };

  const final = await driveJob(db as never, (job as { id: string }).id, HANDLERS, GENERATION_BUDGET_MS);
  if (!final || final.status !== "done") return { error: `génération : ${final?.error ?? final?.status ?? "sans réponse"}` };
  const messageId = (final.result as { messageId?: string } | null)?.messageId;
  if (!messageId) return { error: "brouillon non enregistré" };
  const { data: message } = await db.from("messages").select("subject, body").eq("id", messageId).maybeSingle();
  const row = message as { subject: string | null; body: string } | null;
  return row ? { subject: row.subject ?? "", body: row.body } : { error: "brouillon introuvable" };
}

/** La signature de /offre : le juge et le rapport comptent les mots sans elle, comme l'UI. */
async function signatureOf(userId: string): Promise<string> {
  const { loadOffer } = await import("@/lib/offer/read");
  const { signatureFor } = await import("@/lib/offer/model");
  return signatureFor((await loadOffer(db as never, userId)).offer);
}

/** Ce que le pipeline savait au moment d'ecrire : c'est ce qui explique une defaite. */
async function diagnose(prospectId: string): Promise<string[]> {
  const { storedProfile, locationsLine } = await import("@/lib/emails/business-profile");
  const { data, error } = await db
    .from("prospects")
    .select("website, sector, key_figures, business_profile, business_profile_at")
    .eq("id", prospectId)
    .maybeSingle();

  /*
   * La colonne n'existe pas encore : il faut le DIRE.
   *
   * `business_profile` arrive avec la migration de cette branche ; tant qu'elle
   * n'est pas appliquée, la requête échoue et le diagnostic restait vide — on
   * lisait un rapport sans savoir que le stratège avait travaillé sans profil
   * métier, et donc déduit le pain du code NAF.
   */
  if (error) {
    return [
      `Profil métier : INDISPONIBLE — ${error.message}`,
      "La migration 20260927210139_business_profile n'est pas appliquée : le stratège a choisi le pain sans profil.",
    ];
  }
  const row = data as {
    website: string | null;
    sector: string | null;
    key_figures: Record<string, unknown> | null;
    business_profile: unknown;
    business_profile_at: string | null;
  } | null;
  if (!row) return [];
  const profile = storedProfile(row.business_profile);
  return [
    `Site : ${row.website ?? "aucun (profil métier impossible)"}`,
    `Secteur / NAF : ${row.sector ?? "?"} / ${String(row.key_figures?.naf_code ?? "?")}`,
    profile
      ? `Profil métier (${row.business_profile_at?.slice(0, 10)}) : ${profile.offer} — ${locationsLine(profile) ?? "aucune implantation citée"} — pages : ${profile.sources.length}`
      : "Profil métier : ABSENT — le stratège a choisi le pain sans lui",
  ];
}

async function judge(caseId: string, company: string, generated: MailText, reference: MailText, signature: string) {
  const { chatJson } = await import("@/lib/ai/chat");
  const { getOpenAI } = await import("@/lib/openai");
  const generatedA = generatedIsA(caseId);
  const [a, b] = generatedA ? [generated, reference] : [reference, generated];
  const { system, user } = buildJudgePrompt(a, b, company, signature);
  const raw = await chatJson({
    client: getOpenAI(),
    role: "judge",
    model: JUDGE_MODEL,
    system,
    user,
    temperature: 0,
    operation: "eval-mails:juge",
  });
  return parseVerdict(raw, generatedA);
}

async function main(): Promise<void> {
  const cases = (JSON.parse(readFileSync("evals/mails/cases.json", "utf8")) as EvalCase[]).filter(
    (item) => !only.length || only.includes(item.id),
  );
  const results: CaseResult[] = [];
  let signature: string | null = null;

  for (const item of cases) {
    const prospect = await findProspect(item.match);
    if (!prospect) {
      /*
       * Cas NÉGATIF dont la fiche a disparu : c'est un succès.
       *
       * GLOBAL 2F a été mise à la corbeille le 28/09/2026, après le mail qu'elle
       * n'aurait pas dû recevoir. Une fiche hors cible qui n'est plus au
       * portefeuille ne sera pas contactée : l'attente est tenue, et l'évaluation
       * ne doit pas la compter en erreur.
       */
      const gone = item.expect === "refus";
      results.push({
        id: item.id,
        company: item.id,
        generated: null,
        reference: null,
        verdict: null,
        error: gone ? undefined : `aucun prospect ${item.match}`,
        ...(gone ? { negative: { expected: true, refused: true } } : {}),
      });
      if (gone) console.log(`
=== ${item.id}
  → hors portefeuille (corbeille) : rien ne partira`);
      continue;
    }
    console.log(`\n=== ${prospect.company_name}`);
    const reference = item.reference ?? (item.referenceFromScheduled ? await scheduledReference(prospect.id) : null);
    signature ??= await signatureOf(prospect.user_id);
    const generated = await generate(prospect);
    const base = { id: item.id, company: prospect.company_name, reference, diagnostics: await diagnose(prospect.id) };

    // Cas négatif : le refus EST le résultat attendu.
    if (item.expect === "refus") {
      const refused = "error" in generated;
      console.log(`  → ${refused ? "refusé, comme attendu" : "MAIL PRODUIT alors qu'il fallait refuser"}`);
      results.push({
        ...base,
        generated: refused ? null : generated,
        verdict: null,
        error: refused ? undefined : "un mail a été produit pour une fiche hors cible",
        negative: { expected: true, refused },
      });
      continue;
    }

    if ("error" in generated) {
      results.push({ ...base, generated: null, verdict: null, error: generated.error });
      continue;
    }
    if (!reference) {
      results.push({ ...base, generated, verdict: null, error: "aucune référence (ni JSON, ni mail programmé)" });
      continue;
    }
    const verdict = await judge(item.id, prospect.company_name, generated, reference, signature);
    results.push({ ...base, generated, verdict, error: verdict ? undefined : "verdict du juge illisible" });
    console.log(`  → ${verdict?.outcome ?? "?"} : ${verdict?.reasons ?? ""}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const path = `evals/mails/report-${date}.md`;
  writeFileSync(path, renderReport(results, { date, judgeModel: JUDGE_MODEL, signature }));
  console.log(`\nRapport : ${path} — objectif ${goalReached(results) ? "ATTEINT" : "non atteint"}.`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});

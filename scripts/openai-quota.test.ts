/**
 * Garde-fou « crédit OpenAI » et ingestion Codeur résiliente (Cowork #35).
 * Erreurs OpenAI SIMULÉES : aucun appel réseau, aucune notification réelle.
 * `npm run test:quota-openai`
 */
import { withParamFallback, type AskFn } from "../lib/ai/chat";
import { classifyOpenAiError, guardOpenAi, isOpenAIQuotaError, OpenAIQuotaError, QUOTA_MESSAGE, quotaHitSince, registerOpenAiHealth, resetOpenAiHealth } from "../lib/ai/quota";
import { createQuotaWatch, QUOTA_NOTIFY_EVERY_MS, type OpenAiQuotaState } from "../lib/ai/quota-watch";
import { askTriageBatch } from "../lib/funnel/triage";
import { failureDecision } from "../lib/jobs/runner";
import { openAiGuarded } from "../lib/jobs/handlers/prepare";
import type { Notification } from "../lib/notify/ntfy";
import { coreSignals } from "../lib/opportunities/core-signal";
import { catchUpUnanalyzed, ingestOpportunity, NOT_ANALYZED, type IngestBody } from "../lib/opportunities/ingest";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const apiError = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, error: { code, message } });
const NO_CREDIT = apiError(429, "You have no credits remaining. Add credits to continue using the API.");
const INSUFFICIENT = apiError(429, "You exceeded your current quota, please check your plan and billing details.", "insufficient_quota");
const RATE = apiError(429, "Rate limit reached for gpt-6-luna on requests per min (RPM): Limit 500.", "rate_limit_exceeded");
const noSleep = { backoffMs: [1, 1, 1], sleep: async () => undefined };

async function main() {
  console.log("\n1. Quota ≠ limite de débit");
  {
    check("429 « no credits remaining » → quota", classifyOpenAiError(NO_CREDIT) === "quota");
    check("429 insufficient_quota → quota", classifyOpenAiError(INSUFFICIENT) === "quota");
    check("429 rate limit → limite de débit", classifyOpenAiError(RATE) === "rate_limit");
    check("401 de facturation → quota", classifyOpenAiError(apiError(401, "Your account is not active, please check your billing details.")) === "quota");
    check("401 clé invalide → autre (pas un quota)", classifyOpenAiError(apiError(401, "Incorrect API key provided.")) === "other");
    check("500 → autre", classifyOpenAiError(apiError(500, "server error")) === "other");
  }

  console.log("\n2. Point d'appel commun");
  {
    resetOpenAiHealth();
    const seen: string[] = [];
    registerOpenAiHealth({ onQuota: () => void seen.push("quota"), onSuccess: () => void seen.push("ok") });
    const start = Date.now();
    let calls = 0;
    const quota = await guardOpenAi(async () => {
      calls += 1;
      throw NO_CREDIT;
    }, noSleep).catch((error) => error);
    check("quota → OpenAIQuotaError, sans nouvel essai", isOpenAIQuotaError(quota) && quota.name === "OpenAIQuotaError" && calls === 1, { name: quota?.name, calls });
    check("… signalé (état + notification) et repérable dans le processus", seen.includes("quota") && quotaHitSince(start));

    let tries = 0;
    const result = await guardOpenAi(async () => {
      tries += 1;
      if (tries < 3) throw RATE;
      return "réponse";
    }, noSleep);
    check("limite de débit : réessayé avec attente, puis réussi", result === "réponse" && tries === 3 && seen.at(-1) === "ok", { tries, seen });
    const exhausted = await guardOpenAi(async () => {
      throw RATE;
    }, noSleep).catch((error) => error);
    check("limite de débit persistante : l'erreur d'origine remonte (pas un quota)", !isOpenAIQuotaError(exhausted) && exhausted === RATE);

    const viaFallback = await withParamFallback("gpt-6-luna", () => ({ model: "gpt-6-luna" }) as never, async () => {
      throw INSUFFICIENT;
    }).catch((error) => error);
    check("withParamFallback (chatJson, extraction, réponses) : OpenAIQuotaError", isOpenAIQuotaError(viaFallback), viaFallback?.name);
    resetOpenAiHealth();
  }

  console.log("\n3. État partagé, notifications (au plus une toutes les 3 h), retour à la normale");
  {
    let state: OpenAiQuotaState | null = null;
    const pushed: Notification[] = [];
    let clock = new Date("2026-10-07T08:00:00Z");
    let reads = 0;
    const watch = createQuotaWatch({
      read: async () => {
        reads += 1;
        return state;
      },
      write: async (next) => void (state = next),
      push: async (notification) => void pushed.push(notification),
      now: () => clock,
      baseUrl: "https://orion.test",
    });
    await watch.onQuota(new OpenAIQuotaError(QUOTA_MESSAGE, 429));
    check("1er quota : état « en échec » + notification « crédit OpenAI épuisé »", state!.failing && pushed.length === 1 && pushed[0].title === "ORION : crédit OpenAI épuisé — rédaction et analyse Codeur en pause", pushed);
    clock = new Date(clock.getTime() + 60 * 60_000);
    await watch.onQuota(new OpenAIQuotaError(QUOTA_MESSAGE, 429));
    check("1 h après : pas de nouvelle notification, « depuis » inchangé", pushed.length === 1 && state!.since === "2026-10-07T08:00:00.000Z");
    clock = new Date(Date.parse("2026-10-07T08:00:00Z") + QUOTA_NOTIFY_EVERY_MS);
    await watch.onQuota(new OpenAIQuotaError(QUOTA_MESSAGE, 429));
    check("3 h après : rappel", pushed.length === 2);
    await watch.onSuccess();
    check("premier appel réussi : état effacé + « crédit OpenAI rétabli »", state!.failing === false && pushed.at(-1)?.title === "ORION : crédit OpenAI rétabli", state);
    const before = reads;
    await watch.onSuccess();
    check("appels réussis suivants : pas de relecture de l'état (10 min)", reads === before);
  }

  console.log("\n4. Jobs : arrêt propre, pas un échec de contenu");
  {
    const decision = failureDecision(0, new OpenAIQuotaError(QUOTA_MESSAGE));
    check("runner : pas de nouvelle tentative, motif clair, marqué quota", decision.verdict === "failed" && decision.message === QUOTA_MESSAGE && decision.details?.openai_quota === true && !decision.message.startsWith("Échec après"), decision);
    const step = openAiGuarded(async () => {
      throw new OpenAIQuotaError(QUOTA_MESSAGE);
    }, async () => ({ level: "ok" }) as never);
    const outcome = await step({ job: { id: "j", params: {}, state: {} }, db: {}, userId: "u1" } as never);
    check("préparation : arrêt propre (done), motif « crédit épuisé »", outcome.done === true && outcome.progress?.step === QUOTA_MESSAGE, outcome.progress);
    const triage = await askTriageBatch(async () => {
      throw new OpenAIQuotaError(QUOTA_MESSAGE);
    }, [{ id: "c1", signal: { source: "bodacc", date: "2026-10-06", text: "Création", facts: { label: "création" } }, identity: { name: "ACME", naf: "62.01Z", effectifCode: null, createdOn: null, revenue: null }, verdict: {} } as never]).catch((error) => error);
    check("tri de l'entonnoir : l'erreur remonte (aucun « tri indisponible » → rejeté)", isOpenAIQuotaError(triage), triage);
  }

  console.log("\n5. Ingestion Codeur sans analyse possible");
  {
    check("signal fort : IA, n8n, API", coreSignals({ title: "Agent IA connecté à n8n et à notre API" }).length >= 3);
    check("pas de signal : déménagement", coreSignals({ title: "Aide pour un déménagement à Lyon" }).length === 0);

    resetOpenAiHealth();
    const quotaAsk: AskFn = () => guardOpenAi(async () => {
      throw NO_CREDIT;
    }, noSleep);
    const fake = new FakeDb({ opportunities: [] } as Record<string, Record<string, unknown>[]>);
    const sent: Notification[] = [];
    const body: IngestBody = {
      platform: "codeur", external_id: "123", url: "https://www.codeur.com/projects/123", title: "Automatiser nos devis avec un agent IA et n8n",
      description: "Nous voulons connecter notre CRM à une API et automatiser la création des devis.", description_truncated: false,
      budget_text: "1 000 € à 10 000 €", categories: ["Intelligence artificielle"], published_at: "2026-10-07T07:00:00Z",
    };
    const deps = { db: fake as never, userId: "u1", ask: quotaAsk, baseUrl: "https://orion.test", now: () => new Date("2026-10-07T08:00:00Z"), notify: async (notification: Notification) => void sent.push(notification) };
    const response = await ingestOpportunity(deps, body);
    const row = fake.rows("opportunities")[0];
    check("offre enregistrée « Non analysée », jamais « Ignorée »", row?.analysis_state === NOT_ANALYZED && row.status !== "ignoree" && response.not_analyzed === true, row);
    check("signal fort : notification « Nouvelle offre (analyse indisponible) » avec le lien ORION", sent.length === 1 && sent[0].title === `Nouvelle offre (analyse indisponible) : ${body.title}` && Boolean(sent[0].click?.startsWith("https://orion.test/opportunites?id=")), sent);

    // Recharge : les « Non analysées » de moins de 48 h sont rattrapées ; les autres restent au bouton.
    fake.rows("opportunities").push({ id: "old", user_id: "u1", platform: "codeur", external_id: "9", title: "Ancienne offre API", body: "Intégration API", analysis_state: NOT_ANALYZED, created_at: "2026-10-04T08:00:00Z" });
    row.created_at = "2026-10-07T08:00:00Z";
    const okAsk: AskFn = async () => JSON.stringify({ score: 6, reasons: ["intégration API", "devis", "agent IA"], need: "Automatiser les devis.", demo: "devis", language: "fr", kind: "automatisation" });
    const done = await catchUpUnanalyzed({ ...deps, ask: okAsk, now: () => new Date("2026-10-07T12:00:00Z") });
    const old = fake.rows("opportunities").find((item) => item.id === "old")!;
    check("rattrapage : l'offre récente est analysée, l'ancienne (> 48 h) reste « Non analysée »", done === 1 && row.analysis_state === "ok" && row.fit_score === 6 && old.analysis_state === NOT_ANALYZED, { done, row: row.analysis_state, old: old.analysis_state });
    resetOpenAiHealth();
  }

  console.log(failures === 0 ? "\nTous les tests du garde-fou OpenAI passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

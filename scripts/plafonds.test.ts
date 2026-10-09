/**
 * Plafonds de dépense réels (03/10/2026) : Pappers par jour, OpenAI par mois.
 * Fixtures seulement : faux compteurs, fausse base, aucun appel réseau.
 * `npm run test:plafonds`
 */
import { fetchPappers } from "../lib/enrichment/pappers";
import { openAiGuarded, relancesStep } from "../lib/jobs/handlers/prepare";
import { prepCost } from "../lib/usage/prep-cost";
import { budgets } from "../lib/settings/costs";
import { prepareAlert } from "../lib/today/auto-run";
import {
  DEFAULT_OPENAI_MONTHLY_BUDGET_EUR,
  DEFAULT_PAPPERS_DAILY_BUDGET,
  openAiBudgetState,
  openAiMonthlyCap,
  pappersDailyBudget,
  pappersGate,
  parisDayStart,
  parisMonthStart,
} from "../lib/usage/budgets";
import { openAiBudget, pappersAllowance } from "../lib/usage/budgets-server";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-03T10:00:00Z"); // samedi 12 h à Paris

async function main() {
  console.log("\n1. Pappers : plafond par jour (minuit Paris)");
  {
    check("défaut : 24 crédits / jour (≈ 500 / mois)", pappersDailyBudget({}) === DEFAULT_PAPPERS_DAILY_BUDGET && DEFAULT_PAPPERS_DAILY_BUDGET === 24);
    check("PAPPERS_DAILY_BUDGET=0 : Pappers coupé", !pappersGate(0, pappersDailyBudget({ PAPPERS_DAILY_BUDGET: "0" })).allowed);
    check("39/40 : permis ; 40/40 : refusé, motif lisible", pappersGate(39, 40).allowed && !pappersGate(40, 40).allowed && /40\/40/.test((pappersGate(40, 40) as { reason: string }).reason));
    check("minuit Paris (UTC+2 en octobre)", parisDayStart(NOW).toISOString() === "2026-10-02T22:00:00.000Z");

    const db = new FakeDb({
      api_usage: [
        ...Array.from({ length: 39 }, (_, i) => ({ id: `t${i}`, service: "pappers", units: 1, cost: 0, created_at: "2026-10-03T06:00:00Z" })),
        { id: "minuit", service: "pappers", units: 1, cost: 0, created_at: "2026-10-02T22:30:00Z" }, // 00 h 30 Paris : aujourd'hui
        { id: "hier", service: "pappers", units: 1, cost: 0, created_at: "2026-10-02T21:30:00Z" }, // 23 h 30 Paris la veille
        { id: "h", service: "hunter", units: 5, cost: 0, created_at: "2026-10-03T06:00:00Z" },
      ],
    });
    const gate = await pappersAllowance({ db: db as never, now: NOW, env: {} });
    check("compteur réel : 40 crédits aujourd'hui (la veille et Hunter exclus) → refusé", !gate.allowed && gate.used === 40, gate);

    process.env.PAPPERS_API_KEY = "cle-de-test";
    let called = 0;
    const fakeJson = (async () => ((called += 1), { ok: true, data: {} })) as never;
    // Sans cache : ce test ne vérifie que le plafond (le cache 30 j est testé dans test:volume).
    const cache = { read: async () => null, write: async () => undefined };
    const blocked = await fetchPappers("520644386", { allowance: async () => ({ allowed: false, reason: "budget Pappers du jour atteint (40/40) : repli gratuit, reprise demain" }), fetchJson: fakeJson, cache });
    check("au point d'appel : aucun appel Pappers au-delà du plafond", !blocked.ok && called === 0 && /repli gratuit/.test((blocked as { error: string }).error), blocked);
    const allowed = await fetchPappers("520644386", { allowance: async () => ({ allowed: true }), fetchJson: fakeJson, cache });
    check("sous le plafond : l'appel part", called === 1 && allowed.ok, allowed);
    const broken = await fetchPappers("520644386", { allowance: async () => { throw new Error("base muette"); }, fetchJson: fakeJson, cache });
    check("compteur en panne : on n'empêche pas l'appel (jamais de blocage de l'entonnoir)", called === 2 && broken.ok);
    delete process.env.PAPPERS_API_KEY;
  }

  console.log("\n2. OpenAI : plafond mensuel réel (défaut 15 €)");
  {
    check("défaut : 15 €", openAiMonthlyCap({}) === DEFAULT_OPENAI_MONTHLY_BUDGET_EUR && DEFAULT_OPENAI_MONTHLY_BUDGET_EUR === 15);
    check("79 % : rien", openAiBudgetState(11.85, 15).level === "ok");
    const alert = openAiBudgetState(12, 15);
    check("80 % : alerte (Cockpit › Pilotage)", alert.level === "alerte" && /80 %/.test(alert.message ?? ""), alert);
    const cap = openAiBudgetState(15.2, 15);
    check("100 % : plafond, préparation arrêtée", cap.level === "plafond" && /arrêtée/.test(cap.message ?? ""), cap);
    check("mois de Paris : 1er octobre 00 h", parisMonthStart(NOW).toISOString() === "2026-09-30T22:00:00.000Z");
    const db = new FakeDb({
      api_usage: [
        { id: "o1", service: "openai", units: 1, cost: 10, created_at: "2026-10-01T08:00:00Z" },
        { id: "o2", service: "openai", units: 1, cost: 5.5, created_at: "2026-10-02T08:00:00Z" },
        { id: "sept", service: "openai", units: 1, cost: 99, created_at: "2026-09-30T21:00:00Z" }, // 23 h Paris le 30/09
      ],
    });
    const state = await openAiBudget({ db: db as never, now: NOW, env: {} });
    check("dépense du mois lue en base : 15,50 € → plafond", state.level === "plafond" && state.spent === 15.5, state);
  }

  console.log("\n3. Préparation : arrêt propre à 100 %");
  {
    let ran = 0;
    const step = async () => ((ran += 1), { progress: { step: "fait", pct: 50, counts: { scanned: 0, signals: 0, sheets: 0 } } });
    const ctx = { db: new FakeDb({}) as never, userId: "u1", job: { id: "j", params: {}, state: {}, result: {}, user_id: "u1", created_at: "" } } as never;
    const stopped = await openAiGuarded(step as never, async () => openAiBudgetState(15, 15))(ctx);
    check("plafond : l'étape payante ne tourne pas, le job se termine", ran === 0 && stopped.done === true, stopped);
    check("… avec le motif en avancement (affiché par « Lancer maintenant »)", /Plafond OpenAI/.test(stopped.progress?.step ?? ""), stopped.progress);
    const normal = await openAiGuarded(step as never, async () => openAiBudgetState(3, 15))(ctx);
    check("sous le plafond : l'étape tourne normalement", ran === 1 && !normal.done);
    // Plafond OpenAI PAR JOB (Cowork #44) : 0,5 € par défaut, réglable.
    const capped = await openAiGuarded(step as never, async () => openAiBudgetState(3, 15), async () => 0.52)(ctx);
    check("plafond du job (0,5 € par défaut) atteint : arrêt propre, avertissement dans le bilan", ran === 1 && capped.done === true && /Plafond OpenAI du job atteint \(0\.52 € \/ 0\.50 €\)/.test(capped.progress?.step ?? ""), capped.progress);
    const roomy = { ...(ctx as object), job: { id: "j", params: { openaiCapEur: 2 }, state: {}, result: {}, user_id: "u1", created_at: "" } } as never;
    const under = await openAiGuarded(step as never, async () => openAiBudgetState(3, 15), async () => 0.52)(roomy);
    check("plafond réglé à 2 € : l'étape tourne", ran === 2 && !under.done);
    check("coût de préparation : la rédaction est exclue", Math.abs(prepCost([{ operation: "facts", cost: 0.1 }, { operation: "qualite:redaction", cost: 1 }, { operation: "strategie", cost: 0.5 }, { operation: "relance", cost: 0.02 }]) - 0.12) < 1e-9);
    // « Sans brouillons » : aucune relance rédigée (07/10 : 14 relances dans un lot sans brouillons).
    const noDraft = await relancesStep({ db: new FakeDb({}) as never, userId: "u1", job: { id: "j", params: { skipDrafts: true }, state: {}, result: {}, user_id: "u1", created_at: "" } } as never);
    check("préparation sans brouillons : les relances ne sont pas rédigées", /non rédigées/.test(noDraft.progress?.step ?? ""), noDraft.progress);
    check("en-tête d'« Aujourd'hui » : motif de l'arrêt affiché", prepareAlert({ status: "done", error: null, at: "x", failedDrafts: 0, firstDraftError: null, stoppedReason: "Plafond OpenAI du mois atteint (15,00 € / 15,00 €)" })?.startsWith("Dernière préparation arrêtée") === true);
  }

  console.log("\n4. Réglages › Coûts : plafonds affichés");
  {
    const list = budgets({}, 50, { pappersUsedToday: 12, openai: { spent: 3.2, cap: 15, ratio: 3.2 / 15 } });
    const pappers = list.find((b) => b.label.startsWith("Pappers — plafond"));
    const openai = list.find((b) => b.label.startsWith("OpenAI — plafond"));
    check("Pappers : 24 crédits / jour, utilisés aujourd'hui", pappers?.value === "24 crédits · 12 utilisés aujourd'hui", pappers);
    check("OpenAI : 15 € / mois, dépense et pourcentage", openai?.value === "15,00 € · 3,20 € dépensés (21 %)", openai);
  }

  console.log(failures === 0 ? "\nTous les tests des plafonds passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

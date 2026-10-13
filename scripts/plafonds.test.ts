/**
 * Plafonds de dépense réels (03/10/2026) : Pappers par jour, OpenAI par mois.
 * Fixtures seulement : faux compteurs, fausse base, aucun appel réseau.
 * `npm run test:plafonds`
 */
import { fetchPappers } from "../lib/enrichment/pappers";
import { openAiGuarded, relancesStep } from "../lib/jobs/handlers/prepare";
import { prepCost, prepCostSince } from "../lib/usage/prep-cost";
import { capArg } from "../lib/cli/args";
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
import { resetDailyViewMemo } from "../lib/usage/usage-daily";

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

    // Vue `api_usage_daily` absente (mode strict) : on vérifie ici le repli ligne à ligne.
    const db = new FakeDb(
      {
        api_usage: [
          ...Array.from({ length: 39 }, (_, i) => ({ id: `t${i}`, service: "pappers", units: 1, cost: 0, created_at: "2026-10-03T06:00:00Z" })),
          { id: "minuit", service: "pappers", units: 1, cost: 0, created_at: "2026-10-02T22:30:00Z" }, // 00 h 30 Paris : aujourd'hui
          { id: "hier", service: "pappers", units: 1, cost: 0, created_at: "2026-10-02T21:30:00Z" }, // 23 h 30 Paris la veille
          { id: "h", service: "hunter", units: 5, cost: 0, created_at: "2026-10-03T06:00:00Z" },
        ],
      },
      { strictTables: true },
    );
    resetDailyViewMemo();
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
    const db = new FakeDb(
      {
        api_usage: [
          { id: "o1", service: "openai", units: 1, cost: 10, created_at: "2026-10-01T08:00:00Z" },
          { id: "o2", service: "openai", units: 1, cost: 5.5, created_at: "2026-10-02T08:00:00Z" },
          { id: "sept", service: "openai", units: 1, cost: 99, created_at: "2026-09-30T21:00:00Z" }, // 23 h Paris le 30/09
        ],
      },
      { strictTables: true },
    );
    resetDailyViewMemo();
    const state = await openAiBudget({ db: db as never, now: NOW, env: {} });
    check("dépense du mois lue en base : 15,50 € → plafond", state.level === "plafond" && state.spent === 15.5, state);

    /*
     * Même décision quand la base agrège (Cowork #22). Le plafond décide d'une
     * dépense : une vue qui agrège à la lecture reste EXACTE, mais il faut le
     * prouver, et prouver aussi que septembre n'entre pas dans le mois.
     */
    resetDailyViewMemo();
    const aggregated = await openAiBudget({
      db: new FakeDb(
        {
          api_usage_daily: [
            { user_id: "u1", day: "2026-10-01", service: "openai", calls: 1, eur: 10, units: 1 },
            { user_id: "u1", day: "2026-10-02", service: "openai", calls: 1, eur: 5.5, units: 1 },
            { user_id: "u1", day: "2026-09-30", service: "openai", calls: 1, eur: 99, units: 1 },
          ],
        },
        { strictTables: true },
      ) as never,
      now: NOW,
      env: {},
    });
    check(
      "vue agrégée : la même dépense, la même décision",
      aggregated.spent === state.spent && aggregated.level === state.level,
      { vue: aggregated, lignes: state },
    );
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
    check("coût de préparation : la rédaction est exclue", Math.abs(prepCost([{ operation: "facts", cost: 0.1 }, { operation: "qualite:redaction", cost: 1 }, { operation: "strategie", cost: 0.5 }, { operation: "entonnoir:tri", cost: 0.02 }]) - 0.12) < 1e-9);
    // Cowork #47 : 09/10, 0,14 € de relances écrites par un autre agent comptées dans le plafond du job.
    check(
      "relances des autres agents (relance:redaction, relance:grille…) hors du plafond du job",
      Math.abs(prepCost([{ operation: "facts", cost: 0.1 }, { operation: "relance:redaction:rewrite", cost: 0.064 }, { operation: "relance:grille:0", cost: 0.002 }, { operation: "relance", cost: 0.02 }]) - 0.1) < 1e-9,
    );
    /*
     * Cowork #23 : au-delà de 1 000 lignes, PostgREST tronque EN SILENCE. Le
     * faux client reproduit ce plafond (`maxRows`) ; sans lui, ce test
     * passerait aussi avec l'ancien `select` non paginé et ne prouverait rien.
     * 2 500 appels de préparation à 0,001 €, plus 300 de rédaction (exclus).
     */
    {
      const since = "2026-10-03T06:00:00Z";
      const rows = [
        ...Array.from({ length: 2_500 }, (_, i) => ({ id: `p${String(i).padStart(5, "0")}`, service: "openai", operation: "facts", cost: 0.001, created_at: "2026-10-03T07:00:00Z" })),
        ...Array.from({ length: 300 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, service: "openai", operation: "qualite:redaction", cost: 0.01, created_at: "2026-10-03T07:00:00Z" })),
        // Avant le début du job : jamais compté.
        { id: "avant", service: "openai", operation: "facts", cost: 5, created_at: "2026-10-03T05:00:00Z" },
      ];
      const capped = new FakeDb({ api_usage: rows }, { maxRows: 1_000 });

      // L'ancienne lecture, telle qu'elle était : un seul `select`, sans pagination.
      const { data: truncated } = await capped.from("api_usage").select("operation, cost").eq("service", "openai").gte("created_at", since);
      check("le piège existe : une lecture non paginée s'arrête à 1 000 lignes", (truncated as unknown[]).length === 1_000, (truncated as unknown[]).length);

      const cost = await prepCostSince(capped as never, since);
      check("garde-fou de la préparation : les 2 500 appels comptés (2,50 €, rédaction exclue)", Math.abs(cost - 2.5) < 1e-9, cost);
    }
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

  console.log("\n5. Plafond en ligne de commande : 0 reste 0 (Cowork #45)");
  check("--hunter-cap 0 → 0 crédit (et non le défaut 40)", capArg("0", 40) === 0);
  check("--hunter-cap 80 → 80", capArg("80", 40) === 80);
  check("absent ou illisible → défaut", capArg(null, 40) === 40 && capArg("abc", 40) === 40 && capArg("", 30) === 30);
  check("négatif → 0", capArg("-5", 40) === 0);

  console.log(failures === 0 ? "\nTous les tests des plafonds passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

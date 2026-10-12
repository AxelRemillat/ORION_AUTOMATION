/**
 * Lot 2b — bloc « Pilotage » du Cockpit : consommation 30 jours, crédits
 * restants, totaux du mois. Fixtures seulement : clés fournisseurs retirées de
 * l'environnement, aucun appel réseau, aucun crédit. `npm run test:pilotage`
 */
import { fetchInpiOpposition, resetInpiToken } from "../lib/enrichment/inpi";
import { buildConsumption, consumptionSince, PROVIDERS, type UsageRow, toDailyRows } from "../lib/usage/consumption";
import { buildCreditTiles, cachedExact, CREDITS_CACHE_MS, hunterCycleStart, hunterNextReset, withinMs } from "../lib/usage/credits";
import { loadPilotage } from "../lib/usage/pilotage";
import { FakeDb } from "./fake-supabase";
import { resetDailyViewMemo, sumDaily } from "../lib/usage/usage-daily";

for (const key of ["HUNTER_API_KEY", "PAPPERS_API_KEY", "OPENAI_MONTHLY_BUDGET_EUR", "ORION_SCRIPT_USER_ID"]) delete process.env[key];

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-03T10:00:00Z"); // samedi 3 octobre, 12 h à Paris

const usage: UsageRow[] = [
  { service: "openai", units: 12_000, cost: 0.6, created_at: "2026-10-03T08:00:00Z" },
  { service: "openai", units: 3_000, cost: 0.15, created_at: "2026-10-02T09:00:00Z" },
  { service: "hunter", units: 1, cost: 0.025, created_at: "2026-10-02T09:05:00Z" },
  { service: "hunter", units: 1, cost: 0.025, created_at: "2026-10-01T09:05:00Z" }, // avant le 2 : cycle précédent
  { service: "pappers", units: 1, cost: 0.06, created_at: "2026-10-02T22:30:00Z" }, // 00 h 30 le 03 à Paris
  { service: "linkup", units: 1, cost: 0.0046, created_at: "2026-09-20T10:00:00Z" },
  { service: "openai", units: 99_000, cost: 9, created_at: "2026-08-20T10:00:00Z" }, // hors fenêtre et hors mois
];
const free = [
  { service: "inpi", units: 1, created_at: "2026-10-03T07:00:00Z" },
  { service: "inpi", units: 1, created_at: "2026-10-03T07:01:00Z" },
];

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n1. Consommation 30 jours (barres empilées, jours de Paris)");
  {
    const c = buildConsumption(usage, free, NOW);
    const today = c.days.at(-1)!;
    const yesterday = c.days.at(-2)!;
    check("30 barres, la dernière = aujourd'hui (Paris)", c.days.length === 30 && today.day === "2026-10-03" && c.days[0].day === "2026-09-04", [c.days[0].day, today.day]);
    check("Pappers à 22 h 30 UTC le 02 compte le 03 (minuit passé à Paris)", today.calls.pappers === 1 && yesterday.calls.pappers === 0);
    check("requêtes empilées par fournisseur", today.calls.openai === 1 && today.calls.gratuit === 2 && yesterday.calls.hunter === 1 && yesterday.calls.openai === 1);
    check("€ empilés par fournisseur", Math.abs(today.eur.openai - 0.6) < 1e-9 && Math.abs(today.eur.pappers - 0.06) < 1e-9);
    check("INPI / gratuits : requêtes comptées, 0 €", today.eur.gratuit === 0 && c.window.calls.gratuit === 2);
    check("tokens OpenAI du jour", today.tokens === 12_000 && c.window.tokens === 15_000);
    check("ligne d'août : hors fenêtre", c.window.calls.openai === 2);
    check("tous les fournisseurs présents (même à zéro)", PROVIDERS.every((p) => p in today.calls));
  }

  console.log("\n2. Totaux du mois et projection");
  {
    const c = buildConsumption(usage, free, NOW);
    // Octobre : 0,6 + 0,15 + 0,025 + 0,025 + 0,06 = 0,86 € ; septembre et août exclus.
    check("dépense du mois (octobre, Paris)", c.month.eur === 0.86 && c.month.label.startsWith("octobre"), c.month);
    check("projection = dépense ÷ 3 jours × 31", c.month.daysElapsed === 3 && c.month.daysInMonth === 31 && c.month.projection === Math.round((0.86 / 3) * 31 * 100) / 100, c.month);
    check("lecture en base : couvre la fenêtre ET le mois", consumptionSince(NOW) <= "2026-09-04T00:00:00Z");
    const empty = buildConsumption([], [], NOW);
    check("état vide : signalé, totaux à 0, projection 0", empty.empty && empty.month.eur === 0 && empty.month.projection === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Crédits restants");
  {
    check("cycle Hunter : le 1er octobre appartient au cycle du 2 septembre", hunterCycleStart(new Date("2026-10-01T10:00:00Z")) === "2026-09-02");
    check("cycle Hunter : le 2 octobre ouvre un nouveau cycle", hunterCycleStart(new Date("2026-10-02T10:00:00Z")) === "2026-10-02");
    check("prochaine remise à zéro : 2 novembre", hunterNextReset(NOW) === "2026-11-02");

    const estimated = buildCreditTiles({ hunterUsed: 120, pappersUsed: 40, openaiEur: 3.2, hunterExact: null, pappersExact: null, openaiBudget: null, now: NOW });
    const hunter = estimated.find((t) => t.key === "hunter")!;
    const pappers = estimated.find((t) => t.key === "pappers")!;
    const openai = estimated.find((t) => t.key === "openai")!;
    check("Hunter sans API : 2000 − 120, « estimé », remise à zéro dite", hunter.remaining === 1880 && hunter.total === 2000 && hunter.quality === "estime" && hunter.basis.includes("2 novembre"), hunter);
    check("Pappers sans API : 500 − 40, « estimé »", pappers.remaining === 460 && pappers.quality === "estime", pappers);
    check("OpenAI sans budget : dépense du mois, rien d'inventé", openai.remaining === null && openai.used === 3.2, openai);

    const exact = buildCreditTiles({ hunterUsed: 120, pappersUsed: 40, openaiEur: 3.2, hunterExact: { remaining: 1700, total: 2000 }, pappersExact: { remaining: 498, total: 500 }, openaiBudget: 20, now: NOW });
    check("solde exposé par l'API : utilisé tel quel, « exact »", exact[0].remaining === 1700 && exact[0].quality === "exact" && exact[1].remaining === 498 && exact[1].quality === "exact");
    check("OpenAI avec budget : reste estimé", exact[2].remaining === 16.8 && exact[2].quality === "estime");
  }

  console.log("\n4. Cache ≥ 1 h, jamais d'attente sur un fournisseur");
  {
    const store = new Map<string, { value: unknown; ttl: number }>();
    const cache = {
      read: async <T,>(key: string) => (store.get(key)?.value as T) ?? null,
      write: async (key: string, value: unknown, ttl?: number) => void store.set(key, { value, ttl: ttl ?? 0 }),
    };
    let calls = 0;
    const fetcher = async () => ((calls += 1), { remaining: 10, total: 500 });
    const first = await cachedExact("pappers", fetcher, cache as never);
    const second = await cachedExact("pappers", fetcher, cache as never);
    check("deuxième lecture servie par le cache (un seul appel fournisseur)", calls === 1 && first?.remaining === 10 && second?.remaining === 10);
    check("durée du cache : 1 h", store.get("credits:pappers")?.ttl === CREDITS_CACHE_MS && CREDITS_CACHE_MS >= 3_600_000);
    let failing = 0;
    await cachedExact("hunter", async () => ((failing += 1), null), cache as never);
    await cachedExact("hunter", async () => ((failing += 1), null), cache as never);
    check("échec aussi mis en cache : pas de martèlement de l'API", failing === 1);
    const slow = new Promise<number>((done) => setTimeout(() => done(1), 2_000));
    const started = Date.now();
    check("fournisseur lent : on n'attend pas (repli)", (await withinMs(slow, 50, -1)) === -1 && Date.now() - started < 1_000);
  }

  console.log("\n5. Chargement serveur (agrégats) et journalisation INPI");
  {
    /*
     * `strictTables` : les vues `*_daily` n'existent PAS dans cette base de
     * test, et PostgREST rendrait une erreur. On vérifie ici le repli ligne à
     * ligne ; le chemin agrégé est vérifié juste après, avec les mêmes chiffres.
     */
    const db = new FakeDb(
      {
        api_usage: usage.map((row, index) => ({ id: `u${index}`, user_id: "u1", operation: "x", ...row })),
        free_api_calls: free.map((row, index) => ({ id: `f${index}`, user_id: "u1", operation: "companies", ...row })),
      },
      { strictTables: true },
    );
    const started = Date.now();
    const pilotage = await loadPilotage(db, NOW);
    check("agrégats calculés côté serveur (sans clé : estimations, aucun réseau)", pilotage.consumption.window.calls.gratuit === 2 && pilotage.credits.every((t) => t.key === "openai" || t.quality === "estime"), pilotage.credits.map((t) => t.quality));
    check("Hunter : seulement les recherches depuis le 2 (1, pas 2)", pilotage.credits[0].used === 1, pilotage.credits[0]);
    check("Pappers : consommation du mois", pilotage.credits[1].used === 1);
    check("chargement rapide (< 1 s sur fixtures)", Date.now() - started < 1_000, Date.now() - started);
    const noTable = await loadPilotage(new FakeDb({ api_usage: [] }, { strictTables: true }), NOW);
    check("table des gratuits absente (avant migration) : rien ne casse", noTable.consumption.empty);

    /*
     * Chemin RAPIDE (Cowork #22) : la base agrège, l'app ne relit plus
     * 12 000 lignes. Les journées fournies ici sont celles que produit
     * `toDailyRows` — c'est-à-dire, au `group by` près, ce que rend la vue
     * `api_usage_daily` (migration 20261012153000).
     */
    // Le module retient 60 s l'absence d'une vue (pour ne pas la redemander à
    // chaque affichage) : on l'oublie, sinon ce cas repartirait sur le repli.
    resetDailyViewMemo();
    const daily = toDailyRows(usage, free);
    const aggregated = await loadPilotage(
      new FakeDb(
        {
          api_usage_daily: daily.filter((row) => row.service !== "gratuit").map((row) => ({ user_id: "u1", ...row })),
          free_api_calls_daily: daily.filter((row) => row.service === "gratuit").map((row) => ({ user_id: "u1", ...row })),
        },
        { strictTables: true },
      ),
      NOW,
    );
    check(
      "vues agrégées : exactement les mêmes chiffres que la lecture ligne à ligne",
      JSON.stringify(aggregated.consumption) === JSON.stringify(pilotage.consumption),
      { agrege: aggregated.consumption.window, lignes: pilotage.consumption.window },
    );
    check(
      "et les mêmes compteurs de crédits (unités, pas nombre d'appels)",
      JSON.stringify(aggregated.credits.map((tile) => tile.used)) === JSON.stringify(pilotage.credits.map((tile) => tile.used)),
      { agrege: aggregated.credits.map((tile) => tile.used), lignes: pilotage.credits.map((tile) => tile.used) },
    );

    resetInpiToken();
    process.env.INPI_USERNAME = "test@example.com";
    process.env.INPI_PASSWORD = "test";
    const recorded: string[] = [];
    const fakeFetch = (async (url: string) =>
      String(url).endsWith("/sso/login")
        ? new Response(JSON.stringify({ token: "t" }), { status: 200 })
        : new Response(JSON.stringify({ formality: { diffusionCommerciale: true } }), { status: 200 })) as unknown as typeof fetch;
    await fetchInpiOpposition("520644386", fakeFetch, 0, async (entry) => void recorded.push(`${entry.service}:${entry.operation}`));
    check("appel INPI réel → une ligne « inpi » journalisée", recorded.length === 1 && recorded[0] === "inpi:companies", recorded);
  }

  console.log("\n6. Compteurs de plafond : la base somme, et reste exacte");
  {
    resetDailyViewMemo();
    const db = new FakeDb(
      {
        api_usage_daily: [
          { user_id: "u1", day: "2026-10-01", service: "openai", calls: 10, eur: 1.5, units: 1000 },
          { user_id: "u1", day: "2026-10-02", service: "openai", calls: 5, eur: 0.75, units: 500 },
          { user_id: "u1", day: "2026-10-02", service: "pappers", calls: 3, eur: 0, units: 3 },
          // Septembre : hors borne, ne doit jamais entrer dans la somme du mois.
          { user_id: "u1", day: "2026-09-30", service: "openai", calls: 99, eur: 99, units: 99 },
        ],
      },
      { strictTables: true },
    );
    const spent = await sumDaily(db, "openai", "2026-10-01", "eur");
    check("dépense OpenAI du mois : 1,50 + 0,75 (septembre exclu)", spent === 2.25, spent);
    check("unités Pappers du jour", (await sumDaily(db, "pappers", "2026-10-02", "units")) === 3);
    check("borne incluse : le jour même compte", (await sumDaily(db, "openai", "2026-10-02", "eur")) === 0.75);

    resetDailyViewMemo();
    const absente = await sumDaily(new FakeDb({ api_usage: [] }, { strictTables: true }), "openai", "2026-10-01", "eur");
    check("vue absente : `null`, l'appelant relit ligne à ligne (jamais 0 par défaut)", absente === null, absente);
  }

  console.log(failures === 0 ? "\nTous les tests du Pilotage passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

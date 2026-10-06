/**
 * Économie Hunter (01/10/2026) — un run avait épuisé les crédits d'un coup.
 *
 *  - garde-fou (lib/hunter/gate.ts) : cache 90 jours, budget du jour compté
 *    depuis minuit à Paris, arrêt jusqu'au lendemain sur crédits épuisés ;
 *  - feu vert d'une fiche (lib/contact-finder/policy.ts) : score ≥ 4, registre
 *    lu, ni opposition, ni plus de 249 salariés, ni filiale de groupe ;
 *  - creusage (lib/funnel/dig.ts, stages.ts) : aucun contact cherché avant le
 *    contrôle, aucune reprise « à compléter » quand Hunter est bloqué.
 *
 * Données inventées, aucun réseau. Exécution : `npm run test:hunter`.
 */
import {
  DEFAULT_HUNTER_DAILY_BUDGET,
  HUNTER_CACHE_TTL_MS,
  gatedHunterCall,
  hunterCacheKey,
  hunterDailyBudget,
  hunterStatus,
  parisMidnight,
  resetHunterGate,
  type HunterGateStore,
} from "../lib/hunter/gate";
import { hunterPolicy } from "../lib/contact-finder/policy";
import { digOne, type DigCandidate, type DigDeps } from "../lib/funnel/dig";
import { runDigStage } from "../lib/funnel/stages";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Faux accès : cache en mémoire, compteur du jour réglable. */
function fakeStore(usedToday = 0) {
  const cache = new Map<string, { value: unknown; ttl: number }>();
  const store: HunterGateStore & { cache: typeof cache; used: number } = {
    cache,
    used: usedToday,
    async read<T>(key: string) {
      return (cache.get(key)?.value as T) ?? null;
    },
    async write(key, value, ttl) {
      cache.set(key, { value, ttl });
    },
    async usedSince() {
      return store.used;
    },
  };
  return store;
}

const NOON = new Date("2026-10-01T10:00:00Z"); // midi à Paris

async function main() {
  const previousBudget = process.env.HUNTER_DAILY_BUDGET;

  console.log("1. Garde-fou Hunter");
  {
    resetHunterGate();
    delete process.env.HUNTER_DAILY_BUDGET;
    check("budget par défaut : 80 (contacts nominatifs, 06/10)", hunterDailyBudget() === DEFAULT_HUNTER_DAILY_BUDGET && DEFAULT_HUNTER_DAILY_BUDGET === 80);
    check("budget paramétrable", hunterDailyBudget({ HUNTER_DAILY_BUDGET: "3" }) === 3);
    check("budget 0 = Hunter coupé", hunterDailyBudget({ HUNTER_DAILY_BUDGET: "0" }) === 0);
    check("valeur illisible → défaut", hunterDailyBudget({ HUNTER_DAILY_BUDGET: "beaucoup" }) === DEFAULT_HUNTER_DAILY_BUDGET);

    check(
      "clé de cache : sans clé d'API, normalisée, triée",
      hunterCacheKey("domain-search", { limit: "10", domain: " Exemple.FR ", api_key: "secret" }) === "hunter:domain-search:domain=exemple.fr&limit=10",
      hunterCacheKey("domain-search", { limit: "10", domain: " Exemple.FR ", api_key: "secret" }),
    );

    check("minuit à Paris, heure d'été (UTC+2)", parisMidnight(NOON).toISOString() === "2026-09-30T22:00:00.000Z", parisMidnight(NOON).toISOString());
    check(
      "minuit à Paris, heure d'hiver (UTC+1)",
      parisMidnight(new Date("2026-12-15T10:00:00Z")).toISOString() === "2026-12-14T23:00:00.000Z",
      parisMidnight(new Date("2026-12-15T10:00:00Z")).toISOString(),
    );

    // Premier appel : facturé, et sa réponse mise en cache 90 jours.
    const store = fakeStore(0);
    let calls = 0;
    const call = async () => {
      calls += 1;
      return { data: { emails: ["a@exemple.fr"] }, quotaExceeded: false };
    };
    const first = await gatedHunterCall(store, "hunter:domain-search:domain=exemple.fr", call, NOON);
    check("1er appel : fait", first.status === "appel" && calls === 1);
    check("… réponse mise en cache 90 jours", store.cache.get("hunter:domain-search:domain=exemple.fr")?.ttl === HUNTER_CACHE_TTL_MS);
    const second = await gatedHunterCall(store, "hunter:domain-search:domain=exemple.fr", call, NOON);
    check("même domaine : relu dans le cache, aucun appel", second.status === "cache" && calls === 1);

    // Une panne n'est pas mise en cache.
    const failed = fakeStore(0);
    await gatedHunterCall(failed, "k", async () => ({ data: null, quotaExceeded: false }), NOON);
    check("panne : rien en cache", failed.cache.size === 0);

    // Budget du jour atteint : aucun appel.
    process.env.HUNTER_DAILY_BUDGET = "2";
    const spent = fakeStore(2);
    let blockedCalls = 0;
    const blocked = await gatedHunterCall(spent, "k2", async () => {
      blockedCalls += 1;
      return { data: {}, quotaExceeded: false };
    }, NOON);
    check("budget du jour atteint : bloqué, aucun appel", blocked.status === "bloque" && blockedCalls === 0, JSON.stringify(blocked));
    check("… motif « Hunter épuisé »", blocked.status === "bloque" && blocked.reason.startsWith("Hunter épuisé") && blocked.reason.includes("2/2"));
    // Le cache reste servi même budget épuisé : il ne coûte rien.
    spent.cache.set("k3", { value: { ok: true }, ttl: 1 });
    check("budget épuisé : le cache reste servi", (await gatedHunterCall(spent, "k3", async () => ({ data: null, quotaExceeded: false }), NOON)).status === "cache");

    // Crédits épuisés (429) : plus d'appel jusqu'à minuit à Paris.
    process.env.HUNTER_DAILY_BUDGET = "10";
    resetHunterGate();
    const quota = fakeStore(0);
    await gatedHunterCall(quota, "k4", async () => ({ data: null, quotaExceeded: true }), NOON);
    let after = 0;
    const sameDay = await gatedHunterCall(quota, "k5", async () => {
      after += 1;
      return { data: {}, quotaExceeded: false };
    }, new Date("2026-10-01T21:30:00Z")); // 23h30 à Paris
    check("429 : bloqué jusqu'à minuit (23h30 à Paris)", sameDay.status === "bloque" && after === 0, JSON.stringify(sameDay));
    const nextDay = await gatedHunterCall(quota, "k6", async () => {
      after += 1;
      return { data: {}, quotaExceeded: false };
    }, new Date("2026-10-01T22:30:00Z")); // 00h30 à Paris, le 02/10
    check("… et de nouveau autorisé après minuit à Paris", nextDay.status === "appel" && after === 1, JSON.stringify(nextDay));

    resetHunterGate(); // le 429 simulé ci-dessus bloque encore le 01/10
    const status = await hunterStatus(fakeStore(4), NOON);
    check("état du jour pour le bandeau", status.usedToday === 4 && status.budget === 10 && status.remaining === 6 && status.blocked === null, JSON.stringify(status));
    resetHunterGate();
  }

  console.log("\n2. Feu vert Hunter d'une fiche");
  {
    const funnel = { funnel_run_id: "run1", pappers_read: true };
    check("score 4, registre lu, rien à redire : autorisé", hunterPolicy({ ...funnel, funnel_score: 4 }).allowed);
    const low = hunterPolicy({ ...funnel, funnel_score: 3 });
    check("score 3 : refusé", !low.allowed && low.reason.includes("score 3/5"), JSON.stringify(low));
    const unread = hunterPolicy({ funnel_run_id: "run1", funnel_score: 5 });
    check("entonnoir sans Pappers lu : refusé", !unread.allowed && unread.reason.includes("registre non lu"), JSON.stringify(unread));
    const free = hunterPolicy({ funnel_run_id: "run1", funnel_score: 5, registry_source: "gratuit", opposition_checked: true });
    check("repli gratuit, opposition vérifiée par l'INPI : autorisé", free.allowed, JSON.stringify(free));
    const unchecked = hunterPolicy({ funnel_run_id: "run1", funnel_score: 5, registry_source: "gratuit", opposition_checked: false });
    check("opposition non vérifiée : Hunter attend", !unchecked.allowed && unchecked.reason.includes("non vérifiée"), JSON.stringify(unchecked));
    const legacy = hunterPolicy({ funnel_score: 5 });
    check("fiche manuelle sans le champ : inchangé, autorisé", legacy.allowed, JSON.stringify(legacy));
    const opposed = hunterPolicy({ ...funnel, funnel_score: 5, refuses_prospecting: true });
    check("opposition à la prospection : refusé", !opposed.allowed && opposed.reason.includes("opposition"), JSON.stringify(opposed));
    const big = hunterPolicy({ ...funnel, funnel_score: 5, headcount: 1200 });
    check("plus de 249 salariés (cas TÉRÉVA) : refusé", !big.allowed && big.reason.includes("1200 salariés"), JSON.stringify(big));
    check("filiale de groupe étranger : refusé", !hunterPolicy({ ...funnel, funnel_score: 5, parent_foreign: true }).allowed);
    check("fiche créée à la main, sans registre : autorisée", hunterPolicy({}).allowed && hunterPolicy(null).allowed);
  }

  console.log("\n3. Creusage : le contrôle AVANT toute recherche de contact");
  {
    const candidate = { id: "c1", signal: {}, base: { company_name: "EXEMPLE" }, triage: { score: 5 }, weight: 1 } as unknown as DigCandidate;
    const run = async (figures: Record<string, unknown>) => {
      const seen = { created: 0, contact: 0 };
      const deps: DigDeps = {
        enrich: async () => ({ company_name: "EXEMPLE", key_figures: figures, signals: [], warnings: [] }) as never,
        createProspect: async () => {
          seen.created += 1;
          return { id: "p1" };
        },
        findContact: async () => {
          seen.contact += 1;
          return { confidence: 0, found_by: "aucun" };
        },
        brief: async () => undefined,
      };
      const outcome = await digOne(deps, candidate);
      return { outcome, seen };
    };
    const opposed = await run({ pappers_read: true, refuses_prospecting: true });
    check("opposée : écartée, AUCUNE recherche de contact", opposed.seen.contact === 0 && opposed.seen.created === 0 && Boolean(opposed.outcome.skipped));
    const big = await run({ pappers_read: true, headcount: 1200 });
    check("1 200 salariés : écartée, AUCUNE recherche de contact", big.seen.contact === 0 && Boolean(big.outcome.skipped), JSON.stringify(big.outcome));
    const unread = await run({});
    // Repli gratuit (02/10/2026) : publiée « opposition non vérifiée » ; Hunter
    // reste refusé par `hunterPolicy` (opposition_checked: false), le gratuit tourne.
    check(
      "registre non lu : publiée « opposition non vérifiée », sans erreur",
      unread.seen.created === 1 && unread.outcome.error === null && unread.outcome.oppositionUnverified === true,
      JSON.stringify(unread.outcome),
    );
    const ok = await run({ pappers_read: true, headcount: 40 });
    check("PME de 40 salariés : contact cherché", ok.seen.contact === 1);
  }

  console.log("\n4. Reprise des fiches « à compléter » quand Hunter est bloqué");
  {
    const fake = new FakeDb({
      signal_candidates: [
        { id: "s1", user_id: "u1", run_id: "ancien", statut: "creusé", publication: "a_completer", prospect_id: "p1", contact: null, motif_rejet: null },
      ],
    });
    let contacts = 0;
    const deps: DigDeps = {
      enrich: async () => {
        throw new Error("aucun creusage attendu");
      },
      createProspect: async () => ({ error: "aucune création attendue" }),
      findContact: async () => {
        contacts += 1;
        return { confidence: 0, found_by: "aucun" };
      },
      brief: async () => undefined,
      hunterBlocked: async () => "Hunter épuisé : budget du jour atteint (10/10)",
    };
    const out = await runDigStage(fake as never, "u1", "run2", { deps, limit: 15, perStep: 4 });
    check("Hunter bloqué : aucune reprise, aucune recherche payée", contacts === 0 && out.retried === 0, JSON.stringify(out));
  }

  if (previousBudget === undefined) delete process.env.HUNTER_DAILY_BUDGET;
  else process.env.HUNTER_DAILY_BUDGET = previousBudget;

  if (failures) {
    console.log(`\n${failures} échec(s).`);
    process.exit(1);
  }
  console.log("\nTous les tests d'économie Hunter passent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

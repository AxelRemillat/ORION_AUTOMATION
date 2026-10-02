/**
 * Repli gratuit quand Pappers est épuisé (02/10/2026) : opposition lue à
 * l'INPI, entonnoir jamais bloqué, « opposition non vérifiée » qui bloque la
 * programmation, revérification au run suivant, bandeau. Fixtures seulement :
 * aucun appel réseau, aucun crédit. Exécution : `npm run test:registre`.
 */
import { readFileSync } from "node:fs";
import { fetchInpiOpposition, readOpposition, resetInpiToken } from "../lib/enrichment/inpi";
import { hunterPolicy } from "../lib/contact-finder/policy";
import { digOne, type DigCandidate, type DigDeps } from "../lib/funnel/dig";
import { recheckOppositions } from "../lib/funnel/stages";
import { registryLabel, registryUsage } from "../lib/funnel/registry";
import { toCard } from "../lib/funnel/view";
import { pappersRemaining } from "../lib/usage/balances";
import { scheduleMessage } from "../lib/outbox/scheduler";
import { confirmOppositionManually, oppositionUnverified } from "../lib/outbox/opposition-check";
import type { Db } from "../lib/trash/scope";
import type { SignalCandidateRow } from "../types";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const fixture = (siren: string) => JSON.parse(readFileSync(`scripts/fixtures/inpi/${siren}.json`, "utf8")) as unknown;

/** API RNE simulée : login, puis fiches lues dans les fixtures. */
function inpiServer(options: { expireFirst?: boolean; quota?: boolean } = {}) {
  const calls: { url: string; auth: string | null; body: string | null }[] = [];
  let expired = options.expireFirst ?? false;
  let logins = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("Authorization"), body: init?.body ? String(init.body) : null });
    if (url.endsWith("/api/sso/login")) {
      logins += 1;
      return new Response(JSON.stringify({ token: `jeton-${logins}`, user: { id: 1 } }), { status: 200 });
    }
    if (options.quota) return new Response("{}", { status: 429 });
    if (expired) {
      expired = false;
      return new Response(JSON.stringify({ code: "401" }), { status: 401 });
    }
    const siren = url.split("/").pop() as string;
    try {
      return new Response(JSON.stringify(fixture(siren)), { status: 200 });
    } catch {
      return new Response("{}", { status: 404 });
    }
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, logins: () => logins };
}

async function main() {
  const previous = { user: process.env.INPI_USERNAME, pass: process.env.INPI_PASSWORD };
  process.env.INPI_USERNAME = "test@example.com";
  process.env.INPI_PASSWORD = "secret-de-test";

  // -------------------------------------------------------------------------
  console.log("\n1. INPI : le champ diffusionCommerciale (trois cas connus)");
  {
    check("SELECTION HABITAT (453450256) : opposée", readOpposition(fixture("453450256")) === true);
    check("ADJUVOO (898001029) : opposée", readOpposition(fixture("898001029")) === true);
    check("ARTFLEX (520644386) : non opposée", readOpposition(fixture("520644386")) === false);
    check("champ absent : non vérifié (null), jamais « non opposée »", readOpposition({ formality: { siren: "1" } }) === null);
    check("champ à la racine : lu aussi", readOpposition({ diffusionCommerciale: false }) === true);
    check("diffusionINSEE seul ne dit rien de la prospection", readOpposition({ formality: { diffusionINSEE: "N" } }) === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. INPI : client (connexion, jeton, quota)");
  {
    resetInpiToken();
    const server = inpiServer();
    const selection = await fetchInpiOpposition("453450256", server.fetchImpl, 0);
    const artflex = await fetchInpiOpposition("520 644 386", server.fetchImpl, 1_000);
    check("SELECTION HABITAT lue opposée", selection.ok && selection.refuses === true, selection);
    check("ARTFLEX lue non opposée (SIREN avec espaces)", artflex.ok && artflex.refuses === false, artflex);
    check("une seule connexion pour deux fiches (jeton réutilisé)", server.logins() === 1);
    const company = server.calls.find((call) => call.url.includes("/companies/"));
    check("jeton envoyé en « Authorization: Bearer »", company?.auth === "Bearer jeton-1", company?.auth);
    check("identifiants envoyés en JSON au login", server.calls[0].body === JSON.stringify({ username: "test@example.com", password: "secret-de-test" }));

    resetInpiToken();
    const expiring = inpiServer({ expireFirst: true });
    const retried = await fetchInpiOpposition("898001029", expiring.fetchImpl, 0);
    check("jeton expiré (401) : une reconnexion, puis la fiche", retried.ok && retried.refuses === true && expiring.logins() === 2, retried);

    resetInpiToken();
    const quota = await fetchInpiOpposition("520644386", inpiServer({ quota: true }).fetchImpl, 0);
    check("quota du jour (429) : non vérifié, sans exception", !quota.ok && quota.error.includes("quota"), quota);

    resetInpiToken();
    delete process.env.INPI_PASSWORD;
    const noCreds = await fetchInpiOpposition("520644386", inpiServer().fetchImpl, 0);
    check("identifiants absents : non vérifié, aucun appel", !noCreds.ok && noCreds.error.includes("INPI_USERNAME"), noCreds);
    process.env.INPI_PASSWORD = "secret-de-test";

    const down = await fetchInpiOpposition("520644386", (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch, 0);
    check("INPI injoignable : non vérifié, sans exception", !down.ok && down.error.includes("ECONNRESET"), down);
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Creusage : jamais bloqué, opposition portée par la fiche");
  {
    const candidate = { id: "c1", signal: {}, base: { company_name: "EXEMPLE", siren: "520644386" }, triage: { score: 5 }, weight: 1 } as unknown as DigCandidate;
    const run = async (figures: Record<string, unknown>) => {
      const created: Record<string, unknown>[] = [];
      const deps: DigDeps = {
        enrich: async () => ({ company_name: "EXEMPLE", key_figures: figures, signals: [], warnings: [] }) as never,
        createProspect: async (company) => {
          created.push((company.key_figures ?? {}) as Record<string, unknown>);
          return { id: "p1" };
        },
        findContact: async () => ({ confidence: 0, found_by: "aucun" }),
        brief: async () => undefined,
      };
      return { outcome: await digOne(deps, candidate), created };
    };
    const pappers = await run({ pappers_read: true, registry_source: "pappers", opposition_checked: true, opposition_source: "pappers" });
    check("Pappers lu : publiée, registre « pappers », opposition vérifiée", pappers.outcome.registry === "pappers" && pappers.outcome.oppositionUnverified === false && pappers.created.length === 1);

    const inpi = await run({ registry_source: "gratuit", opposition_checked: true, opposition_source: "inpi", revenue_eur: 2_000_000 });
    check("Pappers épuisé, INPI non opposée : publiée en gratuit, programmable", inpi.outcome.registry === "gratuit" && inpi.outcome.oppositionUnverified === false && inpi.created[0]?.opposition_checked === true, inpi.outcome);

    const opposed = await run({ registry_source: "gratuit", opposition_checked: true, opposition_source: "inpi", refuses_prospecting: true });
    check("Pappers épuisé, INPI opposée : écartée avant la fiche", opposed.created.length === 0 && Boolean(opposed.outcome.skipped?.includes("opposition")), opposed.outcome);

    const unknown = await run({ registry_source: "gratuit", opposition_checked: false });
    check("aucune source : publiée quand même (aucun blocage)", unknown.created.length === 1 && unknown.outcome.error === null);
    check("… badge « opposition non vérifiée »", unknown.outcome.oppositionUnverified === true);
    const bare = await run({});
    check("rien de vérifié (pas de SIREN) : la fiche porte opposition_checked: false", bare.created[0]?.opposition_checked === false, bare.created[0]);

    check("Hunter : refusé tant que l'opposition n'est pas vérifiée", !hunterPolicy({ funnel_run_id: "r", funnel_score: 5, registry_source: "gratuit", opposition_checked: false }).allowed);
    check("Hunter : autorisé en gratuit une fois l'opposition vérifiée", hunterPolicy({ funnel_run_id: "r", funnel_score: 5, registry_source: "gratuit", opposition_checked: true }).allowed);
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Revérification au run suivant");
  {
    const row = (id: string, prospectId: string, publication: "pret" | "a_completer", extra: Record<string, unknown> = {}) => ({
      id, user_id: "u1", run_id: "ancien", statut: "creusé", publication, prospect_id: prospectId, siren: null, motif_rejet: null,
      contact: { badge: publication === "pret" ? "generique" : "aucun", registry: "gratuit", opposition_unverified: true, ...extra },
    });
    const prospect = (id: string, siren: string) => ({ id, user_id: "u1", siren, key_figures: { registry_source: "gratuit", opposition_checked: false, revenue_eur: 1 } });
    const fake = new FakeDb({
      signal_candidates: [
        row("s-ok", "p-ok", "a_completer"),
        row("s-opp", "p-opp", "pret"),
        row("s-down", "p-down", "pret"),
        row("s-done", "p-done", "pret", { opposition_rechecked_run: "run2" }),
      ],
      prospects: [prospect("p-ok", "520644386"), prospect("p-opp", "453450256"), prospect("p-down", "111111111"), prospect("p-done", "898001029")],
    });
    const searched: string[] = [];
    const verified: string[] = [];
    const deps: DigDeps = {
      enrich: async () => {
        throw new Error("aucun creusage attendu");
      },
      createProspect: async () => ({ error: "aucune création attendue" }),
      findContact: async (prospectId) => {
        searched.push(prospectId);
        return { confidence: 80, found_by: "site:contact", email: "contact@artflex.fr", email_type: "generique" };
      },
      brief: async () => undefined,
      verifyOpposition: async (siren) => {
        verified.push(siren);
        if (siren === "111111111") return { ok: false, error: "quota INPI du jour atteint" };
        return { ok: true, refuses: siren !== "520644386", source: "inpi" };
      },
    };
    const count = await recheckOppositions(fake as unknown as Db, "u1", "run2", deps, 5);
    const cand = (id: string) => fake.rows("signal_candidates").find((r) => r.id === id) as SignalCandidateRow;
    const figures = (id: string) => (fake.rows("prospects").find((r) => r.id === id)?.key_figures ?? {}) as Record<string, unknown>;

    check("déjà revérifiée dans ce run : sautée", count === 3 && !verified.includes("898001029"), verified);
    check("non opposée : fiche programmable (opposition_checked: true, source INPI)", figures("p-ok").opposition_checked === true && figures("p-ok").opposition_source === "inpi");
    check("… et la recherche de contact est relancée (elle n'avait pas d'email)", searched.length === 1 && searched[0] === "p-ok" && cand("s-ok").publication === "pret", searched);
    check("… badge retiré de la carte", (cand("s-ok").contact as Record<string, unknown>).opposition_unverified === false);
    check("opposée : fiche marquée opposée, rien de supprimé", figures("p-opp").refuses_prospecting === true && fake.rows("prospects").length === 4);
    check("… carte sortie de l'entonnoir, motif INPI", cand("s-opp").statut === "rejeté" && String(cand("s-opp").motif_rejet).includes("INPI"), cand("s-opp").motif_rejet);
    check("toujours rien : reste « non vérifiée », retentée au run suivant", figures("p-down").opposition_checked === false && (cand("s-down").contact as Record<string, unknown>).opposition_rechecked_run === "run2");
    const again = await recheckOppositions(fake as unknown as Db, "u1", "run2", deps, 5);
    check("même run : aucune seconde tentative", again === 0);
    const next = await recheckOppositions(fake as unknown as Db, "u1", "run3", deps, 5);
    check(
      "run suivant : les deux fiches encore « non vérifiées » sont retentées",
      next === 2 && verified.filter((s) => s === "111111111").length === 2 && verified.includes("898001029"),
      { next, verified },
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Programmer : bloqué jusqu'à vérification");
  {
    const T0 = new Date("2026-10-05T07:00:00Z"); // lundi 9h à Paris
    const fake = new FakeDb({
      prospects: [
        { id: "p1", user_id: "u1", company_name: "X", deleted_at: null, do_not_contact: false, email: null, website: null, status: "a_contacter", key_figures: { opposition_checked: false } },
        { id: "p2", user_id: "u1", company_name: "Y", deleted_at: null, do_not_contact: false, email: null, website: null, status: "a_contacter", key_figures: {} },
      ],
      messages: [
        { id: "m1", user_id: "u1", prospect_id: "p1", type: "intro", subject: "Objet", body: "Bonjour,\n\nCorps.", status: "draft", send_status: "draft", deleted_at: null, scheduled_at: null, created_at: T0.toISOString() },
        { id: "m2", user_id: "u1", prospect_id: "p2", type: "intro", subject: "Objet", body: "Bonjour,\n\nCorps.", status: "draft", send_status: "draft", deleted_at: null, scheduled_at: null, created_at: T0.toISOString() },
      ],
      signal_candidates: [{ id: "s1", user_id: "u1", prospect_id: "p1", contact: { opposition_unverified: true, badge: "aucun" } }],
    });
    const db = fake as unknown as Db;
    const at = new Date(T0.getTime() + 2 * 3_600_000);
    const refused = await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@x.fr", at }, T0, () => 0);
    check("opposition non vérifiée : programmation refusée côté serveur", !refused.ok && "error" in refused && String(refused.error).includes("non vérifiée"), refused);
    check("… le brouillon reste un brouillon", fake.rows("messages").find((r) => r.id === "m1")?.send_status === "draft");

    const legacy = oppositionUnverified({});
    check("fiche antérieure sans le champ : jamais bloquée", legacy === false);

    const confirmed = await confirmOppositionManually(db, "u1", "p1", T0);
    const figures = fake.rows("prospects").find((r) => r.id === "p1")?.key_figures as Record<string, unknown>;
    check("« j'ai vérifié manuellement » : opposition vérifiée, source manuelle", confirmed.ok && figures.opposition_checked === true && figures.opposition_source === "manuel");
    check("… la carte de l'entonnoir n'est plus comptée « non vérifiée »", (fake.rows("signal_candidates")[0].contact as Record<string, unknown>).opposition_unverified === false);
    const other = await confirmOppositionManually(db, "u2", "p1", T0);
    check("… seulement pour son propre prospect", !other.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n6. Bandeau : registre utilisé, crédits Pappers");
  {
    check("crédits : forfait du mois moins l'utilisé, plus le pay-as-you-go", pappersRemaining({ jetons_abonnement: 500, jetons_abonnement_utilises: 120, jetons_pay_as_you_go_restants: 10 }) === 390);
    check("crédits épuisés : 0", pappersRemaining({ jetons_abonnement: 500, jetons_abonnement_utilises: 500, jetons_pay_as_you_go_restants: 0 }) === 0);
    check("ancien format : relu", pappersRemaining({ jetons_restants: 42 }) === 42);
    check("format inconnu : null", pappersRemaining({}) === null);

    const card = (id: string, contact: Record<string, unknown>) =>
      toCard({ id, statut: "creusé", source: "france-travail", facts: {}, identity: null, triage: null, contact, badges: [], score: 5, date_signal: "2026-10-01", url_source: null, prospect_id: "p", publication: "pret", siren: null, company_name: "X" } as unknown as SignalCandidateRow);
    const cards = [
      card("a", { registry: "pappers" }),
      card("b", { registry: "gratuit" }),
      card("c", { registry: "gratuit", opposition_unverified: true }),
      card("d", {}),
    ];
    check("carte : badge « opposition non vérifiée » lu", cards[2].oppositionUnverified && !cards[1].oppositionUnverified);
    const usage = registryUsage(cards, 380);
    check("comptes : 2 Pappers (dont fiche ancienne), 2 gratuit, 1 non vérifiée", usage.pappers === 2 && usage.gratuit === 2 && usage.unverified === 1 && usage.pappersCredits === 380, usage);
    check("libellé mixte", registryLabel(usage) === "Pappers 2 · gratuit 2", registryLabel(usage));
    check("libellé tout gratuit", registryLabel({ pappers: 0, gratuit: 3, unverified: 0, pappersCredits: 0 }) === "gratuit (Recherche d'entreprises + INPI)");
    check("libellé tout Pappers", registryLabel({ pappers: 4, gratuit: 0, unverified: 0, pappersCredits: 496 }) === "Pappers");
  }

  if (previous.user === undefined) delete process.env.INPI_USERNAME;
  else process.env.INPI_USERNAME = previous.user;
  if (previous.pass === undefined) delete process.env.INPI_PASSWORD;
  else process.env.INPI_PASSWORD = previous.pass;

  console.log(failures === 0 ? "\nTous les tests du repli gratuit passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

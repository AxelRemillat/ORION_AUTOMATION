/**
 * Tests de la corbeille — sur un faux client Supabase en mémoire, horloge
 * simulée. Aucune base, aucun réseau.
 *
 * Exécution : `npm run test:trash`.
 */
import { FakeDb } from "./fake-supabase";
import { loadPortfolio } from "../lib/trash/portfolio";
import { activeProspectCount, isActiveProspect, scopeToActive, trashCount, type Db } from "../lib/trash/scope";
import {
  allowAgain,
  deleteForever,
  moveToTrash,
  purgeExpired,
  restoreFromTrash,
} from "../lib/trash/operations";
import { knownSirens } from "../lib/trash/exclusions";
import { daysBeforePurge, purgeCutoff } from "../lib/trash/retention";
import { authorizeCron } from "../lib/trash/cron-auth";
import { buildQueue } from "../app/(app)/cockpit/_lib/queue";
import { inboxEntries, topSignals } from "../app/(app)/cockpit/_lib/compute";
import { buildRows } from "../app/(app)/suivi/_lib/rows";
import { buildFunnel } from "../app/(app)/stats/_lib/metrics";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = 86_400_000;
const T0 = new Date("2026-09-01T10:00:00Z");
const at = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60_000);

const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", company_name: id.toUpperCase(), siren: `${id.length}`.padStart(9, "1"),
  website: null, email: null, sector: "Transport", size_range: null, city: "Lyon", source: "auto",
  signals: [{ type: "recrutement", label: "Recrutement", quote: `${id} recrute`, url: "https://x.fr", date: "2026-08-30" }],
  key_figures: {}, pain_point: null, status: "contacte", created_at: T0.toISOString(),
  updated_at: T0.toISOString(), deleted_at: null, status_before_delete: null, ...over,
});

/** Deux prospects complets : « alpha » sera mis à la corbeille, « beta » non. */
function seed(): FakeDb {
  const sent = { status: "sent", type: "intro", subject: "s", body: "b", thread_id: null, created_at: T0.toISOString(), sent_at: T0.toISOString() };
  return new FakeDb({
    prospects: [prospect("alpha", { siren: "111111111" }), prospect("beta", { siren: "222222222" })],
    messages: [
      { id: "m-a", prospect_id: "alpha", user_id: "u1", ...sent },
      { id: "m-a-draft", prospect_id: "alpha", user_id: "u1", ...sent, status: "draft", sent_at: null },
      { id: "m-b", prospect_id: "beta", user_id: "u1", ...sent },
    ],
    deals: [
      { id: "d-a", prospect_id: "alpha", user_id: "u1", amount_eur: 5000, status: "ouvert", signed_at: null, created_at: T0.toISOString() },
      { id: "d-b", prospect_id: "beta", user_id: "u1", amount_eur: 3000, status: "ouvert", signed_at: null, created_at: T0.toISOString() },
    ],
    reminders: [
      { id: "r-a", prospect_id: "alpha", user_id: "u1", due_at: T0.toISOString(), done: false, created_at: T0.toISOString() },
      { id: "r-b", prospect_id: "beta", user_id: "u1", due_at: T0.toISOString(), done: false, created_at: T0.toISOString() },
    ],
    inbound_messages: [
      { id: "i-a", prospect_id: "alpha", user_id: "u1", from_email: "a@a.fr", subject: "Re", body: "oui", category: "reponse", thread_id: null, received_at: T0.toISOString(), handled: false, created_at: T0.toISOString() },
      { id: "i-x", prospect_id: null, user_id: "u1", from_email: "x@x.fr", subject: "?", body: "?", category: "autre", thread_id: null, received_at: T0.toISOString(), handled: false, created_at: T0.toISOString() },
    ],
    action_states: [
      { id: "s1", user_id: "u1", action_id: "relance-r-a", state: "snoozed", snooze_until: T0.toISOString() },
      { id: "s2", user_id: "u1", action_id: "approche-alpha", state: "done", snooze_until: null },
      { id: "s3", user_id: "u1", action_id: "relance-r-b", state: "done", snooze_until: null },
    ],
    favorites: [
      { id: "f-a", user_id: "u1", siren: "111111111", company_name: "ALPHA" },
      { id: "f-b", user_id: "u1", siren: "222222222", company_name: "BETA" },
    ],
    scan_history: [],
    excluded_companies: [],
  });
}

const asDb = (fake: FakeDb) => fake as unknown as Db;

(async () => {
  // -------------------------------------------------------------------------
  console.log("\n1. Mise à la corbeille et restauration");
  // -------------------------------------------------------------------------
  {
    const fake = seed();
    const db = asDb(fake);
    fake.rows("prospects")[0].status = "en_discussion";

    const trashed = await moveToTrash(db, "alpha", at(0));
    const alpha = fake.rows("prospects").find((row) => row.id === "alpha")!;
    check("mise à la corbeille effectuée", trashed.ok && trashed.count === 1);
    check("date de suppression posée", alpha.deleted_at === at(0).toISOString());
    check("statut d'avant mémorisé", alpha.status_before_delete === "en_discussion");
    check("données conservées pendant la corbeille", fake.rows("messages").some((row) => row.prospect_id === "alpha"));
    const again = await moveToTrash(db, "alpha", at(1));
    check("idempotent : un 2e appel ne change rien", again.ok && again.count === 0 && alpha.deleted_at === at(0).toISOString());
    check("compteur du menu = 1", (await trashCount(db)).count === 1);

    // Le statut a bougé pendant la corbeille : la restauration rend celui d'avant.
    alpha.status = "perdu";
    const restored = await restoreFromTrash(db, "alpha");
    check("restauration effectuée", restored.ok && restored.count === 1);
    check("statut d'avant restitué exactement", alpha.status === "en_discussion", String(alpha.status));
    check("plus à la corbeille", alpha.deleted_at === null && alpha.status_before_delete === null);
    check("restaurer un prospect actif ne fait rien", (await restoreFromTrash(db, "beta")).ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Exclusion de toutes les listes");
  // -------------------------------------------------------------------------
  {
    const fake = seed();
    const db = asDb(fake);
    await moveToTrash(db, "alpha", at(0));

    const portfolio = await loadPortfolio(db, ["messages", "deals", "reminders", "inbound"], {
      orderBy: "updated_at",
    });
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id).join(",");
    check("prospects : alpha absent", ids(portfolio.prospects) === "beta", ids(portfolio.prospects));
    check("messages : ceux d'alpha absents", ids(portfolio.messages) === "m-b");
    check("deals : ceux d'alpha absents", ids(portfolio.deals) === "d-b");
    check("relances d'alpha suspendues", ids(portfolio.reminders) === "r-b");
    check("emails reçus : alpha masqué, expéditeur inconnu conservé", ids(portfolio.inbound) === "i-x");
    check("Coûts : comptage hors corbeille", (await activeProspectCount(db)).count === 1);
    check("routes (envoi, génération, relance) : prospect refusé", !(await isActiveProspect(db, "alpha")));
    check("routes : prospect actif accepté", await isActiveProspect(db, "beta"));

    const queue = buildQueue({ ...portfolio, inbound: portfolio.inbound, size: 20, now: at(1).getTime() });
    check("Cockpit, actions du jour : rien sur alpha", !queue.visible.some((action) => JSON.stringify(action).includes("alpha") || JSON.stringify(action).includes("ALPHA")));
    check("Cockpit, boîte de réception : rien d'alpha", !inboxEntries(portfolio.inbound, portfolio.prospects).some((entry) => JSON.stringify(entry).includes("alpha")));
    check("Cockpit, signaux : rien d'alpha", !topSignals(portfolio.prospects).some((signal) => JSON.stringify(signal).includes("ALPHA")));
    const rows = buildRows(portfolio.prospects, portfolio.messages, portfolio.reminders, portfolio.deals);
    check("Suivi / pipeline : une seule ligne, beta", rows.length === 1 && rows[0].id === "beta");
    const funnel = buildFunnel(portfolio.prospects, portfolio.messages);
    check("Stats : l'entonnoir ne compte que beta", funnel[0].count === 1, JSON.stringify(funnel[0]));

    const sirens = await knownSirens(db, at(1));
    check("Recherche : le SIREN d'un prospect en corbeille n'est pas rescanné", sirens.has("111111111"));

    const scoped = scopeToActive([{ id: "beta" }], { rows: [{ prospect_id: "alpha" }, { prospect_id: null }] });
    check("helper : ligne sans prospect conservée", scoped.rows.length === 1 && scoped.rows[0].prospect_id === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n2 bis. Témoin : sans corbeille, alpha est bien partout");
  // -------------------------------------------------------------------------
  {
    const portfolio = await loadPortfolio(asDb(seed()), ["messages", "deals", "reminders", "inbound"]);
    const queue = buildQueue({ ...portfolio, size: 20, now: at(1).getTime() });
    check("témoin : alpha présent dans les actions du jour", JSON.stringify(queue.visible).includes("ALPHA"));
    check("témoin : deux lignes au Suivi", buildRows(portfolio.prospects, portfolio.messages, portfolio.reminders, portfolio.deals).length === 2);
    check("témoin : l'entonnoir compte deux prospects", buildFunnel(portfolio.prospects, portfolio.messages)[0].count === 2);
    check("témoin : réponse d'alpha dans la boîte de réception", inboxEntries(portfolio.inbound, portfolio.prospects).length === 2);
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Purge à J+14 (horloge simulée)");
  // -------------------------------------------------------------------------
  {
    const fake = seed();
    const db = asDb(fake);
    await moveToTrash(db, "alpha", at(0));

    check("compte à rebours : 13 jours à J+1", daysBeforePurge(at(0).toISOString(), at(1)) === 13);
    check("compte à rebours : 0 à J+14", daysBeforePurge(at(0).toISOString(), at(14)) === 0);
    check("seuil de purge = maintenant - 14 j", purgeCutoff(at(14)) === at(0).toISOString());

    const early = await purgeExpired(db, at(13, 23 * 60));
    check("J+13 : rien n'est purgé", early.ok && early.count === 0 && fake.rows("prospects").length === 2);

    const due = await purgeExpired(db, at(14, 1));
    check("J+14 : alpha purgé", due.ok && due.count === 1 && !fake.rows("prospects").some((row) => row.id === "alpha"));
    const left = (table: string) => fake.rows(table).filter((row) => row.prospect_id === "alpha").length;
    check("messages d'alpha supprimés", left("messages") === 0);
    check("deals d'alpha supprimés", left("deals") === 0);
    check("relances d'alpha supprimées", left("reminders") === 0);
    check("emails reçus d'alpha supprimés", !fake.rows("inbound_messages").some((row) => row.id === "i-a"));
    const actionIds = fake.rows("action_states").map((row) => row.action_id).join(",");
    check("états d'action d'alpha supprimés, ceux de beta gardés", actionIds === "relance-r-b", actionIds);
    check("favori d'alpha supprimé, celui de beta gardé", fake.rows("favorites").map((row) => row.id).join(",") === "f-b");
    check("beta intact", fake.rows("messages").some((row) => row.id === "m-b") && fake.rows("deals").some((row) => row.id === "d-b"));

    const excluded = fake.rows("excluded_companies");
    check("SIREN exclu après purge", excluded.length === 1 && excluded[0].siren === "111111111" && excluded[0].user_id === "u1");
    check("raison lisible (nom de l'entreprise)", String(excluded[0]?.reason).includes("ALPHA"));
    check("la recherche ne le propose plus", (await knownSirens(db, at(15))).has("111111111"));

    const replay = await purgeExpired(db, at(20));
    check("purge idempotente : rejouée, elle ne supprime rien", replay.ok && replay.count === 0 && fake.rows("excluded_companies").length === 1);

    await allowAgain(db, "111111111");
    check("« Autoriser à nouveau » : le SIREN revient dans la recherche", !(await knownSirens(db, at(40))).has("111111111"));
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Suppression définitive manuelle");
  // -------------------------------------------------------------------------
  {
    const fake = seed();
    const db = asDb(fake);
    const refused = await deleteForever(db, "beta");
    check("un prospect hors corbeille n'est jamais supprimé", refused.ok && refused.count === 0 && fake.rows("prospects").length === 2);
    await moveToTrash(db, "beta", at(0));
    const removed = await deleteForever(db, "beta");
    check("supprimé depuis la corbeille, sans attendre 14 jours", removed.ok && removed.count === 1);
    check("SIREN de beta exclu", fake.rows("excluded_companies").some((row) => row.siren === "222222222"));
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Route cron");
  // -------------------------------------------------------------------------
  {
    check("sans en-tête : refusé", !authorizeCron(null, "s3cret"));
    check("mauvais secret : refusé", !authorizeCron("Bearer autre", "s3cret"));
    check("sans « Bearer » : refusé", !authorizeCron("s3cret", "s3cret"));
    check("CRON_SECRET absent : tout est refusé", !authorizeCron("Bearer undefined", undefined));
    check("bon secret : accepté", authorizeCron("Bearer s3cret", "s3cret"));

    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("../app/api/cron/purge-trash/route");
    const anonymous = await GET(new Request("https://orion.test/api/cron/purge-trash"));
    check("route appelée sans secret : 401", anonymous.status === 401, String(anonymous.status));
    const wrong = await GET(
      new Request("https://orion.test/api/cron/purge-trash", { headers: { authorization: "Bearer faux" } }),
    );
    check("route appelée avec un faux secret : 401", wrong.status === 401, String(wrong.status));
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

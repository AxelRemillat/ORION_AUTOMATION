/**
 * Mails : corbeille et envoi programmé — faux client Supabase en mémoire,
 * horloge simulée, webhook n8n simulé. Aucune base, aucun réseau.
 *
 * Exécution : `npm run test:outbox`.
 */
import { FakeDb } from "./fake-supabase";
import type { Db } from "../lib/trash/scope";
import { loadPortfolio } from "../lib/trash/portfolio";
import { sendNow, sendTimeBlock } from "../lib/outbox/send";
import { cancelSchedule, runDueSends, scheduleMessage, STUCK_SENDING_MIN } from "../lib/outbox/scheduler";
import {
  deleteMessageForever,
  purgeExpiredMessages,
  restoreMessage,
  trashedMessages,
  trashMessage,
} from "../lib/outbox/trash";
import { markResultsSeen, unseenResults, upcomingSends } from "../lib/outbox/feed";
import { formatParisDay, formatScheduled, offWeekend, parisToUtc, scheduleError, scheduleShortcuts } from "../lib/outbox/paris-time";
import { nextAction } from "../app/(app)/suivi/_lib/next-action";
import { buildRows } from "../app/(app)/suivi/_lib/rows";
import type { Message, Prospect, Reminder } from "../types";
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = new Date("2026-09-28T07:00:00Z"); // lundi 9h00 à Paris
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

/** Webhook n8n simulé : compte les appels, répond selon `status`. */
function n8n(status = 200) {
  const calls: { to: string; message_id: string }[] = [];
  const state = { status };
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    // Laisse l'autre tick avancer pendant l'appel réseau.
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "gmail-1", threadId: "thread-1" }), { status: state.status });
  }) as unknown as typeof fetch;
  return { calls, state, deps: { fetch: fetchImpl, webhookUrl: "https://n8n.test/send" } };
}

const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", company_name: id.toUpperCase(), siren: null, website: null, email: null, sector: null,
  size_range: null, city: null, source: "auto", signals: [], key_figures: { pappers_read: true }, pain_point: null,
  status: "a_contacter", created_at: T0.toISOString(), updated_at: T0.toISOString(), deleted_at: null,
  do_not_contact: false, ...over,
});

const draft = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, prospect_id: prospectId, user_id: "u1", type: "intro", subject: `Objet ${id}`, body: `Bonjour,\n\nCorps ${id}.\n\n${OPT_OUT_SENTENCE}\n\nAxel Remillat`,
  status: "draft", sent_at: null, thread_id: null, created_at: T0.toISOString(), deleted_at: null,
  send_status: "draft", scheduled_at: null, scheduled_to: null, send_error: null, send_attempts: 0,
  send_started_at: null, send_seen_at: null, ...over,
});

function seed(extra: Record<string, unknown[]> = {}): { fake: FakeDb; db: Db } {
  const fake = new FakeDb({
    prospects: [prospect("acme"), prospect("beta")],
    messages: [draft("m1", "acme"), draft("m2", "beta")],
    reminders: [],
    action_states: [],
    ...extra,
  } as Record<string, Record<string, unknown>[]>);
  return { fake, db: fake as unknown as Db };
}

const msg = (fake: FakeDb, id: string) => fake.rows("messages").find((row) => row.id === id) as Record<string, unknown>;

async function main() {
  // -------------------------------------------------------------------------
  console.log("\nCorbeille des mails");
  {
    const { fake, db } = seed();
    const trashed = await trashMessage(db, "m1", at(0));
    check("un brouillon va à la corbeille", trashed.ok && msg(fake, "m1").deleted_at === T0.toISOString());

    const portfolio = await loadPortfolio(db, ["messages"]);
    check("il disparaît des écrans", !portfolio.messages.some((row) => row.id === "m1"));

    const web = n8n();
    const refused = await sendNow(db, { userId: "u1", messageId: "m1", prospectId: "acme", to: "a@acme.fr" }, { ...web.deps, now: at(1) });
    check("envoi refusé côté serveur", !refused.ok && refused.status === 409 && web.calls.length === 0, refused);

    const listed = await trashedMessages(db);
    check("listé dans /corbeille avec son prospect", listed.length === 1 && listed[0].companyName === "ACME");

    const restored = await restoreMessage(db, "m1");
    check("restauration", restored.ok && msg(fake, "m1").deleted_at === null);
  }
  {
    const { fake, db } = seed({ messages: [draft("sent", "acme", { status: "sent", send_status: "sent", sent_at: T0.toISOString() })] });
    const result = await trashMessage(db, "sent", at(0));
    check("un mail envoyé ne va pas à la corbeille", !result.ok && msg(fake, "sent").deleted_at === null);
  }
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(60) }, at(0));
    await trashMessage(db, "m1", at(1));
    check("un programmé mis à la corbeille est annulé", msg(fake, "m1").send_status === "cancelled");
    const web = n8n();
    const report = await runDueSends(db, { ...web.deps, now: at(90) });
    check("… et ne part jamais", web.calls.length === 0 && report.sent === 0);
    await restoreMessage(db, "m1");
    check("restauré, il redevient un brouillon", msg(fake, "m1").send_status === "draft" && msg(fake, "m1").scheduled_at === null);
  }
  {
    const { fake, db } = seed({ action_states: [{ action_id: "brouillon-m1", user_id: "u1" }] });
    await trashMessage(db, "m1", at(0));
    await purgeExpiredMessages(db, new Date(T0.getTime() + 13 * DAY));
    check("gardé à J+13", Boolean(msg(fake, "m1")));
    const purged = await purgeExpiredMessages(db, new Date(T0.getTime() + 15 * DAY));
    check("purgé à J+15", purged.ok && purged.count === 1 && !msg(fake, "m1"));
    check("état d'action Cockpit nettoyé", fake.rows("action_states").length === 0);
    check("les autres mails intacts", Boolean(msg(fake, "m2")));
    const forever = await deleteMessageForever(db, "m2");
    check("« supprimer définitivement » ignore un mail hors corbeille", forever.ok && forever.count === 0 && Boolean(msg(fake, "m2")));
  }

  // -------------------------------------------------------------------------
  console.log("\nProgrammation");
  {
    check("date passée refusée", scheduleError(at(-1), at(0)) !== null);
    check("maintenant refusé", scheduleError(at(0), at(0)) !== null);
    check("date à venir acceptée", scheduleError(at(5), at(0)) === null);
    const { fake, db } = seed();
    const past = await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(-10) }, at(0));
    check("scheduleMessage refuse le passé", !past.ok && msg(fake, "m1").send_status === "draft");
    const badTo = await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "pas-un-mail", at: at(10) }, at(0));
    check("destinataire invalide refusé", !badTo.ok);
  }
  {
    const { fake, db } = seed();
    const ok = await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "ceo@acme.fr", at: at(60) }, at(0));
    check("programmé", ok.ok && msg(fake, "m1").send_status === "scheduled" && msg(fake, "m1").scheduled_to === "ceo@acme.fr");
    check("visible dans « Envois programmés »", (await upcomingSends(db)).some((item) => item.id === "m1"));

    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(30) });
    check("rien ne part avant l'heure", web.calls.length === 0 && msg(fake, "m1").send_status === "scheduled");

    const report = await runDueSends(db, { ...web.deps, now: at(61) });
    check("part à l'heure, au bon destinataire", report.sent === 1 && web.calls.length === 1 && web.calls[0].to === "ceo@acme.fr");
    const sent = msg(fake, "m1");
    check("état : envoyé", sent.status === "sent" && sent.send_status === "sent" && sent.sent_at === at(61).toISOString());
    check("ids Gmail enregistrés", sent.thread_id === "thread-1" && sent.gmail_message_id === "gmail-1");
    const acme = fake.rows("prospects").find((row) => row.id === "acme");
    check("prospect passé « contacté »", acme?.status === "contacte");
    check("relance programmée à J+4", fake.rows("reminders").some((row) => row.prospect_id === "acme" && !row.done));

    await runDueSends(db, { ...web.deps, now: at(62) });
    check("jamais renvoyé au tick suivant", web.calls.length === 1);
    const results = await unseenResults(db);
    check("résultat à annoncer (toast)", results.length === 1 && results[0].sendStatus === "sent");
    await markResultsSeen(db, ["m1"], at(63));
    check("annoncé une seule fois", (await unseenResults(db)).length === 0);
  }
  {
    const { db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    await scheduleMessage(db, { userId: "u1", messageId: "m2", to: "b@beta.fr", at: at(10) }, at(0));
    const web = n8n();
    const [one, two] = await Promise.all([
      // Même créneau demandé : m2 part 2 à 7 min après m1 (espacement).
      runDueSends(db, { ...web.deps, now: at(20) }),
      runDueSends(db, { ...web.deps, now: at(20) }),
    ]);
    const ids = web.calls.map((call) => call.message_id).sort();
    check("deux ticks simultanés : chaque mail part UNE fois", JSON.stringify(ids) === '["m1","m2"]', ids);
    // Chaque mail est soit pris par un tick, soit vu déjà pris, soit retenu par
    // le filet anti-rafale (2 min entre deux départs) — jamais envoyé deux fois.
    check("le second tick les voit déjà pris", one.sent + two.sent === 2 && one.skipped + two.skipped + one.spaced + two.spaced === 2, { one, two });
  }
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    const cancelled = await cancelSchedule(db, { userId: "u1", messageId: "m1" });
    check("annulation : retour en brouillon", cancelled.ok && msg(fake, "m1").send_status === "draft" && msg(fake, "m1").scheduled_at === null);
    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(20) });
    check("un envoi annulé ne part pas", web.calls.length === 0);
  }
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    const web = n8n();
    const manual = await sendNow(db, { userId: "u1", messageId: "m1", prospectId: "acme", to: "a@acme.fr" }, { ...web.deps, now: at(5) });
    await runDueSends(db, { ...web.deps, now: at(11) });
    check("envoyé à la main avant l'heure : le tick ne le renvoie pas", manual.ok && web.calls.length === 1 && msg(fake, "m1").send_status === "sent");
  }

  // -------------------------------------------------------------------------
  console.log("\nRègles de l'envoi manuel, appliquées au programmé");
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    (fake.rows("prospects").find((row) => row.id === "acme") as Record<string, unknown>).do_not_contact = true;
    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(11) });
    const row = msg(fake, "m1");
    check("do_not_contact : « Bloqué » avec le motif, rien envoyé (Cowork #48)", web.calls.length === 0 && row.send_status === "blocked" && String(row.send_error).includes("ne plus contacter"), row.send_error);
    const blocked = await scheduleMessage(db, { userId: "u1", messageId: "m2", to: "b@beta.fr", at: at(20) }, at(0));
    check("un autre prospect reste programmable", blocked.ok);
    const refusedNow = await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(30) }, at(12));
    check("… et reprogrammer un prospect « ne plus contacter » est refusé", !refusedNow.ok);
  }
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    (fake.rows("prospects").find((row) => row.id === "acme") as Record<string, unknown>).deleted_at = at(5).toISOString();
    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(11) });
    check("prospect à la corbeille : « Bloqué », rien envoyé (Cowork #48)", web.calls.length === 0 && msg(fake, "m1").send_status === "blocked");
  }
  {
    // Premier envoi il y a moins de 3 jours : plafond de 10 par jour.
    const already = Array.from({ length: 10 }, (_, index) =>
      draft(`old-${index}`, "beta", { status: "sent", send_status: "sent", sent_at: at(-60 + index).toISOString() }),
    );
    const { fake, db } = seed({ messages: [draft("m1", "acme"), ...already] });
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    check("le plafond n'empêche pas de programmer", msg(fake, "m1").send_status === "scheduled");
    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(11) });
    const row = msg(fake, "m1");
    check("plafond du jour atteint : échec lisible", web.calls.length === 0 && row.send_status === "failed" && String(row.send_error).includes("Plafond"), row.send_error);
    const manual = await sendNow(db, { userId: "u1", messageId: "m1", prospectId: "acme", to: "a@acme.fr" }, { ...web.deps, now: at(12) });
    check("le plafond vaut aussi pour l'envoi manuel", !manual.ok && manual.status === 429);
  }

  // -------------------------------------------------------------------------
  console.log("\nÉchecs passagers : deux reprises espacées, puis échec");
  {
    const { fake, db } = seed();
    await scheduleMessage(db, { userId: "u1", messageId: "m1", to: "a@acme.fr", at: at(10) }, at(0));
    const web = n8n(502);
    await runDueSends(db, { ...web.deps, now: at(11) });
    let row = msg(fake, "m1");
    check("1re tentative ratée : reprise à +5 min", row.send_status === "scheduled" && row.scheduled_at === at(16).toISOString(), row);
    await runDueSends(db, { ...web.deps, now: at(12) });
    check("pas de reprise avant l'heure", web.calls.length === 1);
    await runDueSends(db, { ...web.deps, now: at(16) });
    row = msg(fake, "m1");
    check("2e tentative ratée : reprise à +15 min", row.send_status === "scheduled" && row.scheduled_at === at(31).toISOString());
    await runDueSends(db, { ...web.deps, now: at(31) });
    row = msg(fake, "m1");
    check("3e échec : failed, raison lisible", row.send_status === "failed" && String(row.send_error).startsWith("Échec après 3 tentatives"), row.send_error);
    check("trois appels n8n au total", web.calls.length === 3);
    check("échec annoncé (toast + badge)", (await unseenResults(db)).some((item) => item.sendStatus === "failed"));
  }
  {
    const { fake, db } = seed({
      messages: [draft("m1", "acme", { send_status: "sending", scheduled_at: at(0).toISOString(), send_started_at: at(0).toISOString() })],
    });
    const web = n8n();
    const report = await runDueSends(db, { ...web.deps, now: at(STUCK_SENDING_MIN + 1) });
    check("envoi interrompu : déclaré échoué, jamais renvoyé", report.stuck === 1 && web.calls.length === 0 && msg(fake, "m1").send_status === "failed");
  }

  // -------------------------------------------------------------------------
  console.log("\nHeure de Paris");
  {
    check("été : 9h00 Paris = 7h00 UTC", parisToUtc("2026-09-28", "09:00")?.toISOString() === "2026-09-28T07:00:00.000Z");
    check("hiver : 9h00 Paris = 8h00 UTC", parisToUtc("2026-11-02", "09:00")?.toISOString() === "2026-11-02T08:00:00.000Z");
    check("saisie illisible refusée", parisToUtc("28/09/2026", "9h") === null);
    const saturday = new Date("2026-09-26T15:00:00Z");
    const [tomorrow, monday] = scheduleShortcuts(saturday);
    check("« Demain 9h » un samedi = dimanche 9h", tomorrow.at.toISOString() === "2026-09-27T07:00:00.000Z", tomorrow.at);
    check("« Lundi 9h » un samedi = lundi 9h", monday.at.toISOString() === "2026-09-28T07:00:00.000Z", monday.at);
    const [, nextMonday] = scheduleShortcuts(new Date("2026-09-28T10:00:00Z"));
    check("« Lundi 9h » un lundi = lundi suivant", nextMonday.at.toISOString() === "2026-10-05T07:00:00.000Z", nextMonday.at);
    check("libellé « lun. 9h00 »", formatScheduled("2026-09-28T07:00:00Z", saturday) === "lun. 9h00", formatScheduled("2026-09-28T07:00:00Z", saturday));
  }

  // -------------------------------------------------------------------------
  console.log("\nRelance hors week-end");
  {
    const iso = (at: Date) => at.toISOString();
    check("samedi → lundi, même heure", iso(offWeekend(new Date("2026-10-03T13:14:08.947Z"))) === "2026-10-05T13:14:08.947Z", offWeekend(new Date("2026-10-03T13:14:08.947Z")));
    check("dimanche → lundi, même heure", iso(offWeekend(new Date("2026-10-04T13:14:08.947Z"))) === "2026-10-05T13:14:08.947Z");
    check("vendredi inchangé", iso(offWeekend(new Date("2026-10-02T07:00:03Z"))) === "2026-10-02T07:00:03.000Z");
    // Dimanche 25/10 : passage à l'heure d'hiver, 11h à Paris reste 11h le lundi.
    check("changement d'heure : 11h reste 11h", iso(offWeekend(new Date("2026-10-25T10:00:00Z"))) === "2026-10-26T10:00:00.000Z", offWeekend(new Date("2026-10-25T10:00:00Z")));
    check("libellé du jour « lun. 05/10 »", formatParisDay("2026-10-05T13:14:08Z") === "lun. 05/10", formatParisDay("2026-10-05T13:14:08Z"));
  }
  {
    // Intro partie un mercredi : J+4 tombe un dimanche, la relance est posée au lundi.
    const { fake, db } = seed();
    const web = n8n();
    const wednesday = new Date("2026-09-30T13:14:08Z");
    const sent = await sendNow(db, { userId: "u1", messageId: "m1", prospectId: "acme", to: "a@acme.fr" }, { ...web.deps, now: wednesday });
    const reminder = fake.rows("reminders").find((row) => row.prospect_id === "acme" && row.done === false);
    check("envoi du mercredi : relance J+4 posée au lundi", sent.ok && reminder?.due_at === "2026-10-05T13:14:08.000Z", reminder?.due_at);
    const { fake: fake2, db: db2 } = seed();
    const monday = await sendNow(db2, { userId: "u1", messageId: "m1", prospectId: "acme", to: "a@acme.fr" }, { ...n8n().deps, now: T0 });
    const reminder2 = fake2.rows("reminders").find((row) => row.prospect_id === "acme" && row.done === false);
    check("envoi du lundi : relance le vendredi, inchangée", monday.ok && reminder2?.due_at === new Date(T0.getTime() + 4 * DAY).toISOString(), reminder2?.due_at);
  }

  // -------------------------------------------------------------------------
  console.log("\nProchaine action (Suivi)");
  {
    const now = new Date("2026-09-30T16:00:00Z"); // mercredi 18h à Paris
    const row = (p: Record<string, unknown>, messages: Record<string, unknown>[], reminders: Record<string, unknown>[] = []) =>
      buildRows(
        [prospect(String(p.id), p) as unknown as Prospect],
        messages as unknown as Message[],
        reminders as unknown as Reminder[],
        [],
      )[0];
    const realNow = Date.now;
    Date.now = () => now.getTime();
    const RealDate = Date;
    // buildRows prend « maintenant » par défaut : on fige l'horloge pour les libellés.
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now.getTime());
        else super(...(args as [string]));
      }
      static now() { return now.getTime(); }
    } as DateConstructor;
    try {
      // ARTFLEX : intro partie mercredi, brouillon d'évaluation réécrit ensuite, relance au dimanche.
      const artflex = row({ id: "artflex", status: "contacte" }, [
        draft("a-sent", "artflex", { status: "sent", send_status: "sent", sent_at: "2026-09-30T13:14:08.947Z" }),
        draft("a-draft", "artflex", { created_at: "2026-09-30T14:43:03Z" }),
      ], [{ id: "r1", prospect_id: "artflex", user_id: "u1", due_at: "2026-10-04T13:14:08.947Z", done: false }]);
      check("ARTFLEX : « Relance J+4 le lun. 05/10 »", artflex.action.label === "Relance J+4 le lun. 05/10", artflex.action);
      check("ARTFLEX : le brouillon d'une intro déjà partie n'est pas « à envoyer »", artflex.draftsCount === 0);

      // HUMAN SIGHT : contacté, mais opposé à la prospection (Pappers).
      const human = row({ id: "human", status: "contacte", key_figures: { refuses_prospecting: true } }, [
        draft("h-sent", "human", { status: "sent", send_status: "sent", sent_at: "2026-09-28T07:00:03Z" }),
        draft("h-draft", "human"),
      ], [{ id: "r2", prospect_id: "human", user_id: "u1", due_at: "2026-10-02T07:00:03Z", done: false }]);
      check("HUMAN SIGHT : « Aucune relance : opposé à la prospection »", human.action.label === "Aucune relance : opposé à la prospection", human.action);

      // BOUVET CARTIER : intro programmée jeudi 9h.
      const bouvet = row({ id: "bouvet", status: "a_contacter" }, [
        draft("b-sched", "bouvet", { send_status: "scheduled", scheduled_at: "2026-10-01T07:00:00Z" }),
      ]);
      check("BOUVET : « Envoi programmé jeu. 9h00 »", bouvet.action.label === "Envoi programmé jeu. 9h00", bouvet.action);

      // Témoins : un vrai brouillon à envoyer, une relance du jour, un prospect sans rien.
      const fresh = row({ id: "fresh", status: "a_contacter" }, [draft("f-draft", "fresh")]);
      check("pas encore contacté + brouillon : « Envoyer le brouillon prêt »", fresh.action.label === "Envoyer le brouillon prêt");
      const relanceDraft = row({ id: "rd", status: "contacte" }, [
        draft("rd-sent", "rd", { status: "sent", send_status: "sent", sent_at: "2026-09-26T07:00:00Z" }),
        draft("rd-draft", "rd", { type: "relance_1" }),
      ]);
      check("relance rédigée : « Envoyer le brouillon prêt »", relanceDraft.action.label === "Envoyer le brouillon prêt");
      const today = nextAction({ status: "contacte", draftsCount: 0, nextDueAt: "2026-09-30T07:00:00Z", lastSentType: "intro", now });
      check("relance échue : « Relancer aujourd'hui »", today.label === "Relancer aujourd'hui" && today.urgency === "due");
      const second = nextAction({ status: "relance_1", draftsCount: 0, nextDueAt: "2026-10-07T07:00:00Z", lastSentType: "relance_1", now });
      check("après la 1re relance : « Relance J+7 le mer. 07/10 »", second.label === "Relance J+7 le mer. 07/10", second);
      const blocked = nextAction({ status: "contacte", draftsCount: 1, nextDueAt: null, lastSentType: "intro", opposition: "do_not_contact", now });
      check("ne plus contacter : aucune relance", blocked.label === "Aucune relance : ne plus contacter");
      const won = nextAction({ status: "gagne", draftsCount: 1, nextDueAt: null, scheduledAt: "2026-10-01T07:00:00Z", now });
      check("gagné : « Contrat signé » quoi qu'il reste", won.label === "Contrat signé");
      check("nouveau sans rien : « Préparer l'email d'approche »", row({ id: "n", status: "nouveau" }, []).action.label === "Préparer l'email d'approche");
    } finally {
      globalThis.Date = RealDate;
      Date.now = realNow;
    }
  }

  // -------------------------------------------------------------------------
  console.log("\nGarde au moment de l'envoi (Cowork #48, ESPACE 3000)");
  {
    const scheduled = (id: string, prospectId: string, over: Record<string, unknown> = {}) =>
      draft(id, prospectId, { send_status: "scheduled", scheduled_at: at(10).toISOString(), scheduled_to: `contact@${prospectId}.fr`, ...over });
    const sentIntro = (id: string, prospectId: string) => draft(id, prospectId, { status: "sent", send_status: "sent", sent_at: at(-5 * 24 * 60).toISOString() });
    const { fake, db } = seed({
      prospects: [
        prospect("espace", { status: "contacte", key_figures: { pappers_read: true, company_category: "ETI" } }),
        prospect("lost", { status: "perdu" }),
        prospect("dnc", { status: "contacte", do_not_contact: true }),
        prospect("ok", { status: "contacte" }),
      ],
      messages: [
        sentIntro("e-intro", "espace"),
        scheduled("e-r1", "espace", { type: "relance_1" }),
        scheduled("l-intro", "lost"),
        sentIntro("d-intro", "dnc"),
        scheduled("d-r1", "dnc", { type: "relance_1" }),
      ],
    });
    const web = n8n();
    const report = await runDueSends(db, { ...web.deps, now: at(11) });
    const espace = msg(fake, "e-r1");
    check("relance programmée AVANT que la fiche ne devienne hors cible (ETI) : rien ne part", web.calls.every((call) => call.message_id !== "e-r1"), web.calls);
    check("… le message passe en « Bloqué » avec le motif hors cible", espace.send_status === "blocked" && /hors cible.*ETI/.test(String(espace.send_error)), espace);
    check("… et reste un brouillon (jamais envoyé)", espace.status === "draft" && !espace.sent_at);
    check("intro programmée vers un prospect perdu : « Bloqué », motif perdu", msg(fake, "l-intro").send_status === "blocked" && /perdu/.test(String(msg(fake, "l-intro").send_error)), msg(fake, "l-intro"));
    check("« ne plus contacter » au départ : « Bloqué » (plus « Échec » ni notification)", msg(fake, "d-r1").send_status === "blocked" && /ne plus contacter/.test(String(msg(fake, "d-r1").send_error)), msg(fake, "d-r1"));
    check("aucun appel n8n pour les trois, compte rendu du tick : 3 bloqués", web.calls.length === 0 && report.blocked === 3 && report.failed === 0, report);

    const manual = await sendNow(db, { userId: "u1", messageId: "e-r1", prospectId: "espace", to: "contact@espace.fr" }, { ...web.deps, now: at(12) });
    check("envoi MANUEL de la même relance : refusé, rien ne part", !manual.ok && manual.status === 409 && /hors cible/.test(manual.error) && web.calls.length === 0, manual);

    check("motif pur : réponse à un mail reçu jamais bloquée (même hors cible)", sendTimeBlock({ status: "repondu", size_range: null, key_figures: { company_category: "ETI" } }, "reponse") === null);
    check("motif pur : a répondu (statut)", sendTimeBlock({ status: "repondu", size_range: null, key_figures: { pappers_read: true } }, "relance_1") === "a répondu");
    check("motif pur : hors cible GE", /catégorie INSEE GE/.test(sendTimeBlock({ status: "contacte", size_range: null, key_figures: { pappers_read: true, company_category: "GE" } }, "relance_2") ?? ""));
    check("motif pur : fiche saine → envoi permis", sendTimeBlock({ status: "contacte", size_range: null, key_figures: { pappers_read: true } }, "relance_1") === null);
  }
  {
    // Témoin : une relance vers une fiche saine part toujours.
    const { fake, db } = seed({
      prospects: [prospect("ok", { status: "contacte" })],
      messages: [draft("o-intro", "ok", { status: "sent", send_status: "sent", sent_at: at(-5 * 24 * 60).toISOString() }), draft("o-r1", "ok", { type: "relance_1", send_status: "scheduled", scheduled_at: at(10).toISOString(), scheduled_to: "contact@ok.fr" })],
    });
    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(11) });
    check("témoin : relance vers une fiche saine envoyée", web.calls.length === 1 && msg(fake, "o-r1").status === "sent", msg(fake, "o-r1"));
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

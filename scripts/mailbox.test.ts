/**
 * Boîte mail du Cockpit — onglets et compteurs, fil chronologique, corbeille
 * des mails reçus, réponse programmée dans le même fil, « ne plus contacter ».
 * Faux client Supabase en mémoire, horloge simulée, webhook n8n simulé.
 *
 * Exécution : `npm run test:mailbox`.
 */
import { FakeDb } from "./fake-supabase";
import type { Db } from "../lib/trash/scope";
import { loadPortfolio } from "../lib/trash/portfolio";
import { conversation, mailboxCounts, matches, paginate, scheduledItems, sentItems } from "../lib/outbox/mailbox";
import { purgeExpiredInbound, restoreInbound, trashedInbound, trashInbound } from "../lib/outbox/inbound-trash";
import { currentReplyDraft, saveReplyDraft } from "../lib/outbox/reply-draft";
import { runDueSends, scheduleMessage } from "../lib/outbox/scheduler";
import { sendNow } from "../lib/outbox/send";
import { DNC_CANCEL_REASON, setDoNotContact } from "../lib/outbox/do-not-contact";
import { inboxEntries } from "../app/(app)/cockpit/_lib/compute";
import { buildQueue } from "../app/(app)/cockpit/_lib/queue";
import type { InboundMessage, Prospect } from "../types";
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
const T0 = new Date("2026-09-28T07:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const iso = (minutes: number) => at(minutes).toISOString();

function n8n() {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, deps: { fetch: fetchImpl, webhookUrl: "https://n8n.test/send" } };
}

const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", company_name: id.toUpperCase(), siren: null, website: null, email: `${id}@${id}.fr`,
  sector: null, size_range: null, city: null, source: "auto", signals: [], key_figures: {}, pain_point: null,
  status: "contacte", created_at: iso(-10_000), updated_at: iso(-10_000), deleted_at: null, do_not_contact: false,
  status_before_dnc: null, ...over,
});
const message = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, prospect_id: prospectId, user_id: "u1", type: "intro", subject: `Objet ${id}`, body: `Bonjour,\n\nCorps ${id}.\n\n${OPT_OUT_SENTENCE}\n\nAxel Remillat`,
  status: "sent", sent_at: iso(-3000), thread_id: "t-" + prospectId, created_at: iso(-3000), deleted_at: null,
  send_status: "sent", scheduled_at: null, scheduled_to: null, send_error: null, send_attempts: 0,
  send_started_at: null, send_seen_at: null, sent_to: `${prospectId}@${prospectId}.fr`, ...over,
});
const received = (id: string, prospectId: string | null, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", prospect_id: prospectId, from_email: `${prospectId ?? "inconnu"}@x.fr`, subject: `Re ${id}`,
  body: `Réponse ${id}`, category: "reponse", thread_id: prospectId ? "t-" + prospectId : null,
  gmail_message_id: `gm-${id}`, received_at: iso(-1000), handled: false, created_at: iso(-1000), deleted_at: null, ...over,
});

function seed() {
  const fake = new FakeDb({
    prospects: [prospect("acme"), prospect("beta")],
    messages: [
      message("intro-a", "acme", { sent_at: iso(-3000) }),
      message("relance-a", "acme", { type: "relance_1", sent_at: iso(-500) }),
      message("fail-b", "beta", { status: "draft", send_status: "failed", scheduled_at: iso(-200), send_error: "n8n a répondu 502", sent_at: null, sent_to: null, scheduled_to: "b@beta.fr" }),
      message("prog-b", "beta", { status: "draft", send_status: "scheduled", scheduled_at: iso(120), sent_at: null, sent_to: null, scheduled_to: "b@beta.fr" }),
      message("draft-b", "beta", { status: "draft", send_status: "draft", sent_at: null, sent_to: null }),
    ],
    inbound_messages: [received("in-a", "acme", { received_at: iso(-1000) }), received("in-b", "beta", { received_at: iso(-100) })],
    reminders: [],
    action_states: [],
  } as Record<string, Record<string, unknown>[]>);
  return { fake, db: fake as unknown as Db };
}

async function main() {
  console.log("\nOnglets et compteurs");
  {
    const { db } = seed();
    const { prospects, messages, inbound } = await loadPortfolio(db, ["messages", "inbound"]);
    const counts = mailboxCounts(inbound, messages, prospects);
    check("Reçus : 2 dont 2 non lus", counts.recus === 2 && counts.nonLus === 2, counts);
    check("Envoyés : partis + échecs (3)", counts.envoyes === 3, counts);
    check("Programmés : 1", counts.programmes === 1, counts);

    const sent = sentItems(messages, prospects);
    check("Envoyés du plus récent au plus ancien", sent.map((item) => item.id).join() === "fail-b,relance-a,intro-a", sent.map((item) => item.id));
    const relance = sent.find((item) => item.id === "relance-a");
    check("type « Relance », statut, destinataire, entreprise", relance?.typeLabel === "Relance" && relance.status === "sent" && relance.to === "acme@acme.fr" && relance.companyName === "ACME");
    const failed = sent.find((item) => item.id === "fail-b");
    check("un échec apparaît avec sa raison", failed?.status === "failed" && failed.error === "n8n a répondu 502");
    check("un brouillon n'est pas un envoyé", !sent.some((item) => item.id === "draft-b"));
    const scheduled = scheduledItems(messages, prospects);
    check("Programmés : heure prévue", scheduled.length === 1 && scheduled[0].scheduledAt === iso(120));

    check("recherche par entreprise (sans accents ni casse)", matches("acmé", "ACME", "x") && !matches("zeta", "ACME", "Objet"));
    check("recherche par objet", sent.filter((item) => matches("relance-a", item.companyName, item.subject)).length === 1);
    const pages = paginate(Array.from({ length: 45 }, (_, index) => index), 3);
    check("pagination : 3 pages de 20, dernière à 5", pages.pages === 3 && pages.items.length === 5 && pages.total === 45);
    check("page hors bornes ramenée à la dernière", paginate([1, 2, 3], 9).page === 1);
  }

  console.log("\nFil de conversation");
  {
    const { db } = seed();
    const { messages, inbound } = await loadPortfolio(db, ["messages", "inbound"]);
    const thread = conversation("acme", messages, inbound);
    check("envoyés et reçus mêlés, dans l'ordre", thread.map((item) => `${item.who}:${item.id}`).join() === "moi:intro-a,lui:in-a,moi:relance-a", thread.map((item) => item.id));
    check("le fil ne contient que ce prospect", !thread.some((item) => item.id === "in-b"));
  }

  console.log("\nCorbeille d'un mail reçu");
  {
    const { fake, db } = seed();
    const trashed = await trashInbound(db, "in-b", at(0));
    check("mise à la corbeille", trashed.ok && trashed.count === 1);
    let portfolio = await loadPortfolio(db, ["messages", "inbound"]);
    check("disparaît du Cockpit", !inboxEntries(portfolio.inbound, portfolio.prospects).some((entry) => entry.id === "in-b"));
    check("… des compteurs", mailboxCounts(portfolio.inbound, portfolio.messages, portfolio.prospects).recus === 1);
    const queue = buildQueue({
      prospects: portfolio.prospects, messages: portfolio.messages, reminders: [], states: [],
      inbound: portfolio.inbound.filter((item) => !item.handled).map((item) => ({ id: item.id, prospect_id: item.prospect_id })),
    });
    check("… et des actions du jour", !queue.visible.some((action) => action.id === "reponse-in-b"));
    check("… et du fil", !conversation("beta", portfolio.messages, portfolio.inbound).some((item) => item.id === "in-b"));
    check("listé dans /corbeille → Mails (reçus)", (await trashedInbound(db)).some((item) => item.id === "in-b"));

    const restored = await restoreInbound(db, "in-b");
    portfolio = await loadPortfolio(db, ["messages", "inbound"]);
    check("annulation / restauration", restored.ok && inboxEntries(portfolio.inbound, portfolio.prospects).some((entry) => entry.id === "in-b"));

    fake.rows("action_states").push({ action_id: "reponse-in-b", user_id: "u1" });
    await trashInbound(db, "in-b", at(0));
    await purgeExpiredInbound(db, new Date(T0.getTime() + 13 * DAY));
    check("gardé à J+13", fake.rows("inbound_messages").some((row) => row.id === "in-b"));
    await purgeExpiredInbound(db, new Date(T0.getTime() + 15 * DAY));
    check("purgé à J+15, état d'action nettoyé", !fake.rows("inbound_messages").some((row) => row.id === "in-b") && fake.rows("action_states").length === 0);
    check("les autres mails reçus intacts", fake.rows("inbound_messages").some((row) => row.id === "in-a"));
  }

  console.log("\nRéponse programmée dans le même fil");
  {
    const { fake, db } = seed();
    const first = await saveReplyDraft(db, { userId: "u1", inboundId: "in-a", subject: "Re : votre message", body: "Merci, parlons-en." });
    const again = await saveReplyDraft(db, { userId: "u1", inboundId: "in-a", subject: "Re : votre message", body: "Merci, parlons-en jeudi." });
    check("un seul brouillon par mail reçu, réécrit", first.ok && again.ok && first.messageId === again.messageId);
    const id = first.ok ? first.messageId : "";
    const row = fake.rows("messages").find((item) => item.id === id) as Record<string, unknown>;
    check("rattaché au fil : thread_id + id Gmail + mail reçu", row.thread_id === "t-acme" && row.reply_to_gmail_message_id === "gm-in-a" && row.reply_to_inbound_id === "in-a" && row.type === "reponse");
    check("retrouvé en revenant sur l'écran", (await currentReplyDraft(db, "in-a"))?.body === "Merci, parlons-en jeudi.");

    const scheduled = await scheduleMessage(db, { userId: "u1", messageId: id, to: "acme@x.fr", at: at(60) }, at(0));
    const portfolio = await loadPortfolio(db, ["messages", "inbound"]);
    check("programmée : visible dans l'onglet Programmés", scheduled.ok && scheduledItems(portfolio.messages, portfolio.prospects).some((item) => item.id === id));

    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(61) });
    const payload = web.calls[0] ?? {};
    check("part dans le même fil (thread_id + reply_to_gmail_message_id)", payload.thread_id === "t-acme" && payload.reply_to_gmail_message_id === "gm-in-a", payload);
    check("le mail reçu est soldé à l'envoi", fake.rows("inbound_messages").find((item) => item.id === "in-a")?.handled === true);
    check("apparaît ensuite dans Envoyés", sentItems((await loadPortfolio(db, ["messages"])).messages, portfolio.prospects).some((item) => item.id === id && item.typeLabel === "Réponse"));

    const orphan = await saveReplyDraft(db, { userId: "u1", inboundId: "in-inconnu", subject: "", body: "x" });
    check("pas de brouillon pour un mail reçu introuvable", !orphan.ok);
  }

  console.log("\n« Ne plus contacter »");
  {
    const { fake, db } = seed();
    const on = await setDoNotContact(db, "beta", true);
    const beta = fake.rows("prospects").find((row) => row.id === "beta") as Record<string, unknown>;
    check("prospect bloqué et passé en « perdu »", on.ok && beta.do_not_contact === true && beta.status === "perdu" && beta.status_before_dnc === "contacte");
    const prog = fake.rows("messages").find((row) => row.id === "prog-b") as Record<string, unknown>;
    check("programmés annulés (retour en brouillon, raison)", on.ok && on.cancelled === 2 && prog.send_status === "draft" && prog.scheduled_at === null && prog.send_error === DNC_CANCEL_REASON, on);

    const web = n8n();
    await runDueSends(db, { ...web.deps, now: at(200) });
    const manual = await sendNow(db, { userId: "u1", messageId: "draft-b", prospectId: "beta", to: "b@beta.fr" }, { ...web.deps, now: at(201) });
    check("plus aucun envoi (programmé ni manuel)", web.calls.length === 0 && !manual.ok);
    const reschedule = await scheduleMessage(db, { userId: "u1", messageId: "prog-b", to: "b@beta.fr", at: at(300) }, at(202));
    check("reprogrammer est refusé", !reschedule.ok);

    const off = await setDoNotContact(db, "beta", false);
    check("réversible : statut d'avant rendu", off.ok && beta.do_not_contact === false && beta.status === "contacte" && beta.status_before_dnc === null);
    const again = await scheduleMessage(db, { userId: "u1", messageId: "prog-b", to: "b@beta.fr", at: at(300) }, at(202));
    check("… et on peut de nouveau programmer", again.ok);

    const entries = inboxEntries(
      (fake.rows("inbound_messages") as unknown) as InboundMessage[],
      (fake.rows("prospects") as unknown) as Prospect[],
    );
    check("mail reçu : l'état « ne plus contacter » suit le prospect", entries.every((entry) => entry.doNotContact === false));
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

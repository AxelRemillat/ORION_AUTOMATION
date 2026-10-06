/**
 * Notifications téléphone (ntfy) — fixtures seulement : appel ntfy simulé,
 * fausse base, aucun mail envoyé, aucun réseau.
 * `npm run test:notifications`
 */
import { notifyInbound, notifySendFailed } from "../lib/notify/events";
import { asciiTitle, firstSentence, type NotifyDeps } from "../lib/notify/ntfy";
import { runDueSends } from "../lib/outbox/scheduler";
import { GMAIL_AUTH_MESSAGE } from "../lib/outbox/send-errors";
import type { Db } from "../lib/trash/scope";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const TOPIC = "orion-test-topic-x7";
const BASE = "https://orion.example.test";

/** Faux ntfy : enregistre chaque appel. */
function ntfy(options: { fail?: "throw" | 500 } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (options.fail === "throw") throw new TypeError("network down");
    calls.push({ url, headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response("{}", { status: options.fail ?? 200 });
  }) as unknown as typeof fetch;
  const deps: NotifyDeps = { topic: TOPIC, fetch: fetchImpl, baseUrl: BASE };
  return { calls, deps };
}

/** Fausse base, avec la clé primaire de `notification_log` (23505 au doublon). */
function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  const fake = new FakeDb({
    prospects: [
      { id: "p-mav", user_id: "u1", company_name: "MAVIFLEX" },
      { id: "p-spi", user_id: "u1", company_name: "SPI ÉNERGIE" },
    ],
    notification_log: [],
    notification_prefs: [],
    ...extra,
  });
  const db = {
    from(table: string) {
      if (table !== "notification_log") return fake.from(table);
      return {
        insert: async (row: Record<string, unknown>) => {
          if (fake.rows("notification_log").some((item) => item.key === row.key)) return { error: { code: "23505" } };
          fake.rows("notification_log").push(row);
          return { error: null };
        },
      };
    },
  } as unknown as Db;
  return { fake, db };
}

const REPLY = { from_email: "dirigeant@maviflex.fr", subject: "Re: Votre proposition", body: "Bonjour Axel,\n\nOui, ça m'intéresse vraiment. Appelez-moi jeudi.\n\nLe lun. 5 oct. 2026, Axel a écrit :\n> Bonjour…" };
const ANTISPAM = { from_email: "aktid@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "Un clic pour délivrer votre email : https://invitations.mailinblack.com/v?t=1" };

async function main() {
  console.log("\n1. Mise en forme");
  {
    check("Title ASCII : accents et guillemets français retirés", asciiTitle("Réponse de « SPI ÉNERGIE »") === 'Reponse de "SPI ENERGIE"', asciiTitle("Réponse de « SPI ÉNERGIE »"));
    check("Title ≤ 120 caractères", asciiTitle("x".repeat(300)).length === 120);
    check("1re phrase : sans salutation ni historique cité", firstSentence(REPLY.body) === "Oui, ça m'intéresse vraiment.", firstSentence(REPLY.body));
    check("1re phrase ≤ 140 caractères", firstSentence("a ".repeat(200)).length <= 140);
  }

  console.log("\n2. Réponse d'un prospect → urgent");
  {
    const { db } = seed();
    const web = ntfy();
    const outcome = await notifyInbound(db, { userId: "u1", inboundId: "in-1", prospectId: "p-mav", companyName: "MAVIFLEX", message: REPLY }, web.deps);
    const call = web.calls[0];
    check("une notification envoyée", outcome?.sent === true && web.calls.length === 1, outcome);
    check("POST https://ntfy.sh/<topic>", call?.url === `https://ntfy.sh/${TOPIC}`);
    check("Priority urgent, Title « Reponse de MAVIFLEX »", call?.headers.Priority === "urgent" && call.headers.Title === "Reponse de MAVIFLEX", call?.headers);
    check("corps = 1re phrase", call?.body === "Oui, ça m'intéresse vraiment.", call?.body);
    check("Click = fiche prospect", call?.headers.Click === `${BASE}/suivi/p-mav`, call?.headers.Click);
    const again = await notifyInbound(db, { userId: "u1", inboundId: "in-1", prospectId: "p-mav", companyName: "MAVIFLEX", message: REPLY }, web.deps);
    check("anti-doublon : le même mail ne notifie qu'une fois", again?.sent === false && web.calls.length === 1, again);
  }

  console.log("\n3. Anti-spam → default ; absence et rebond → rien");
  {
    const { db } = seed();
    const web = ntfy();
    await notifyInbound(db, { userId: "u1", inboundId: "in-aktid", prospectId: "p-aktid", companyName: "AKTID", message: ANTISPAM }, web.deps);
    const call = web.calls[0];
    check("Priority default, « Anti-spam a valider : AKTID »", call?.headers.Priority === "default" && call.headers.Title === "Anti-spam a valider : AKTID", call?.headers);
    check("Click = page du mail (lien + case « Validé »)", call?.headers.Click === `${BASE}/cockpit/inbox/in-aktid`);
    await notifyInbound(db, { userId: "u1", inboundId: "in-abs", prospectId: "p-mav", companyName: "MAVIFLEX", message: { from_email: "a@maviflex.fr", subject: "Réponse automatique : absent", body: "Je suis absent." } }, web.deps);
    await notifyInbound(db, { userId: "u1", inboundId: "in-bounce", prospectId: null, companyName: null, message: { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "x" } }, web.deps);
    check("absence et rebond : aucune notification", web.calls.length === 1, web.calls.length);
  }

  console.log("\n4. Envoi échoué → high");
  {
    const { db } = seed();
    const web = ntfy();
    await notifySendFailed(db, { userId: "u1", messageId: "m-spi", prospectId: "p-spi", error: 'Échec après 3 tentatives : n8n a répondu 500. {"message":"Error in workflow"}' }, web.deps);
    const call = web.calls[0];
    check("Priority high, Title « Envoi echoue : SPI ENERGIE »", call?.headers.Priority === "high" && call.headers.Title === "Envoi echoue : SPI ENERGIE", call?.headers);
    check("corps = erreur lisible (pas de JSON brut)", call?.body === GMAIL_AUTH_MESSAGE, call?.body);
    check("Click = fiche prospect", call?.headers.Click === `${BASE}/suivi/p-spi`);
  }

  console.log("\n5. Interrupteurs, topic absent, échec silencieux");
  {
    const { db, fake } = seed({ notification_prefs: [{ user_id: "u1", reply: false, antispam: true, send_failed: true }] });
    const web = ntfy();
    const off = await notifyInbound(db, { userId: "u1", inboundId: "in-2", prospectId: "p-mav", companyName: "MAVIFLEX", message: REPLY }, web.deps);
    check("type désactivé : rien", off?.sent === false && off.reason === "disabled" && web.calls.length === 0, off);

    const none = await notifyInbound(db, { userId: "u1", inboundId: "in-3", prospectId: "p-mav", companyName: "MAVIFLEX", message: REPLY }, { ...web.deps, topic: null });
    check("NTFY_TOPIC absent : rien, aucune écriture", none?.sent === false && none.reason === "no-topic" && fake.rows("notification_log").length === 0, none);

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      const down = ntfy({ fail: "throw" });
      const thrown = await notifySendFailed(db, { userId: "u1", messageId: "m-x", prospectId: "p-spi", error: "x" }, down.deps);
      const refused = ntfy({ fail: 500 });
      const rejected = await notifySendFailed(db, { userId: "u1", messageId: "m-y", prospectId: "p-spi", error: "x" }, refused.deps);
      check("ntfy injoignable ou en erreur : pas d'exception, juste un log", !thrown.sent && !rejected.sent && warnings.length === 2, warnings);
    } finally {
      console.warn = original;
    }
    check("le topic n'apparaît dans aucun log", warnings.every((line) => !line.includes(TOPIC)), warnings);
  }

  console.log("\n6. Tick d'envoi : un envoi interrompu notifie (sans bloquer le tick)");
  {
    const { db } = seed({
      messages: [{ id: "m-stuck", user_id: "u1", prospect_id: "p-spi", type: "intro", status: "draft", send_status: "sending", send_started_at: "2026-10-10T07:00:00Z", deleted_at: null }],
    });
    const web = ntfy();
    // Samedi : hors fenêtre d'envoi, le tick s'arrête après les envois interrompus.
    const report = await runDueSends(db, { now: new Date("2026-10-10T09:00:00Z"), notify: web.deps, fetch: (async () => { throw new Error("n8n ne doit pas être appelé"); }) as unknown as typeof fetch });
    check("envoi interrompu → « Envoi echoue : SPI ENERGIE »", report.stuck === 1 && web.calls.length === 1 && web.calls[0].headers.Title === "Envoi echoue : SPI ENERGIE", { report, calls: web.calls.length });
  }

  console.log(failures === 0 ? "\nTous les tests des notifications passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

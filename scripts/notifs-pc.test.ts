/**
 * COMPTEUR DE L'ONGLET et NOTIFICATIONS SUR LE PC (Cowork #28).
 *
 * Fausse base en mémoire, faux envoi Web Push : aucun réseau, aucun vrai push,
 * aucun mail. Le service worker réel (public/orion-sw.js) tourne dans un bac à
 * sable `vm` avec un faux navigateur.
 * `npm run test:notifs-pc`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { badgeCounts } from "../lib/badges/counts";
import { faviconLabel, tabCount, tabTitle } from "../lib/badges/tab";
import { markAlerted } from "../lib/opportunities/ingest";
import { vapidConfig } from "../lib/push/config";
import { pushInboundReply, pushOpportunityAlert } from "../lib/push/events";
import { alertPayload, replyPayload } from "../lib/push/payload";
import { pushToDevices, type PushSender } from "../lib/push/send";
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

const NOW = new Date("2026-10-13T17:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const CONFIG = { publicKey: "BPub", privateKey: "priv", subject: "mailto:axel@example.com" };

const mail = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", prospect_id: "p1", from_email: "dirigeant@artflex.fr", subject: "Re: Votre proposition",
  body: "Bonjour, oui ça m'intéresse.", received_at: daysAgo(0), read_at: null, deleted_at: null, ...over,
});
const offer = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", platform: "codeur", title: `Offre ${id}`, body: "Développement d'une application", budget: "Plus de 10 000 €", categories: [],
  status: "a_repondre", seen_at: null, filter_reason: null, fit_score: 9, published_at: daysAgo(1), created_at: daysAgo(1), ...over,
});

/** Faux envoi : garde ce qui « partirait », refuse les endpoints marqués « gone ». */
function fakeSender() {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = async (subscription, payload) => {
    if (subscription.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  };
  return { sent, sender };
}
const device = (id: string, over: Record<string, unknown> = {}) => ({ id, user_id: "u1", endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: "k", auth: "a", disabled_at: null, ...over });

/** Faux navigateur pour le service worker. */
function serviceWorker() {
  const listeners: Record<string, (event: any) => void> = {};
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const self: any = {
    location: { origin: "https://orion.axelremillat.com" },
    addEventListener: (type: string, listener: (event: any) => void) => (listeners[type] = listener),
    skipWaiting: () => undefined,
    registration: {
      getNotifications: async () => shown.map((entry) => ({ data: entry.options.data })),
      showNotification: async (title: string, options: any) => {
        const index = shown.findIndex((entry) => entry.options.tag === options.tag);
        if (index >= 0) shown.splice(index, 1);
        shown.push({ title, options });
      },
    },
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => opened.push(url) },
  };
  runInNewContext(readFileSync(join(process.cwd(), "public", "orion-sw.js"), "utf8"), { self, URL, Date, Array, Set, JSON });
  const fire = async (type: string, event: any) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
    await work;
  };
  const push = (payload: unknown) => fire("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  const click = (data: unknown) => fire("notificationclick", { notification: { data, close: () => undefined } });
  return { self, shown, opened, push, click };
}

async function main() {
  console.log("\n1. Compteur de l'onglet : même source que les badges de la barre");
  {
    const db = new FakeDb({
      inbound_messages: [
        mail("in-1"),
        mail("in-refus", { body: "Non merci, ce n'est pas pour nous." }), // un refus non lu compte
        mail("in-absence", { subject: "Réponse automatique : absent", body: "Je suis absent jusqu'au 20/10." }),
        mail("in-rebond", { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "Address not found." }),
        mail("in-lu", { read_at: daysAgo(0) }),
        mail("in-corbeille", { deleted_at: daysAgo(0) }),
      ],
      prospects: [{ id: "p1", key_figures: {} }],
      opportunities: [
        offer("o1"), offer("o2", { platform: "upwork" }), offer("o3", { platform: "comeup" }),
        offer("o-vue", { seen_at: daysAgo(0) }), offer("o-vieille", { published_at: daysAgo(10), created_at: daysAgo(10) }),
        offer("o-ignoree", { status: "ignoree" }), offer("o-faible", { fit_score: 4 }),
      ],
      messages: [],
    });
    const badges = await badgeCounts(db as unknown as Db, NOW);
    check("2 réponses non lues (dont un refus) : absence, rebond, lu et corbeille exclus", badges.unread === 2, badges);
    check("3 offres en Alerte non vues (Codeur, Upwork, ComeUp) : vue, > 7 j, ignorée, score faible exclues", badges.alerts === 3, badges);
    check("cas d'Axel : 2 mails + 3 offres → « (5) »", tabCount(badges) === 5 && tabTitle("Aujourd'hui · ORION", tabCount(badges)) === "(5) Aujourd'hui · ORION");
    check("la corbeille ne compte pas dans l'onglet", tabCount({ alerts: 0, unread: 0 }) === 0);
    check("N = 0 → titre d'origine, préfixe retiré", tabTitle("(5) Aujourd'hui · ORION", 0) === "Aujourd'hui · ORION");
    check("préfixe jamais doublé", tabTitle("(3) Paramètres", 5) === "(5) Paramètres");
    check("pastille : « 7 », « 99+ »", faviconLabel(7) === "7" && faviconLabel(150) === "99+");
  }

  console.log("\n2. Contenu et lien des notifications");
  {
    const reply = replyPayload({ inboundId: "in-1", prospectId: "p1", companyName: "ARTFLEX", fromEmail: "x@artflex.fr", body: "Bonjour,\nOui, appelons-nous jeudi. Cordialement" });
    check("« Réponse de ARTFLEX », clic → la fiche", reply.title === "Réponse de ARTFLEX" && reply.url === "/suivi/p1", reply);
    check("réponse sans fiche : clic → le mail reçu", replyPayload({ inboundId: "in-9", prospectId: null, companyName: null, fromEmail: "a@b.fr" }).url === "/cockpit/inbox/in-9");
    const alert = alertPayload({ id: "o1", platform: "codeur", title: "Refaire mon site internet", lane: "lancement", score: 4 });
    check("« Codeur · Refaire mon site internet · Lancement », clic → l'offre", alert.title === "Codeur · Refaire mon site internet · Lancement" && alert.url === "/opportunites?id=o1", alert);
    check("régie et score", alertPayload({ id: "o", platform: "upwork", title: "Mission", lane: "regie", score: 6 }).title.endsWith("· Régie") && alertPayload({ id: "o", platform: "comeup", title: "X", lane: null, score: 9 }).title === "ComeUp · X · 9/10");
  }

  console.log("\n3. Envoi Web Push simulé");
  {
    check("clés VAPID : les trois sont requises", vapidConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" }) === null && vapidConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:x" }) !== null);
    const empty = new FakeDb({ notification_log: [], push_subscriptions: [device("d1")] }, { unique: { notification_log: ["key"] } });
    const none = fakeSender();
    const unconfigured = await pushToDevices(empty as unknown as Db, "u1", "reply:x", replyPayload({ inboundId: "x", prospectId: null, companyName: "A", fromEmail: "a@a.fr" }), { config: null, sender: none.sender });
    check("sans clés : rien n'est envoyé, rien ne casse", unconfigured.reason === "not-configured" && none.sent.length === 0 && empty.rows("notification_log").length === 0);

    const db = new FakeDb(
      { notification_log: [], push_subscriptions: [device("d1"), device("d2"), device("gone"), device("off", { disabled_at: daysAgo(1) })], opportunities: [offer("o1", { title: "Refaire mon site internet", body: "Refonte du site vitrine WordPress", budget: "Moins de 500 €", fit_score: 3 })] },
      { unique: { notification_log: ["key"] } },
    );
    const { sent, sender } = fakeSender();
    const deps = { config: CONFIG, sender, now: () => NOW };
    const message = { from_email: "dirigeant@artflex.fr", subject: "Re: Votre proposition", body: "Oui, parlons-en." };
    const first = await pushInboundReply(db as unknown as Db, { userId: "u1", inboundId: "in-1", prospectId: "p1", companyName: "ARTFLEX", message }, deps);
    check("vraie réponse : poussée sur les 2 appareils actifs (pas le désactivé)", first?.sent === 2 && sent.length === 2 && sent.every((entry) => entry.payload.title === "Réponse de ARTFLEX"), { first, sent });
    check("appareil expiré (410) : désactivé, la ligne reste", Boolean(db.rows("push_subscriptions").find((row) => row.id === "gone")?.disabled_at) && db.rows("push_subscriptions").length === 4);
    const again = await pushInboundReply(db as unknown as Db, { userId: "u1", inboundId: "in-1", prospectId: "p1", companyName: "ARTFLEX", message }, deps);
    check("même mail rejoué : aucun doublon", again?.reason === "duplicate" && sent.length === 2);
    const absence = await pushInboundReply(db as unknown as Db, { userId: "u1", inboundId: "in-2", prospectId: "p1", companyName: "ARTFLEX", message: { from_email: "x@artflex.fr", subject: "Réponse automatique : absent", body: "Je suis absent." } }, deps);
    const bounce = await pushInboundReply(db as unknown as Db, { userId: "u1", inboundId: "in-3", prospectId: null, companyName: null, message: { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "" } }, deps);
    const antispam = await pushInboundReply(db as unknown as Db, { userId: "u1", inboundId: "in-4", prospectId: null, companyName: null, message: { from_email: "acme@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "Votre message est en attente de validation." } }, deps);
    check("absence, rebond, anti-spam : aucune notification PC", absence === null && bounce === null && antispam === null && sent.length === 2);

    const alert = await pushOpportunityAlert(db as unknown as Db, "u1", "o1", deps);
    check("offre en Alerte : « Codeur · … · Lancement », clic → l'offre", alert?.sent === 2 && sent[2].payload.title === "Codeur · Refaire mon site internet · Lancement" && sent[2].payload.url === "/opportunites?id=o1", sent[2]);

    // Branchement réel : `markAlerted` (première trace) déclenche la notification, une seule fois.
    const hooked: string[] = [];
    const ingestDeps = { db: db as unknown as Db, userId: "u1", onAlert: async (id: string) => void hooked.push(id) };
    const firstMark = await markAlerted(ingestDeps, "o7");
    const secondMark = await markAlerted(ingestDeps, "o7");
    check("markAlerted : notification PC à la première trace seulement", firstMark && !secondMark && hooked.join() === "o7", hooked);
  }

  console.log("\n4. Service worker : affichage, anti-rafale, clic");
  {
    const sw = serviceWorker();
    await sw.push({ kind: "reply", title: "Réponse de ARTFLEX", body: "Oui, parlons-en.", url: "/suivi/p1" });
    check("une réponse : notification « Réponse de ARTFLEX »", sw.shown.length === 1 && sw.shown[0].title === "Réponse de ARTFLEX" && sw.shown[0].options.body === "Oui, parlons-en.");
    await sw.click(sw.shown[0].options.data);
    check("clic → la fiche, adresse complète d'ORION", sw.opened[0] === "https://orion.axelremillat.com/suivi/p1", sw.opened);

    await sw.push({ kind: "alerte", title: "Codeur · Refaire mon site internet · Lancement", body: "", url: "/opportunites?id=o1" });
    await sw.push({ kind: "alerte", title: "Upwork · Next.js app · 9/10", body: "", url: "/opportunites?id=o2" });
    check("3 événements en < 1 min : UNE notification regroupée", sw.shown.length === 1 && sw.shown[0].title === "ORION · 3 nouveautés" && /Refaire mon site internet/.test(sw.shown[0].options.body), sw.shown.map((entry) => entry.title));
    await sw.click(sw.shown[0].options.data);
    check("clic sur un regroupement mixte → « Aujourd'hui »", sw.opened[1] === "https://orion.axelremillat.com/aujourdhui", sw.opened);

    const burst = sw.self.__orionBurst as (previous: unknown, incoming: unknown, now: number) => { title: string; url: string; items: unknown[] };
    const one = burst(null, { kind: "alerte", title: "A", url: "/opportunites?id=a" }, 0);
    check("deux offres groupées → « Opportunités »", burst(one, { kind: "alerte", title: "B", url: "/opportunites?id=b" }, 30_000).url === "/opportunites");
    check("au-delà d'une minute : nouvelle notification, pas de regroupement", burst(one, { kind: "reply", title: "Réponse de X", url: "/suivi/x" }, 61_000).items.length === 1);
  }

  console.log(failures ? `\n${failures} test(s) en échec.` : "\nTous les tests des notifications PC passent.");
  if (failures) process.exit(1);
}

void main();

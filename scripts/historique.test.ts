/**
 * Lot 5a — Historique de la fiche prospect. Fixtures seulement (calquées sur
 * ARTFLEX et HUMAN SIGHT), aucun appel réseau. `npm run test:historique`
 */
import { writeProspectStatus } from "../app/(app)/suivi/_lib/write-status";
import { buildHistory, excerptOf, groupByDay, type HistoryRow } from "../lib/history/build";
import { loadHistoryRow } from "../lib/history/load";
import { recordProspectEvent } from "../lib/history/record";
import { setDoNotContact } from "../lib/outbox/do-not-contact";
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

const NOW = new Date("2026-10-04T10:00:00Z");
const ARTFLEX: HistoryRow = {
  id: "artflex", company_name: "ARTFLEX", status: "contacte", do_not_contact: false, created_at: "2026-09-30T13:00:00Z",
  key_figures: { pappers_read: true },
  messages: [
    { id: "intro", type: "intro", status: "sent", send_status: "sent", subject: "Vos commandes de robinetterie", body: "Bonjour Monsieur Romeo,\n\nJ'ai vu que vous recrutez un assistant ADV.\nLigne 2.\nLigne 3.", sent_at: "2026-09-30T13:14:08.947Z", created_at: "2026-09-30T13:05:28Z" },
    { id: "eval", type: "intro", status: "draft", send_status: "draft", subject: "Brouillon d'éval", body: "x", created_at: "2026-10-02T10:00:00Z", origin: "eval" },
  ],
  inbound_messages: [],
  reminders: [{ id: "r1", due_at: "2026-10-04T13:14:08.947Z", done: false }], // dimanche → lundi
  deals: [],
  signal_candidates: [],
  prospect_events: [],
};

async function main() {
  console.log("\n1. Chronologie d'ARTFLEX (fixture calquée sur la base)");
  {
    const { events, summary } = buildHistory(ARTFLEX, NOW);
    const titles = events.map((event) => event.title);
    check("du plus récent au plus ancien", events.every((event, index) => index === 0 || events[index - 1].at >= event.at), titles);
    check("relance prévue lundi 05/10 (dimanche reporté), marquée « à venir »", events[0].kind === "reminder" && events[0].at.startsWith("2026-10-05") && events[0].upcoming === true, events[0]);
    const intro = events.find((event) => event.kind === "sent");
    check("intro envoyée : heure de Paris, objet, extrait sans la formule d'appel, texte complet dépliable", intro?.title === "Intro envoyée · 15 h 14" && intro.subject === "Vos commandes de robinetterie" && intro.excerpt?.startsWith("J'ai vu que") === true && Boolean(intro.body), intro);
    check("le brouillon d'éval n'apparaît jamais", !titles.some((title) => /éval/i.test(title)) && !events.some((event) => event.id.includes("eval")));
    check("opposition déduite du registre : non opposée (Pappers)", titles.includes("Opposition (registre, Pappers) : non opposée"));
    check("fiche créée en bas de la chronologie", events.at(-1)?.kind === "created");
    check("résumé : 1 envoyé, 0 reçu, dernier contact il y a 3 jours", summary.sent === 1 && summary.received === 0 && summary.lastContactDays === 3, summary);
    const groups = groupByDay(events);
    check("regroupement par jour (Paris)", groups[0].day === "2026-10-05" && groups.at(-1)?.day === "2026-09-30", groups.map((g) => g.day));
  }

  console.log("\n2. Relances bloquées, mails reçus, événements ORION, signaux");
  {
    const human: HistoryRow = {
      ...ARTFLEX, id: "human", company_name: "HUMAN SIGHT", key_figures: { refuses_prospecting: true },
      messages: [{ ...ARTFLEX.messages![0], id: "h-intro", sent_at: "2026-09-28T07:00:03Z" }],
      reminders: [{ id: "h-r", due_at: "2026-10-02T07:00:03Z", done: false }],
      inbound_messages: [
        { id: "rep", from_email: "dg@human.fr", subject: "Re: votre message", body: "Bonjour, pourquoi pas.", category: "reponse", received_at: "2026-09-29T09:00:00Z" },
        { id: "bounce", from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "", received_at: "2026-09-28T07:01:00Z" },
        { id: "stop", from_email: "x@human.fr", subject: "Re", body: "STOP merci", received_at: "2026-09-30T09:00:00Z" },
      ],
      signal_candidates: [{ id: "sc", source: "france-travail", date_signal: "2026-09-25", facts: { jobTitle: "Assistant RH" }, created_at: "2026-09-26T05:00:00Z" }],
      prospect_events: [
        { id: "e1", channel: "orion", kind: "status", at: "2026-09-28T07:00:05Z", data: { from: "a_contacter", to: "contacte" } },
        { id: "e2", channel: "orion", kind: "opposition", at: "2026-10-03T05:00:00Z", data: { refuses: true, source: "inpi" } },
        { id: "e3", channel: "orion", kind: "note", at: "2026-10-03T08:00:00Z", data: { text: "Appelé le standard, rappeler lundi." } },
        { id: "e4", channel: "linkedin", kind: "message", at: "2026-10-03T09:00:00Z", data: { title: "Message LinkedIn envoyé" } },
      ],
    };
    const { events, summary } = buildHistory(human, NOW);
    const find = (kind: string) => events.find((event) => event.kind === kind);
    check("relance bloquée, avec la raison", find("reminder-blocked")?.detail === "opposé à la prospection", find("reminder-blocked"));
    const badges = events.filter((event) => event.kind === "received").map((event) => event.badge?.label).sort();
    check("mails reçus : badges réponse / rebond / refus (« STOP »)", badges.length === 3 && ["refus", "rebond", "réponse"].every((label) => badges.includes(label)), badges);
    check("changement de statut lisible", events.some((event) => event.title === "Statut : À contacter → Contacté"), events.map((e) => e.title));
    check("vérification d'opposition : résultat + source INPI", events.some((event) => event.title === "Opposition vérifiée (INPI) : opposée"));
    check("une vérification enregistrée remplace la déduction du registre", !events.some((event) => event.title.startsWith("Opposition (registre")));
    check("note manuelle, texte complet", events.some((event) => event.kind === "note" && event.body === "Appelé le standard, rappeler lundi."));
    check("canal futur (LinkedIn) rendu sans code spécifique", events.some((event) => event.channel === "linkedin" && event.title === "Message LinkedIn envoyé"));
    check("signal d'origine France Travail, daté", events.some((event) => event.title === "Signal France Travail : offre « Assistant RH »" && event.day === "2026-09-25"));
    check("résumé : reçus hors rebonds (2), dernier contact = la dernière réponse", summary.received === 2 && summary.lastContactAt === "2026-09-30T09:00:00Z", summary);
    check("extrait : formule d'appel retirée, 180 car. max", excerptOf("Bonjour,\n\n" + "a".repeat(400))!.length === 180);
  }

  console.log("\n3. Une seule requête agrégée par fiche (pas de N+1)");
  {
    const calls: string[] = [];
    const fake = (fail: boolean) => ({
      from: (table: string) => ({
        select: (columns: string) => {
          calls.push(`${table}:${columns.includes("prospect_events") ? "avec" : "sans"}`);
          return { eq: () => ({ maybeSingle: async () => (fail && columns.includes("prospect_events") ? { data: null, error: { message: "relation absente" } } : { data: ARTFLEX, error: null }) }) };
        },
      }),
    });
    const row = await loadHistoryRow(fake(false), "artflex");
    check("une requête, relations embarquées (messages, reçus, relances, affaires, signaux, événements)", calls.length === 1 && calls[0] === "prospects:avec" && row?.id === "artflex", calls);
    calls.length = 0;
    const fallback = await loadHistoryRow(fake(true), "artflex");
    check("table d'événements pas encore migrée : repli sans elle, rien ne casse", calls.join(",") === "prospects:avec,prospects:sans" && fallback?.id === "artflex", calls);
  }

  console.log("\n4. Enregistrement des événements (sans jamais bloquer l'action)");
  {
    const db = new FakeDb({ prospects: [{ id: "p", status: "contacte", deleted_at: null, do_not_contact: false, status_before_dnc: null }], reminders: [], messages: [], prospect_events: [] });
    await writeProspectStatus(db as never, "p", "repondu");
    const status = db.rows("prospect_events").find((row) => row.kind === "status");
    check("changement de statut → événement « de → vers »", (status?.data as Record<string, unknown>)?.from === "contacte" && (status?.data as Record<string, unknown>)?.to === "repondu", status);
    await setDoNotContact(db as unknown as Db, "p", true);
    check("« ne plus contacter » → événement", db.rows("prospect_events").some((row) => row.kind === "dnc" && (row.data as { on?: boolean }).on === true));
    const broken = { from: () => ({ insert: async () => { throw new Error("table absente"); } }) };
    check("historique indisponible : l'action n'échoue pas", (await recordProspectEvent(broken, { prospectId: "p", kind: "note", data: { text: "x" } })) === false);
  }

  console.log(failures === 0 ? "\nTous les tests de l'historique passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

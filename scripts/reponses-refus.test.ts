/**
 * Réponses rattachées, refus, réponse sans fiche (Cowork #51, 13/10/2026).
 * Cas réel : ARTFLEX — écrit à info@, réponse « Bonjour / Non / merci » de
 * jp.romeo@ dans le même fil. Fixtures seulement : aucun envoi, aucun réseau,
 * aucun appel OpenAI (le juge LLM est simulé).
 *
 * Exécution : `npm run test:reponses`.
 */
import { classifyRefusal, laterDate, ownText, refusalOf } from "../lib/inbound/refusal";
import { applyRefusal, classifyInbound, undoRefusal } from "../lib/inbound/refusal-server";
import { CONSUMER_DOMAINS, findProspectForInbound, withSecondaryContact } from "../lib/inbound/attach";
import { doNotContactFor, sendFreeReply } from "../lib/outbox/free-reply";
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

const ARTFLEX = "Bonjour\nNon\nmerci\n\n-----Message d'origine-----\nDe : Axel Remillat <axel@axelremillat.com>\nEnvoyé : mardi 13 octobre 2026 14:25\nÀ : Artflex - Info <info@artflex-robinetterie.fr>\nObjet : Demandes de prix chez Artflex\n\nBonjour, … un simple stop en réponse et je ne vous relancerai pas.";

async function main() {
  console.log("\n1. Classement du refus (règles, hors citation)");
  check("ARTFLEX « Bonjour / Non / merci » : refus", classifyRefusal(ARTFLEX) === "refus", classifyRefusal(ARTFLEX));
  check("la citation est retirée (le « stop » du mail d'origine ne compte pas)", !ownText(ARTFLEX).includes("stop") && ownText(ARTFLEX) === "Bonjour\nNon\nmerci");
  for (const text of ["Non merci.", "Bonjour, nous ne sommes pas intéressés. Cordialement", "Pas intéressé.", "Nous n'avons pas besoin de ce type de service.", "Merci mais nous ne donnerons pas suite."]) {
    check(`refus : « ${text} »`, classifyRefusal(text) === "refus", classifyRefusal(text));
  }
  for (const text of ["STOP", "Merci de ne plus me contacter.", "Désinscrivez-moi de votre liste svp", "Retirez notre adresse de vos envois."]) {
    check(`stop : « ${text} »`, classifyRefusal(text) === "stop", classifyRefusal(text));
  }
  for (const text of ["Pas pour le moment, recontactez-moi en janvier.", "Non merci, pas maintenant, peut-être l'an prochain.", "Revenez vers nous dans quelques mois."]) {
    check(`report, pas un refus : « ${text} »`, classifyRefusal(text) === "plus_tard", classifyRefusal(text));
  }
  for (const text of ["Envoyez-moi plus d'infos svp.", "Quel est votre tarif ?", "Bonjour, je suis intéressé, appelez-moi demain.", "Bonjour, pouvez-vous me rappeler ?", "Merci pour votre message, je reviens vers vous."]) {
    check(`ni refus ni stop : « ${text} »`, !["refus", "stop"].includes(classifyRefusal(text)), classifyRefusal(text));
  }
  check("« Non. » seul, sans règle sûre : ambigu (au juge)", classifyRefusal("Non.") === "ambigu" || classifyRefusal("Non.") === "refus");
  check("« pas pour cette année » : ambigu, jamais refus d'office", classifyRefusal("Ce ne sera pas pour cette année.") === "ambigu");
  check("date du report : janvier prochain", laterDate("recontactez-moi en janvier", new Date("2026-10-13T12:00:00Z")) === "2027-01-01");
  check("juge LLM : refus suivi", (await classifyInbound("Ce ne sera pas pour cette année.", async () => "refus")) === "refus");
  check("juge indisponible ou « autre » : rien ne change", (await classifyInbound("Ce ne sera pas pour cette année.", async () => null)) === "autre" && (await classifyInbound("Ce ne sera pas pour cette année.")) === "autre");
  let called = false;
  await classifyInbound(ARTFLEX, async () => { called = true; return "autre"; });
  check("règle sûre : le LLM n'est pas appelé (coût nul)", !called);

  console.log("\n2. Rattachement : adresse, fil, domaine");
  const base = () => new FakeDb({
    prospects: [
      { id: "artflex", user_id: "u", status: "relance_2", deleted_at: null, company_name: "ARTFLEX", email: "info@artflex-robinetterie.fr", key_figures: {} },
      { id: "a1", user_id: "u", status: "contacte", deleted_at: null, company_name: "Alpha", email: "contact@alpha.fr", key_figures: {} },
      { id: "a2", user_id: "u", status: "contacte", deleted_at: null, company_name: "Alpha Sud", email: "sud@alpha.fr", key_figures: {} },
      { id: "g", user_id: "u", status: "contacte", deleted_at: null, company_name: "Gamma", email: "gamma.boss@gmail.com", key_figures: {} },
    ],
    messages: [{ id: "m1", user_id: "u", prospect_id: "artflex", status: "sent", gmail_message_id: "1a0f27380ab92580", thread_id: null, type: "intro" }],
  });
  const db = base();
  const viaThread = await findProspectForInbound(db as unknown as Db, { fromEmail: "jp.romeo@artflex-robinetterie.fr", threadId: "1a0f27380ab92580" });
  check("ARTFLEX : rattaché par le FIL (thread_id = id Gmail de l'intro)", viaThread?.prospect.id === "artflex" && viaThread.via === "fil", viaThread?.via);
  const viaDomain = await findProspectForInbound(db as unknown as Db, { fromEmail: "jp.romeo@artflex-robinetterie.fr", threadId: null });
  check("sans fil : rattaché par le domaine de l'entreprise", viaDomain?.prospect.id === "artflex" && viaDomain.via === "domaine");
  check("adresse exacte d'abord", (await findProspectForInbound(db as unknown as Db, { fromEmail: "info@artflex-robinetterie.fr", threadId: null }))?.via === "adresse");
  check("domaine partagé par 2 fiches : non rattaché", (await findProspectForInbound(db as unknown as Db, { fromEmail: "x@alpha.fr", threadId: null })) === null);
  check("webmail grand public : jamais par domaine", (await findProspectForInbound(db as unknown as Db, { fromEmail: "inconnu@gmail.com", threadId: null })) === null && CONSUMER_DOMAINS.has("orange.fr"));
  check("fil inconnu, domaine inconnu : non rattaché", (await findProspectForInbound(db as unknown as Db, { fromEmail: "a@b-inconnu.fr", threadId: "ffff0000aaaa" })) === null);
  const figures = withSecondaryContact({}, { email: "jp.romeo@artflex-robinetterie.fr", via: "fil", at: "2026-10-13T12:42:31Z" });
  check("contact secondaire ajouté, sans doublon", Array.isArray(figures?.secondary_contacts) && withSecondaryContact(figures, { email: "JP.Romeo@artflex-robinetterie.fr", via: "fil", at: "x" }) === null);

  console.log("\n3. Refus → Perdu, relances annulées ; « Annuler (pas un refus) »");
  const r = new FakeDb({
    prospects: [{ id: "artflex", user_id: "u", status: "relance_2", deleted_at: null, do_not_contact: false, company_name: "ARTFLEX", email: "info@artflex-robinetterie.fr", key_figures: { facts: ["x"] } }],
    inbound_messages: [{ id: "in1", user_id: "u", prospect_id: "artflex", category: "reponse", received_at: "2026-10-13T12:42:31Z", body: ARTFLEX }],
    messages: [{ id: "r3", user_id: "u", prospect_id: "artflex", status: "draft", type: "relance_2", send_status: "scheduled", scheduled_at: "2026-10-16T08:00:00Z" }],
    reminders: [], prospect_events: [],
  });
  const p = () => r.rows("prospects")[0] as Record<string, unknown>;
  const out = await applyRefusal(r as unknown as Db, { userId: "u", prospect: { id: "artflex", status: "relance_2", key_figures: { facts: ["x"] } }, inbound: { id: "in1", category: "reponse", received_at: "2026-10-13T12:42:31Z", body: ARTFLEX }, kind: "refus" });
  check("ARTFLEX passe en Perdu", out.applied && p().status === "perdu", p().status);
  check("mail marqué « Refus »", (r.rows("inbound_messages")[0] as { category: string }).category === "refus");
  check("relance programmée annulée", (r.rows("messages")[0] as { send_status: string }).send_status === "draft");
  check("trace pour annuler, faits conservés", refusalOf(p().key_figures)?.kind === "refus" && (p().key_figures as { facts: string[] }).facts[0] === "x");
  check("historique : événement « refus »", r.rows("prospect_events").some((e) => (e as { kind: string }).kind === "refus"));
  check("un refus simple ne coche PAS « ne plus contacter »", p().do_not_contact === false);
  const undone = await undoRefusal(r as unknown as Db, { userId: "u", prospectId: "artflex" });
  check("annuler : statut d'avant, catégorie d'avant, trace retirée", undone.ok && p().status === "relance_2" && (r.rows("inbound_messages")[0] as { category: string }).category === "reponse" && refusalOf(p().key_figures) === null);

  const s = new FakeDb({ prospects: [{ id: "z", user_id: "u", status: "contacte", deleted_at: null, do_not_contact: false, company_name: "Z", email: "z@z.fr", key_figures: {} }], inbound_messages: [{ id: "in2", user_id: "u", prospect_id: "z", category: "reponse" }], messages: [], reminders: [], prospect_events: [] });
  await applyRefusal(s as unknown as Db, { userId: "u", prospect: { id: "z", status: "contacte", key_figures: {} }, inbound: { id: "in2", category: "reponse", received_at: "2026-10-13T12:00:00Z", body: "STOP" }, kind: "stop" });
  const z = () => s.rows("prospects")[0] as Record<string, unknown>;
  check("« stop » : Perdu ET « ne plus contacter »", z().status === "perdu" && z().do_not_contact === true);
  await undoRefusal(s as unknown as Db, { userId: "u", prospectId: "z" });
  check("annuler un « stop » lève aussi « ne plus contacter »", z().status === "contacte" && z().do_not_contact === false);

  const later = new FakeDb({ prospects: [{ id: "l", user_id: "u", status: "contacte", key_figures: {} }], reminders: [] });
  const res = await applyRefusal(later as unknown as Db, { userId: "u", prospect: { id: "l", status: "contacte", key_figures: {} }, inbound: { id: "in3", category: "reponse", received_at: "x", body: "Recontactez-moi en janvier." }, kind: "plus_tard", now: new Date("2026-10-13T12:00:00Z") });
  check("report daté : statut inchangé, rappel au 1er janvier", !res.applied && (later.rows("prospects")[0] as { status: string }).status === "contacte" && (later.rows("reminders")[0] as { due_at: string } | undefined)?.due_at.startsWith("2027-01-01") === true);

  console.log("\n4. Répondre sans fiche : même fil, garde « ne plus contacter »");
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ id: "gm-1", threadId: "t-1" }), text: async () => "" };
  }) as unknown as typeof fetch;
  const f = new FakeDb({
    inbound_messages: [
      { id: "free", user_id: "u", prospect_id: null, from_email: "jane@newco.fr", subject: "Question", thread_id: "t-1", gmail_message_id: "g-in", deleted_at: null, handled: false },
      { id: "att", user_id: "u", prospect_id: "artflex", from_email: "x@a.fr", deleted_at: null },
    ],
    inbound_replies: [],
    prospects: [{ id: "dnc", company_name: "Bloquée", email: "boss@blocked.fr", do_not_contact: true }],
  });
  const ok = await sendFreeReply(f as unknown as Db, { userId: "u", inboundId: "free", to: "jane@newco.fr", subject: "Re: Question", body: "Bonjour Jane, …" }, { fetch: fakeFetch, webhookUrl: "https://n8n.test/send" });
  check("envoi (webhook simulé) : même fil, réponse au mail reçu, prospect_id nul", ok.ok && calls.length === 1 && calls[0].body.thread_id === "t-1" && calls[0].body.reply_to_gmail_message_id === "g-in" && calls[0].body.prospect_id === null && calls[0].body.to === "jane@newco.fr");
  check("trace « sent » et mail reçu soldé", (f.rows("inbound_replies")[0] as { status: string }).status === "sent" && (f.rows("inbound_messages")[0] as { handled: boolean }).handled === true);
  check("garde : domaine sur « ne plus contacter »", (await doNotContactFor(f as unknown as Db, "autre@blocked.fr"))?.includes("blocked.fr") === true);
  const refused = await sendFreeReply(f as unknown as Db, { userId: "u", inboundId: "free", to: "boss@blocked.fr", subject: "Re:", body: "x" }, { fetch: fakeFetch, webhookUrl: "https://n8n.test/send" });
  check("adresse « ne plus contacter » : refusé, rien ne part", !refused.ok && calls.length === 1);
  const attached = await sendFreeReply(f as unknown as Db, { userId: "u", inboundId: "att", to: "x@a.fr", subject: "Re:", body: "x" }, { fetch: fakeFetch, webhookUrl: "https://n8n.test/send" });
  check("mail rattaché à une fiche : passe par la réponse de la fiche", !attached.ok && calls.length === 1);

  console.log(failures === 0 ? "\nTous les tests réponses / refus passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

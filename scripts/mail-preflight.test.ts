/**
 * Contrôle avant envoi — les 4 mails du 28/09 en fixtures. Aucun réseau.
 * Exécution : `npm run test:preflight`.
 */
import { SENT_0928, SIGNATURE } from "./mail-fixtures";
import {
  applyFix,
  applyGreeting,
  bodyWordCount,
  dedupeGreeting,
  extractSubjectLine,
  hasOptOut,
  normalizeSubject,
  OPT_OUT_SENTENCE,
  preflight,
  withOptOut,
  type PreflightInput,
} from "../lib/mail-preflight";
import { bodyParagraphs } from "../lib/emails/validate";
import { checkCoherence, proposeSubject, type CoherenceCache } from "../lib/mail-preflight/subject-ai";
import { inSendWindow, nextSendWindow, spreadSlots } from "../lib/mail-preflight/schedule";
import { formatScheduled, parisToUtc, utcToParis } from "../lib/outbox/paris-time";
import { FakeDb } from "./fake-supabase";
import type { Db } from "../lib/trash/scope";
import { runDueSends, scheduleMessage } from "../lib/outbox/scheduler";
import { sendNow } from "../lib/outbox/send";
import { cancelRelancesOnReply } from "../lib/outbox/relances";
import { setDoNotContact } from "../lib/outbox/do-not-contact";
import { scheduledItems } from "../lib/outbox/mailbox";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const input = (mail: (typeof SENT_0928)[keyof typeof SENT_0928], over: Partial<PreflightInput> = {}): PreflightInput => ({
  subject: mail.subject,
  body: mail.body,
  to: mail.to,
  signature: SIGNATURE,
  knownAddresses: mail.known,
  website: mail.website,
  ...over,
});
const rule = (result: ReturnType<typeof preflight>, id: string) => result.checks.find((check) => check.rule === id);

(async () => {
  console.log("\n1. Salutation");
  {
    const briol = preflight(input(SENT_0928.briol));
    check("BRIOL « Bonjour, Bonjour Monsieur Briol, » → erreur double salutation", rule(briol, "greeting")?.status === "error");
    check("BRIOL : envoi bloqué", !briol.ok);
    check("BRIOL : correction proposée", briol.fixes.some((fix) => fix.id === "dedupe-greeting"));
    const fixed = applyFix("dedupe-greeting", { subject: SENT_0928.briol.subject, body: SENT_0928.briol.body });
    check("BRIOL : 1 clic → « Bonjour Monsieur Briol, »", fixed.body.startsWith("Bonjour Monsieur Briol,\n\nAvec vos showrooms"), fixed.body.slice(0, 40));
    check("BRIOL corrigé : plus d'erreur de salutation", rule(preflight(input(SENT_0928.briol, fixed)), "greeting")?.status === "ok");
    check("salutations sur deux lignes : la nue part", dedupeGreeting("Bonjour,\n\nBonjour Claire,\n\nTexte.") === "Bonjour Claire,\n\nTexte.");
    check("corps qui salue déjà : rien n'est préfixé", applyGreeting("Bonjour Monsieur Briol,\n\nTexte.", "Bonjour,") === "Bonjour Monsieur Briol,\n\nTexte.");
    check("salutation insensible à la casse", applyGreeting("MADAME,\n\nTexte.", "Bonjour,") === "MADAME,\n\nTexte.");
    check("corps sans salutation : « Bonjour, » posé", applyGreeting("Texte.", "Bonjour,") === "Bonjour,\n\nTexte.");
    check("« Bonjour, » + « Bonjour X » générés → une seule", applyGreeting("Bonjour, Bonjour Claire,\n\nTexte.", "Bonjour,") === "Bonjour Claire,\n\nTexte.");
  }

  console.log("\n2. Objet");
  {
    const human = preflight(input(SENT_0928.humanSight));
    check("HUMAN SIGHT : ligne « Objet : » dans le corps → erreur", rule(human, "subject-line")?.status === "error");
    const moved = extractSubjectLine(SENT_0928.humanSight.body);
    check("HUMAN SIGHT : objet extrait", moved.subject === "Automatisations sur vos missions SIRH", String(moved.subject));
    check("HUMAN SIGHT : ligne retirée du corps", moved.body.startsWith("Bonjour Madame Durand,"), moved.body.slice(0, 30));
    const fixed = applyFix("move-subject", { subject: SENT_0928.humanSight.subject, body: SENT_0928.humanSight.body });
    check("HUMAN SIGHT : 1 clic → corps et objet propres", preflight(input(SENT_0928.humanSight, fixed)).ok, preflight(input(SENT_0928.humanSight, fixed)).errors.join(" | "));
    check("« Subject: » aussi détecté", rule(preflight(input(SENT_0928.bonnin, { body: `Subject: test\n\n${SENT_0928.bonnin.body}` })), "subject-line")?.status === "error");
    check("minuscule initiale → majuscule", normalizeSubject("listes de préparation des boutiques") === "Listes de préparation des boutiques");
    check("point final retiré", normalizeSubject("Devis de rénovation.") === "Devis de rénovation");
    check("« Re: » conservé, majuscule après", normalizeSubject("Re: suivi des devis") === "Re: Suivi des devis");
    const bonnin = preflight(input(SENT_0928.bonnin));
    check("BONNIN : objet en minuscule → avertissement + correction", rule(bonnin, "subject-format")?.status === "warning" && bonnin.fixes.some((fix) => fix.id === "normalize-subject"));
    check("objet > 60 caractères → avertissement", rule(preflight(input(SENT_0928.selection, { subject: "Un objet beaucoup trop long pour tenir dans la boîte de réception" })), "subject-format")?.status === "warning");
    check("objet vide → erreur", rule(preflight(input(SENT_0928.selection, { subject: "" })), "subject-format")?.status === "error");
    check("objet non relu → avertissement", rule(preflight(input(SENT_0928.selection, { subjectReviewed: false })), "subject-review")?.status === "warning");
  }

  console.log("\n3. Cohérence objet / corps (LLM simulé)");
  {
    let calls = 0;
    const ask = async (_system: string, user: string) => {
      calls += 1;
      const incoherent = /exp[ée]ditions/.test(user) && /devis/.test(user);
      return JSON.stringify(incoherent ? { coherent: false, reason: "l'objet parle d'expéditions, le corps de devis" } : { coherent: true, reason: "ok" });
    };
    const store = new Map<string, { coherent: boolean; reason: string }>();
    const cache: CoherenceCache = { get: async (hash) => store.get(hash) ?? null, set: async (hash, value) => void store.set(hash, value) };
    const verdict = await checkCoherence(ask, { subject: SENT_0928.briol.subject, body: SENT_0928.briol.body, signature: SIGNATURE }, cache);
    check("BRIOL « suivi des expéditions » sur un corps devis → incohérent", !verdict.coherent);
    const result = preflight(input(SENT_0928.briol, { body: dedupeGreeting(SENT_0928.briol.body), coherence: verdict }));
    check("incohérence = avertissement, pas un blocage", rule(result, "subject-coherence")?.status === "warning" && result.ok, result.errors.join(" | "));
    await checkCoherence(ask, { subject: SENT_0928.briol.subject, body: SENT_0928.briol.body, signature: SIGNATURE }, cache);
    check("mis en cache par empreinte objet + corps : 1 seul appel", calls === 1, String(calls));
    check("réponse illisible : pas de blocage", (await checkCoherence(async () => "???", { subject: "a", body: "b" })).coherent);
    const proposed = await proposeSubject(async () => JSON.stringify({ subject: "préparation des devis showroom." }), { body: SENT_0928.briol.body });
    check("objet proposé normalisé", proposed === "Préparation des devis showroom", String(proposed));
  }

  console.log("\n4. Autres règles bloquantes");
  {
    const long = `Bonjour,\n\n${"mot ".repeat(111)}\n\n${SIGNATURE}`;
    check("> 110 mots hors signature → erreur", rule(preflight(input(SENT_0928.selection, { body: long })), "words")?.status === "error");
    const exactly = `Bonjour,\n\n${"mot ".repeat(109)}\n\n${SIGNATURE}`;
    check("110 mots signature exclue → ok", rule(preflight(input(SENT_0928.selection, { body: exactly })), "words")?.status === "ok");
    for (const hole of ["[prénom]", "{{societe}}", "XXX", "à compléter", "adresse à confirmer"]) {
      const body = SENT_0928.selection.body.replace("C'est un sujet ?", `C'est un sujet ${hole} ?`);
      check(`placeholder ${hole} → erreur`, rule(preflight(input(SENT_0928.selection, { body })), "placeholders")?.status === "error");
    }
    check("destinataire absent → erreur", rule(preflight(input(SENT_0928.selection, { to: "" })), "recipient")?.status === "error");
    check("destinataire invalide → erreur", rule(preflight(input(SENT_0928.selection, { to: "contact@" })), "recipient")?.status === "error");
    check(
      "contact@<domaine> deviné, jamais trouvé → erreur",
      rule(preflight(input(SENT_0928.selection, { knownAddresses: [] })), "recipient")?.status === "error",
    );
    check("adresse trouvée (même contact@) → ok", rule(preflight(input(SENT_0928.selection)), "recipient")?.status === "ok");
    check("adresse saisie à la main, autre que la devinette → ok", rule(preflight(input(SENT_0928.selection, { to: "p.martin@selection-habitat.fr", knownAddresses: [] })), "recipient")?.status === "ok");
    const noSign = SENT_0928.selection.body.replace(`\n\n${SIGNATURE}`, "");
    check("signature absente → erreur", rule(preflight(input(SENT_0928.selection, { body: noSign })), "signature")?.status === "error");
    check("signature en double → erreur", rule(preflight(input(SENT_0928.selection, { body: `${SENT_0928.selection.body}\n\n${SIGNATURE}` })), "signature")?.status === "error");
    check("relance signée « Axel » seul → ok", rule(preflight(input(SENT_0928.selection, { body: "Bonjour,\n\nJe reviens vers vous.\n\nBien à vous,\nAxel" })), "signature")?.status === "ok");
    check("SELECTION HABITAT (sain) → passe", preflight(input(SENT_0928.selection)).ok, preflight(input(SENT_0928.selection)).errors.join(" | "));
  }

  console.log("\n5. Espacement des envois");
  {
    const nine = parisToUtc("2026-09-29", "09:00") as Date; // mardi
    let seed = 0.42;
    const random = () => (seed = (seed * 9301 + 49297) % 233280 / 233280);
    const slots = spreadSlots([nine, nine, nine, nine], [], random);
    const times = slots.map((slot) => utcToParis(slot).time);
    check("4 mails à 09:00 → 4 heures distinctes", new Set(times).size === 4, times.join(", "));
    const gaps = slots.slice(1).map((slot, index) => (slot.getTime() - slots[index].getTime()) / 60_000);
    check("écarts de 2 à 7 minutes, ordre conservé", gaps.every((gap) => gap >= 2 && gap <= 7), gaps.join(", "));
    check("le premier part à 09:00", times[0] === "09:00");
    const existing = spreadSlots([nine], [nine], random);
    check("un envoi déjà programmé ne bouge pas : le nouveau glisse", existing[0].getTime() > nine.getTime());
    check("heure réelle affichable", /9h0\d/.test(formatScheduled(slots[1].toISOString(), new Date("2026-09-28T10:00:00Z"))));
    const saturday = parisToUtc("2026-10-03", "10:00") as Date;
    check("samedi → lundi 8h", utcToParis(nextSendWindow(saturday)).date === "2026-10-05" && utcToParis(nextSendWindow(saturday)).time === "08:00");
    const early = parisToUtc("2026-09-29", "06:30") as Date;
    check("6h30 → 8h le jour même", utcToParis(nextSendWindow(early)).time === "08:00" && utcToParis(nextSendWindow(early)).date === "2026-09-29");
    const late = parisToUtc("2026-10-02", "18:00") as Date; // vendredi
    check("vendredi 18h → lundi 8h", utcToParis(nextSendWindow(late)).date === "2026-10-05");
    check("fenêtre : 17h59 ok, 18h00 non", inSendWindow(parisToUtc("2026-09-29", "17:59") as Date) && !inSendWindow(parisToUtc("2026-09-29", "18:00") as Date));
  }

  console.log("\n6. Branché sur l'envoi réel (faux Supabase, faux n8n)");
  {
    const T0 = parisToUtc("2026-09-29", "08:30") as Date; // mardi
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    const prospect = (id: string, over: Record<string, unknown> = {}) => ({
      id, user_id: "u1", company_name: id.toUpperCase(), website: null, email: null, key_figures: {}, status: "contacte",
      deleted_at: null, do_not_contact: false, created_at: T0.toISOString(), ...over,
    });
    const mail = (id: string, prospectId: string, fixture: (typeof SENT_0928)[keyof typeof SENT_0928], over: Record<string, unknown> = {}) => ({
      id, prospect_id: prospectId, user_id: "u1", type: "intro", subject: fixture.subject, body: fixture.body.replace(SIGNATURE, "Axel Remillat\nAutomatisation & IA en production pour PME · https://axelremillat.com"),
      status: "draft", sent_at: null, thread_id: null, created_at: T0.toISOString(), deleted_at: null, send_status: "draft",
      scheduled_at: null, scheduled_to: null, send_error: null, send_attempts: 0, ...over,
    });
    const calls: string[] = [];
    const deps = {
      webhookUrl: "https://n8n.test/send",
      fetch: (async (_url: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)).subject);
        return new Response(JSON.stringify({ id: "g1", threadId: "t1" }), { status: 200 });
      }) as unknown as typeof fetch,
    };
    const fake = new FakeDb({
      prospects: [
        prospect("briol", { email: SENT_0928.briol.to }),
        prospect("bonnin", { email: SENT_0928.bonnin.to }),
        prospect("human", { email: SENT_0928.humanSight.to }),
        prospect("selection", { email: SENT_0928.selection.to }),
      ],
      messages: [
        mail("m-briol", "briol", SENT_0928.briol, { send_status: "scheduled", scheduled_at: at(30).toISOString(), scheduled_to: SENT_0928.briol.to }),
        mail("m-bonnin", "bonnin", SENT_0928.bonnin),
        mail("m-human", "human", SENT_0928.humanSight),
        mail("m-selection", "selection", SENT_0928.selection),
      ],
      reminders: [],
      inbound_messages: [],
    } as Record<string, Record<string, unknown>[]>);
    const db = fake as unknown as Db;
    const row = (id: string) => fake.rows("messages").find((item) => item.id === id) as Record<string, unknown>;

    const refused = await scheduleMessage(db, { userId: "u1", messageId: "m-human", to: SENT_0928.humanSight.to, at: at(30) }, T0);
    check("programmation refusée : HUMAN SIGHT (« Objet : » dans le corps)", !refused.ok && /Objet/.test(refused.ok ? "" : refused.error), JSON.stringify(refused));

    const report = await runDueSends(db, { ...deps, now: at(31) });
    check("tick : BRIOL (déjà programmé) bloqué, rien n'est parti", report.blocked === 1 && calls.length === 0 && row("m-briol").send_status === "blocked", JSON.stringify(report));
    check("motif lisible dans send_error", /salutation/.test(String(row("m-briol").send_error)), String(row("m-briol").send_error));
    const items = scheduledItems(fake.rows("messages") as never, fake.rows("prospects") as never);
    check("visible dans Programmés, avec son texte", items.some((item) => item.id === "m-briol" && item.sendStatus === "blocked" && item.body.includes("showrooms")));

    const manual = await sendNow(db, { userId: "u1", messageId: "m-human", prospectId: "human", to: SENT_0928.humanSight.to }, deps);
    check("envoi manuel refusé aussi", !manual.ok && manual.kind === "preflight" && calls.length === 0);

    // 4 mails demandés à 09:00 → 4 heures distinctes, 2 à 7 min d'écart.
    for (const id of ["m-bonnin", "m-human", "m-selection", "m-briol"]) {
      const fixed = row(id);
      fixed.body = String(fixed.body).replace("Bonjour, Bonjour", "Bonjour").replace(/^Objet : .*\n\n/, "");
    }
    const nine = parisToUtc("2026-09-29", "09:00") as Date;
    let seed = 0.7;
    const random = () => (seed = (seed * 9301 + 49297) % 233280 / 233280);
    const planned: string[] = [];
    for (const [id, to] of [["m-bonnin", SENT_0928.bonnin.to], ["m-human", SENT_0928.humanSight.to], ["m-selection", SENT_0928.selection.to], ["m-briol", SENT_0928.briol.to]]) {
      const result = await scheduleMessage(db, { userId: "u1", messageId: id, to, at: nine }, T0, random);
      if (result.ok && result.scheduledAt) planned.push(result.scheduledAt);
      else planned.push(`refusé: ${result.ok ? "" : result.error}`);
    }
    const minutes = planned.map((iso) => new Date(iso).getTime());
    const gaps = minutes.slice(1).map((time, index) => (time - minutes[index]) / 60_000);
    check("4 mails à 09:00 → 4 heures distinctes", new Set(planned).size === 4 && planned.every((iso) => !iso.startsWith("refusé")), planned.join(" | "));
    check("écarts de 2 à 7 minutes, dans l'ordre", gaps.every((gap) => gap >= 2 && gap <= 7), gaps.join(", "));

    const night = await runDueSends(db, { ...deps, now: parisToUtc("2026-09-29", "19:00") as Date });
    check("tick à 19h : rien ne part (fenêtre 8h–18h)", night.outsideWindow && calls.length === 0);
    const first = await runDueSends(db, { ...deps, now: at(60) });
    check("tick à 9h30 : un seul départ, les autres retenus (2 min entre deux envois)", first.sent === 1 && first.spaced === 3, JSON.stringify(first));
    for (let minute = 61; minute <= 70; minute += 1) await runDueSends(db, { ...deps, now: at(minute) });
    check("puis un départ toutes les 2 min, objets en majuscule", calls.length === 4 && calls.every((subject) => /^\p{Lu}/u.test(subject)), calls.join(" | "));
  }

  console.log("\n7. Relances et réponses");
  {
    const T0 = parisToUtc("2026-09-29", "09:00") as Date;
    const relance = (id: string, prospectId: string) => ({
      id, prospect_id: prospectId, user_id: "u1", type: "relance_1", subject: "Re: Devis de rénovation",
      body: "Bonjour,\n\nJe reviens vers vous au sujet des devis.\n\nBien à vous,\nAxel", status: "draft", sent_at: null,
      thread_id: null, created_at: T0.toISOString(), deleted_at: null, send_status: "scheduled",
      scheduled_at: new Date(T0.getTime() + 3 * 86_400_000).toISOString(), scheduled_to: "p@x.fr", send_error: null, send_attempts: 0,
    });
    const fake = new FakeDb({
      prospects: [
        { id: "p1", user_id: "u1", company_name: "P1", email: "p@x.fr", key_figures: {}, website: null, status: "contacte", deleted_at: null, do_not_contact: false },
        { id: "p2", user_id: "u1", company_name: "P2", email: "p@x.fr", key_figures: {}, website: null, status: "contacte", deleted_at: null, do_not_contact: false },
      ],
      messages: [
        { id: "intro1", prospect_id: "p1", user_id: "u1", type: "intro", status: "sent", sent_at: "2026-09-28T07:00:00.000Z", body: "x", deleted_at: null, send_status: "sent" },
        relance("r1", "p1"),
        relance("r2", "p2"),
      ],
      reminders: [{ id: "rem1", prospect_id: "p1", user_id: "u1", due_at: "2026-10-02T07:00:00Z", done: false }],
      inbound_messages: [],
    } as Record<string, Record<string, unknown>[]>);
    const db = fake as unknown as Db;
    const row = (id: string) => fake.rows("messages").find((item) => item.id === id) as Record<string, unknown>;
    const cancelled = await cancelRelancesOnReply(db, { userId: "u1", prospectId: "p1", receivedAt: "2026-09-29T08:00:00Z" });
    check("réponse entrante → relance annulée", cancelled === 1 && row("r1").send_status === "draft" && row("r1").scheduled_at === null);
    check("motif affiché", /a répondu/.test(String(row("r1").send_error)), String(row("r1").send_error));
    check("rappel soldé", fake.rows("reminders")[0].done === true);
    check("l'autre prospect garde sa relance", row("r2").send_status === "scheduled");

    const dnc = await setDoNotContact(db, "p2", true);
    check("ne plus contacter : relance annulée", dnc.ok && row("r2").send_status === "draft");

    // Filet au départ : réponse enregistrée sans passer par l'annulation.
    fake.rows("messages").push({ ...relance("r3", "p1") });
    fake.rows("inbound_messages").push({ id: "in1", user_id: "u1", prospect_id: "p1", received_at: "2026-09-29T08:00:00.000Z", deleted_at: null });
    const deps = { webhookUrl: "https://n8n.test", fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch };
    const report = await runDueSends(db, { ...deps, now: new Date(T0.getTime() + 3 * 86_400_000 + 60_000) });
    check("relance échue après une réponse : bloquée au départ", row("r3").send_status === "blocked" && /répondu/.test(String(row("r3").send_error)), JSON.stringify(report));

  }

  console.log("\nPhrase d'opposition : une source, détection tolérante, placement, comptage");
  {
    const corps = "Bonjour Monsieur Briol,\n\nUne phrase de corps.\n\nÇa vous parle ?";
    check("absente : bloquant", rule(preflight({ ...input(SENT_0928.briol), body: `${corps}\n\n${SIGNATURE}` }), "opt-out")?.status === "error");
    check("la constante est reconnue", hasOptOut(OPT_OUT_SENTENCE));

    const variantes = [
      'Si le sujet ne vous concerne pas, un simple "stop" en réponse et je ne vous relancerai pas.',
      "Si le sujet ne vous concerne pas, un simple “STOP” en réponse et je ne vous relancerai pas.",
      "Si le sujet ne vous concerne pas, un simple « Stop » en réponse et je ne vous  relancerai pas.",
      "Un simple STOP et je ne vous recontacterai plus.",
      "Répondez stop : je n'ecrirai plus.",
      "Répondez stop : je n’écrirai plus.",
    ];
    for (const phrase of variantes) check(`variante acceptée : ${phrase.slice(0, 48)}…`, hasOptOut(phrase));
    check("« stop » seul ne suffit pas", !hasOptOut("Stop aux ressaisies manuelles."));
    check("« stoppé » n'est pas « stop »", !hasOptOut("Le projet a été stoppé, je vous relancerai."));

    const signe = withOptOut(`${corps}\n\n${SIGNATURE}`, SIGNATURE);
    check("placée juste avant la signature connue", signe.endsWith(`${OPT_OUT_SENTENCE}\n\n${SIGNATURE}`), signe);
    check("idempotente", withOptOut(signe, SIGNATURE) === signe);
    const politesse = withOptOut(`${corps}\n\nBien à vous,\n\nAxel`);
    check("signature inconnue : avant la formule de politesse", politesse.endsWith(`${OPT_OUT_SENTENCE}\n\nBien à vous,\n\nAxel`), politesse);
    const nom = withOptOut(`${corps}\n\n${SIGNATURE}`);
    check("signature inconnue : jamais sous le nom", nom.endsWith(`${OPT_OUT_SENTENCE}\n\n${SIGNATURE}`), nom);
    check("bouton « Ajouter la mention » : même texte, même place", applyFix("add-opt-out", { subject: "x", body: `${corps}\n\n${SIGNATURE}` }, SIGNATURE).body === signe);
    check("après ajout : contrôle passé", rule(preflight({ ...input(SENT_0928.briol), body: signe }), "opt-out")?.status !== "error");

    check("hors comptage : même nombre de mots avec ou sans", bodyWordCount(signe, SIGNATURE) === bodyWordCount(`${corps}\n\n${SIGNATURE}`, SIGNATURE));
    check(
      "validateur de génération : même corps compté (4 paragraphes, pas 5)",
      bodyParagraphs(signe.replace(corps, "Bonjour,\n\nA.\n\nB.\n\nC.\n\nD ?"), SIGNATURE).length === 4,
    );
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

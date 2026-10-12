/**
 * Réponses automatiques (challenge anti-spam, absence) — 05/10/2026 : AKTID a
 * « répondu » par un challenge Mailinblack, compté comme réponse (6 %).
 * Fixtures seulement : fausse base, aucun envoi, aucun appel réseau.
 * `npm run test:reponses-auto`
 */
import { absenceReturnDate, antispamLink, autoReplyKind, isProspectReply } from "../lib/inbound/auto-reply";
import { findAntispamProspect, followUpAfter, reclassifyAbsence, setAntispamValidated, shiftFollowUpsAfterReturn } from "../lib/inbound/auto-reply-server";
import { replySinceLastSend } from "../lib/outbox/relances";
import { buildVolumes } from "../lib/settings/volumes";
import { outcomeOf } from "../lib/variants/stats";
import { buildHistory } from "../lib/history/build";
import type { Db } from "../lib/trash/scope";
import { FakeDb } from "./fake-supabase";
import { inboxEntries } from "../app/(app)/cockpit/_lib/compute";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

// Le cas réel du 05/10, reconstitué (corps type Mailinblack, liens fictifs).
const AKTID = {
  id: "in-aktid",
  from_email: "aktid@invitations.mailinblack.com",
  subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL",
  body: "Bonjour,\nVotre message à contact@aktid.fr est en attente de validation.\nUN CLIC POUR DÉLIVRER VOTRE EMAIL : https://invitations.mailinblack.com/validate?token=abc123.\nPub : https://evil.example.com/validate\nMailinblack",
  received_at: "2026-10-05T09:23:00Z",
};
const REAL = { from_email: "dirigeant@maviflex.fr", subject: "Re: Votre proposition", body: "Bonjour, oui ça m'intéresse, appelez-moi jeudi.", received_at: "2026-10-05T10:00:00Z" };
const BOUNCE = { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "Adresse introuvable", received_at: "2026-10-05T10:00:00Z" };

async function main() {
  console.log("\n1. Détection");
  {
    check("Mailinblack (cas AKTID) → validation anti-spam", autoReplyKind(AKTID) === "antispam");
    check("autre service : « sender verification » dans le texte → anti-spam", autoReplyKind({ from_email: "verify@protect.example.net", subject: "Sender verification required", body: "Please confirm." }) === "antispam");
    check("« cliquez ici pour délivrer » → anti-spam", autoReplyKind({ from_email: "noreply@x.fr", subject: "Message en attente", body: "Cliquez ici pour délivrer votre message." }) === "antispam");
    check("objet « Réponse automatique : … » → réponse auto", autoReplyKind({ from_email: "a@b.fr", subject: "Réponse automatique : Votre proposition", body: "Merci pour votre message." }) === "absence");
    check("« Out of Office » → réponse auto", autoReplyKind({ from_email: "a@b.com", subject: "Out of Office: hello", body: "I am away." }) === "absence");
    check("corps « Je suis absent jusqu'au… » (vacances Gmail, objet Re:) → réponse auto", autoReplyKind({ from_email: "a@b.fr", subject: "Re: Votre proposition", body: "Je suis absent jusqu'au 12/10, je vous répondrai à mon retour." }) === "absence");
    check("en-tête Auto-Submitted: auto-replied → réponse auto", autoReplyKind({ from_email: "a@b.fr", subject: "Re: x", body: "Bien reçu.", auto_submitted: "auto-replied" }) === "absence");
    check("vraie réponse → rien d'automatique", autoReplyKind(REAL) === null && isProspectReply(REAL));
    check("rebond : ni réponse, ni réponse auto (géré à part)", autoReplyKind(BOUNCE) === null && !isProspectReply(BOUNCE));
    check("anti-spam : pas une réponse du prospect", !isProspectReply(AKTID));
  }

  console.log("\n2. Lien de validation");
  {
    check("lien du domaine de l'expéditeur (mailinblack.com), ponctuation retirée", antispamLink(AKTID) === "https://invitations.mailinblack.com/validate?token=abc123", antispamLink(AKTID));
    check("lien d'un autre domaine : jamais proposé", antispamLink({ ...AKTID, body: "Validez ici : https://evil.example.com/validate" }) === null);
    check("lien http (non chiffré) : refusé", antispamLink({ ...AKTID, body: "http://invitations.mailinblack.com/v" }) === null);
    check("vraie réponse : pas de lien", antispamLink({ ...REAL, body: "voir https://maviflex.fr" }) === null);
  }

  console.log("\n3. Date de retour");
  {
    const at = (body: string, received = "2026-10-05T09:00:00Z") => absenceReturnDate({ from_email: "a@b.fr", subject: "Absence", body, received_at: received });
    check("« de retour le 12/10 » → 2026-10-12", at("Je suis absent, de retour le 12/10.") === "2026-10-12", at("Je suis absent, de retour le 12/10."));
    check("« jusqu'au 14 octobre » → 2026-10-14", at("Absente jusqu'au 14 octobre inclus.") === "2026-10-14");
    check("« de retour le 5 janvier » reçu en décembre → année suivante", at("De retour le 5 janvier.", "2026-12-20T09:00:00Z") === "2027-01-05");
    check("pas de date : null (on ne devine pas)", at("Je suis absent quelques jours.") === null);
    check("lendemain du retour, 9 h Paris, hors week-end (ven. 09/10 → lun. 12/10)", followUpAfter("2026-10-09")?.toISOString() === "2026-10-12T07:00:00.000Z", followUpAfter("2026-10-09"));
  }

  console.log("\n4. Hors du taux de réponse");
  {
    const volumes = buildVolumes({ prospects: [], messages: [{ status: "sent" }, { status: "sent" }], inbound: [AKTID, BOUNCE, REAL], tags: [] });
    check("Réglages › Données : 1 réponse (anti-spam et rebond exclus)", volumes.replies === 1 && volumes.bounces === 1, volumes);
    const sent = { prospect_id: "p1", sent_at: "2026-10-05T07:00:00Z" } as Parameters<typeof outcomeOf>[0];
    check("variantes : un challenge anti-spam n'est pas une réponse", outcomeOf(sent, [{ ...AKTID, prospect_id: "p1", category: "question" }] as never) === null);
    const history = buildHistory({ id: "p1", created_at: "2026-10-01T00:00:00Z", inbound_messages: [{ ...AKTID, category: "question", deleted_at: null }] } as never, new Date("2026-10-05T12:00:00Z"));
    const received = history.events.find((event) => event.kind === "received");
    check("historique : badge « validation anti-spam », 0 reçu", history.summary.received === 0 && received?.badge?.label === "validation anti-spam", history.summary);
  }

  console.log("\n5. Les relances continuent");
  {
    const fake = new FakeDb({
      messages: [{ id: "m1", user_id: "u1", prospect_id: "p1", type: "intro", status: "sent", sent_at: "2026-10-05T07:00:00Z", deleted_at: null }],
      inbound_messages: [{ ...AKTID, user_id: "u1", prospect_id: "p1", deleted_at: null }],
    } as Record<string, Record<string, unknown>[]>);
    const db = fake as unknown as Db;
    check("anti-spam seul : aucune réponse, la relance reste permise", (await replySinceLastSend(db, "u1", "p1")) === null);
    fake.rows("inbound_messages").push({ id: "in-real", ...REAL, user_id: "u1", prospect_id: "p1", deleted_at: null });
    check("vraie réponse ensuite : la relance est bloquée", (await replySinceLastSend(db, "u1", "p1")) === REAL.received_at);
  }

  console.log("\n6. Absence datée : relance décalée après le retour");
  {
    const fake = new FakeDb({
      messages: [
        { id: "r1", user_id: "u1", prospect_id: "p1", type: "relance_1", status: "draft", send_status: "scheduled", scheduled_at: "2026-10-08T07:00:00Z" },
        { id: "r2", user_id: "u1", prospect_id: "p1", type: "relance_2", status: "draft", send_status: "scheduled", scheduled_at: "2026-10-20T07:00:00Z" },
      ],
      reminders: [{ id: "rem", user_id: "u1", prospect_id: "p1", done: false, due_at: "2026-10-08T07:00:00Z" }],
    } as Record<string, Record<string, unknown>[]>);
    const moved = await shiftFollowUpsAfterReturn(fake as unknown as Db, { userId: "u1", prospectId: "p1", returnDate: "2026-10-12" });
    const rows = fake.rows("messages");
    check("relance avant le retour → lendemain du retour, 9 h", moved === 1 && rows[0].scheduled_at === "2026-10-13T07:00:00.000Z", rows[0]);
    check("relance déjà après le retour : inchangée", rows[1].scheduled_at === "2026-10-20T07:00:00Z");
    check("rappel décalé aussi, rien d'annulé", fake.rows("reminders")[0].due_at === "2026-10-13T07:00:00.000Z" && fake.rows("reminders")[0].done === false);
  }

  console.log("\n7. « Validé » (reclassement de l'existant, sans suppression)");
  {
    const fake = new FakeDb({
      prospects: [{ id: "p-aktid", user_id: "u1", company_name: "AKTID", email: "contact@aktid.fr", status: "repondu", key_figures: { opposition_checked: true }, deleted_at: null }],
      messages: [{ id: "m1", user_id: "u1", prospect_id: "p-aktid", type: "intro", status: "sent", sent_at: "2026-10-05T07:21:00Z", deleted_at: null }],
      inbound_messages: [{ ...AKTID, user_id: "u1", prospect_id: null, category: "question", handled: false, deleted_at: null }],
      prospect_events: [],
    } as Record<string, Record<string, unknown>[]>);
    const db = fake as unknown as Db;
    check("rattachement : contact@aktid.fr cité dans le mail", (await findAntispamProspect(db, AKTID, "u1"))?.id === "p-aktid");
    check("rattachement sans adresse citée : « aktid » → domaine aktid.fr", (await findAntispamProspect(db, { ...AKTID, body: "Un clic pour délivrer." }, "u1"))?.id === "p-aktid");
    const before = inboxEntries(fake.rows("inbound_messages") as never, fake.rows("prospects") as never, Number.POSITIVE_INFINITY);
    check("visible : dans Reçus, non lu, badge anti-spam, lien proposé, à valider (bandeau Cockpit)", before.length === 1 && before[0].unread && before[0].autoKind === "antispam" && Boolean(before[0].validationLink) && !before[0].validated, before[0]);
    const result = await setAntispamValidated(db, { userId: "u1", inboundId: "in-aktid", validated: true, now: new Date("2026-10-05T12:00:00Z") });
    const prospect = fake.rows("prospects")[0];
    const inbound = fake.rows("inbound_messages")[0];
    check("Validé : fiche marquée délivrée", result.ok && (prospect.key_figures as Record<string, unknown>).antispam_validated_at === "2026-10-05T12:00:00.000Z", result);
    check("« Répondu » à tort → « Contacté » (statut de l'intro)", prospect.status === "contacte", prospect.status);
    check("mail reçu conservé, rattaché, soldé ; catégorie n8n intacte", fake.rows("inbound_messages").length === 1 && inbound.prospect_id === "p-aktid" && inbound.handled === true && inbound.category === "question");
    check("historique : validation tracée", fake.rows("prospect_events").some((event) => event.kind === "antispam"));
    const after = inboxEntries(fake.rows("inbound_messages") as never, fake.rows("prospects") as never, Number.POSITIVE_INFINITY);
    check("après « Validé » : toujours dans Reçus, validé (plus de bandeau)", after.length === 1 && after[0].validated && after[0].autoKind === "antispam");
    const refused = await setAntispamValidated(db, { userId: "u1", inboundId: "in-real", validated: true });
    check("mail inconnu ou non anti-spam : refus", !refused.ok);
  }

  console.log("\n8. Absence française sans en-tête (Cowork #49, cas réel du 12/10 anonymisé)");
  {
    // Absence réelle reçue le 12/10, une minute après l'intro : noms, adresse et société retirés.
    const ABSENT = {
      id: "in-absent",
      from_email: "dirigeant@exemple-medical.fr",
      subject: "Re: Demandes d'assistance",
      body: "Bonjour,\n\nJe serai indisponible du 12 au 16 octobre inclus et prendrai connaissance de votre message à mon retour, le lundi 19 octobre.\n\nEn cas d'urgence, vous pouvez contacter ma collègue à l'adresse habituelle.\n\nMerci de votre compréhension.\n\nCordialement,\n\nLe président\n\n---\n\nHello,\n\nI will be unavailable from October 12 to 16, inclusive, and will review your message upon my return on Monday, October 19.",
      received_at: "2026-10-12T08:16:13Z",
    };
    check("« Je serai indisponible du … au … » sans Auto-Submitted → absence", autoReplyKind(ABSENT) === "absence");
    check("… pas une réponse du prospect (hors taux de réponse)", !isProspectReply(ABSENT));
    check("date de retour « à mon retour, le lundi 19 octobre » → 2026-10-19", absenceReturnDate(ABSENT) === "2026-10-19", absenceReturnDate(ABSENT));
    check("relance suivante : mardi 20/10, 9 h à Paris", followUpAfter("2026-10-19")?.toISOString() === "2026-10-20T07:00:00.000Z");
    const plain = (body: string) => autoReplyKind({ from_email: "a@b.fr", subject: "Re: Votre proposition", body });
    check("« Je serai absente du 12 au 16 octobre » → absence", plain("Bonjour,\nJe serai absente du 12 au 16 octobre.") === "absence");
    check("« je prendrai connaissance de votre message à mon retour » → absence", plain("Bonjour, je prendrai connaissance de votre message à mon retour.") === "absence");
    check("« En cas d'urgence, vous pouvez contacter … » → absence", plain("Bonjour,\nEn cas d'urgence, vous pouvez contacter le standard.") === "absence");
    check("« De retour le 19/10 » → absence", plain("De retour le 19/10.") === "absence");
    check("vraie réponse qui cite une date : pas une absence", plain("Bonjour, intéressé. Appelez-moi mardi 14 à 10 h, je serai au bureau.") === null);
    const range = (body: string) => absenceReturnDate({ from_email: "a@b.fr", subject: "Re: x", body, received_at: "2026-10-12T08:00:00Z" });
    check("période seule « du 12 au 16 octobre inclus » → retour le 17", range("Je serai indisponible du 12 au 16 octobre inclus.") === "2026-10-17");
    check("période en fin de mois « du 20 au 31 octobre » → retour le 1er novembre", range("Je suis en congés du 20 au 31 octobre.") === "2026-11-01");
    check("date explicite prioritaire sur la période", range("Absente du 12 au 16 octobre, de retour le 20 octobre.") === "2026-10-20");

    // Reclassement de l'existant : la fiche était passée « Répondu », le rappel soldé.
    const fake = new FakeDb({
      prospects: [{ id: "p-abs", user_id: "u1", company_name: "EXEMPLE MEDICAL", status: "repondu", deleted_at: null }],
      messages: [{ id: "intro", user_id: "u1", prospect_id: "p-abs", type: "intro", status: "sent", send_status: "sent", sent_at: "2026-10-12T08:15:00Z", deleted_at: null }],
      inbound_messages: [{ ...ABSENT, user_id: "u1", prospect_id: "p-abs", category: "reponse", handled: false, deleted_at: null }],
      reminders: [{ id: "rem", user_id: "u1", prospect_id: "p-abs", done: true, due_at: "2026-10-16T08:15:00Z", created_at: "2026-10-12T08:15:05Z" }],
      prospect_events: [],
    } as Record<string, Record<string, unknown>[]>);
    const db = fake as unknown as Db;
    const dry = await reclassifyAbsence(db, { userId: "u1", inboundId: "in-absent", apply: false });
    check("lecture seule : dit ce qui serait fait, n'écrit rien", dry?.statusRestored === "contacte" && dry.followUpAt === "2026-10-20T07:00:00.000Z" && fake.rows("prospects")[0].status === "repondu" && fake.rows("reminders")[0].done === true, dry);
    const done = await reclassifyAbsence(db, { userId: "u1", inboundId: "in-absent", apply: true, now: new Date("2026-10-12T12:00:00Z") });
    check("fiche « Répondu » → « Contacté » (statut du dernier envoi)", fake.rows("prospects")[0].status === "contacte", done);
    check("catégorie n8n « reponse » → « autre » (badge « Absence » par la détection)", fake.rows("inbound_messages")[0].category === "autre" && done?.categoryFrom === "reponse");
    check("rappel rouvert et reporté au mardi 20/10 9 h (lendemain du retour)", fake.rows("reminders")[0].done === false && fake.rows("reminders")[0].due_at === "2026-10-20T07:00:00.000Z", fake.rows("reminders")[0]);
    check("rien supprimé, rien d'envoyé ni de programmé", fake.rows("messages").length === 1 && fake.rows("inbound_messages").length === 1 && fake.rows("reminders").length === 1);

    // Absence sans date de retour lisible : le rappel est rouvert à sa date d'origine.
    const undated = new FakeDb({
      prospects: [{ id: "p2", user_id: "u1", status: "repondu", deleted_at: null }],
      messages: [{ id: "i2", user_id: "u1", prospect_id: "p2", type: "intro", status: "sent", send_status: "sent", sent_at: "2026-10-12T08:15:00Z", deleted_at: null }],
      inbound_messages: [{ id: "in2", user_id: "u1", prospect_id: "p2", from_email: "a@b.fr", subject: "Re: x", body: "Bonjour,\nJe serai absent cette semaine. En cas d'urgence, vous pouvez contacter le standard.", category: "question", received_at: "2026-10-12T09:00:00Z", deleted_at: null }],
      reminders: [{ id: "rem2", user_id: "u1", prospect_id: "p2", done: true, due_at: "2026-10-16T08:15:00Z", created_at: "2026-10-12T08:15:05Z" }],
      prospect_events: [],
    } as Record<string, Record<string, unknown>[]>);
    await reclassifyAbsence(undated as unknown as Db, { userId: "u1", inboundId: "in2", apply: true });
    check("absence sans date : rappel rouvert à sa date d'origine (les relances continuent)", undated.rows("reminders")[0].done === false && undated.rows("reminders")[0].due_at === "2026-10-16T08:15:00Z", undated.rows("reminders")[0]);

    // Une VRAIE réponse après l'envoi : on ne touche à rien.
    const real = new FakeDb({
      prospects: [{ id: "p3", user_id: "u1", status: "repondu", deleted_at: null }],
      messages: [{ id: "i3", user_id: "u1", prospect_id: "p3", type: "intro", status: "sent", send_status: "sent", sent_at: "2026-10-12T08:15:00Z", deleted_at: null }],
      inbound_messages: [
        { id: "in3", user_id: "u1", prospect_id: "p3", from_email: "a@b.fr", subject: "Re: x", body: "Je serai absent du 12 au 16 octobre.", category: "reponse", received_at: "2026-10-12T09:00:00Z", deleted_at: null },
        { id: "in4", user_id: "u1", prospect_id: "p3", from_email: "a@b.fr", subject: "Re: x", body: "Finalement oui, appelons-nous.", category: "reponse", received_at: "2026-10-12T10:00:00Z", deleted_at: null },
      ],
      reminders: [],
      prospect_events: [],
    } as Record<string, Record<string, unknown>[]>);
    await reclassifyAbsence(real as unknown as Db, { userId: "u1", inboundId: "in3", apply: true });
    check("vraie réponse ensuite : la fiche reste « Répondu », aucun rappel", real.rows("prospects")[0].status === "repondu" && real.rows("reminders").length === 0);
  }

  console.log(failures === 0 ? "\nTous les tests des réponses automatiques passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

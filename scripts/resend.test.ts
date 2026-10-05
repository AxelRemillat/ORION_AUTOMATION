/**
 * « Renvoyer » un mail en échec (05/10/2026 : credential Gmail expiré côté n8n,
 * 4 intros en échec — SPI ENERGIE, MAVIFLEX, LE PAIN DE BELLEDONNE, AKTID).
 * Fixtures seulement : faux n8n, fausse base, aucun envoi réel.
 * `npm run test:renvoi`
 */
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";
import { prepareResend, resendLater, resendNow } from "../lib/outbox/resend";
import { checkSendRules, type OutboxMessage } from "../lib/outbox/send";
import { GMAIL_AUTH_MESSAGE, isGmailAuthError, readableSendError } from "../lib/outbox/send-errors";
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

const RAW = 'Échec après 3 tentatives : n8n a répondu 500. {"message":"Error in workflow"}';
const NOW = new Date("2026-10-05T10:00:00Z"); // lundi 12 h à Paris

const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", company_name: id.toUpperCase(), status: "a_contacter", email: `contact@${id}.fr`, website: null,
  deleted_at: null, do_not_contact: false, key_figures: { opposition_checked: true, opposition_source: "inpi" }, ...over,
});
const failed = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", prospect_id: prospectId, type: "intro", status: "draft", send_status: "failed", send_attempts: 3,
  send_error: RAW, scheduled_at: "2026-10-05T07:21:00Z", scheduled_to: `contact@${prospectId}.fr`, gmail_message_id: null,
  subject: "Objet", body: `Bonjour,\n\nCorps.\n\n${OPT_OUT_SENTENCE}\n\nAxel Remillat`, thread_id: null, deleted_at: null,
  reply_to_inbound_id: null, reply_to_gmail_message_id: null, created_at: "2026-10-04T16:00:00Z", ...over,
});

function seed(extra: Record<string, unknown[]> = {}) {
  const fake = new FakeDb({
    prospects: [prospect("aktid"), prospect("maviflex"), prospect("oppose", { key_figures: { refuses_prospecting: true } }), prospect("dnc", { do_not_contact: true }), prospect("muet", { key_figures: { opposition_checked: true, unreachable: { reason: "x" } } }), prospect("stop"), prospect("envoye")],
    messages: [failed("m-aktid", "aktid"), failed("m-mav", "maviflex"), failed("m-opp", "oppose"), failed("m-dnc", "dnc"), failed("m-muet", "muet"), failed("m-stop", "stop"), failed("m-parti", "maviflex", { gmail_message_id: "gmail-123" }), failed("m-ok", "envoye", { send_status: "sent", status: "sent" })],
    inbound_messages: [{ id: "in-stop", user_id: "u1", prospect_id: "stop", from_email: "x@stop.fr", subject: "Re", body: "STOP merci", received_at: "2026-10-04T09:00:00Z", deleted_at: null, handled: true }],
    reminders: [], prospect_events: [], action_states: [],
    ...extra,
  } as Record<string, Record<string, unknown>[]>);
  return { fake, db: fake as unknown as Db };
}

/** Faux n8n : répond 200 avec un identifiant Gmail. */
function n8n() {
  const calls: { to: string }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "gmail-ok", threadId: "thread-ok" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, deps: { fetch: fetchImpl, webhookUrl: "https://n8n.test/send", now: NOW } };
}

async function main() {
  console.log("\n1. Message d'erreur lisible");
  {
    check("n8n 500 « Error in workflow » (cas réel du 05/10) → connexion Gmail expirée", readableSendError(RAW) === GMAIL_AUTH_MESSAGE && isGmailAuthError(RAW));
    check("« credential » / « reconnect » → même message", isGmailAuthError('n8n a répondu 400. {"message":"Credential needs to be reconnected"}'));
    check("autre erreur : enveloppe JSON retirée, sens gardé", readableSendError('n8n a répondu 422. {"message":"Adresse refusée"}') === "n8n a répondu 422. Adresse refusée");
    check("erreur métier inchangée (pas confondue avec Gmail)", readableSendError("Destinataire invalide.") === "Destinataire invalide." && !isGmailAuthError("Destinataire invalide."));
  }

  console.log("\n2. Garde-fous du renvoi");
  {
    const { db } = seed();
    const refuse = async (id: string, pattern: RegExp, label: string) => {
      const result = await prepareResend(db, { userId: "u1", messageId: id, now: NOW });
      check(label, !result.ok && pattern.test(result.error), result);
    };
    await refuse("m-parti", /identifiant d'envoi Gmail/, "déjà un identifiant Gmail : refus (anti-doublon)");
    await refuse("m-ok", /déjà envoyé|identifiant|échec/, "mail envoyé : refus");
    await refuse("m-opp", /opposé/, "prospect opposé : refus");
    await refuse("m-dnc", /ne plus contacter/, "« ne plus contacter » : refus");
    await refuse("m-muet", /non joignable/, "« non joignable » : refus");
    await refuse("m-stop", /stop/, "a répondu « stop » : refus");
    const anti = await checkSendRules(db, failed("x", "maviflex", { gmail_message_id: "gmail-123" }) as unknown as OutboxMessage, "a@b.fr", NOW);
    check("règles d'envoi communes : un mail avec identifiant Gmail ne repart jamais", Boolean(anti && !anti.ok && /identifiant d'envoi Gmail/.test(anti.error)));
  }

  console.log("\n3. Renvoyer maintenant (même contenu, même destinataire)");
  {
    const { fake, db } = seed();
    const web = n8n();
    const result = await resendNow(db, { userId: "u1", messageId: "m-aktid" }, web.deps);
    const row = fake.rows("messages").find((m) => m.id === "m-aktid")!;
    check("renvoyé via le circuit normal : parti, identifiant Gmail enregistré", result.ok && row.status === "sent" && row.gmail_message_id === "gmail-ok", result);
    check("même destinataire que la tentative ratée", web.calls.length === 1 && web.calls[0].to === "contact@aktid.fr", web.calls);
    const event = fake.rows("prospect_events").find((e) => e.prospect_id === "aktid" && e.kind === "send_failed");
    check("l'échec reste dans l'historique (lisible, brut conservé)", (event?.data as Record<string, unknown>)?.detail === GMAIL_AUTH_MESSAGE && (event?.data as Record<string, unknown>)?.raw === RAW && (event?.data as Record<string, unknown>)?.attempts === 3, event);
    const again = await resendNow(db, { userId: "u1", messageId: "m-aktid" }, web.deps);
    check("second clic : refusé, aucun doublon envoyé", !again.ok && web.calls.length === 1, again);
    const blocked = await resendNow(db, { userId: "u1", messageId: "m-opp" }, web.deps);
    const kept = fake.rows("messages").find((m) => m.id === "m-opp")!;
    check("renvoi refusé : le mail reste en « Échec », compteur intact", !blocked.ok && kept.send_status === "failed" && kept.send_attempts === 3, kept);
  }

  console.log("\n4. Programmer le renvoi");
  {
    const { fake, db } = seed();
    const result = await resendLater(db, { userId: "u1", messageId: "m-mav", to: "contact@maviflex.fr", at: new Date("2026-10-06T07:00:00Z") }, NOW);
    const row = fake.rows("messages").find((m) => m.id === "m-mav")!;
    check("programmé, tentatives remises à 0, erreur effacée", result.ok && row.send_status === "scheduled" && row.send_attempts === 0 && row.send_error === null, row);
    check("rien n'est parti (programmé seulement)", row.status === "draft" && !row.gmail_message_id);
  }

  console.log(failures === 0 ? "\nTous les tests du renvoi passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

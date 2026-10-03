/**
 * Relances interdites (03/10/2026) : jamais proposées ni programmées pour un
 * prospect opposé, « ne plus contacter », perdu ou qui a répondu. Cas réels :
 * HUMAN SIGHT, SELECTION HABITAT, BRIOL DIFFUSION, SARL BONNIN FRERES — tous
 * opposés, intro partie le 28/09, relance ouverte au 02/10. Fixtures seulement.
 * `npm run test:relances`
 */
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";
import { draftFollowUp } from "../lib/outbox/follow-up";
import { followUpBlock } from "../lib/outbox/follow-up-policy";
import { checkSendRules, type OutboxMessage } from "../lib/outbox/send";
import { flatten } from "../lib/today/group";
import { loadToday } from "../lib/today/load";
import type { Db } from "../lib/trash/scope";
import type { Prospect } from "../types";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const USER = "u1";
const OPPOSED = ["HUMAN SIGHT", "SELECTION HABITAT", "BRIOL DIFFUSION", "SARL BONNIN FRERES"];
const id = (name: string) => name.toLowerCase().replace(/\W+/g, "-");
const prospect = (name: string, over: Record<string, unknown> = {}) => ({
  id: id(name), user_id: USER, company_name: name, siren: null, status: "contacte", email: `contact@${id(name)}.fr`, website: null,
  deleted_at: null, do_not_contact: false, key_figures: { refuses_prospecting: true }, signals: [], business_profile: null, ...over,
});
const sentIntro = (prospectId: string) => ({
  id: `intro-${prospectId}`, user_id: USER, prospect_id: prospectId, type: "intro", status: "sent", send_status: "sent",
  sent_at: "2026-09-28T07:00:03.662Z", created_at: "2026-09-27T20:00:00Z", deleted_at: null, subject: "Objet", body: "Bonjour", gmail_message_id: "g", thread_id: "t",
});
const reminder = (prospectId: string) => ({ id: `r-${prospectId}`, user_id: USER, prospect_id: prospectId, due_at: "2026-10-02T07:00:03Z", done: false });

async function main() {
  console.log("\n1. La règle");
  {
    check("opposé à la prospection : refusée", followUpBlock({ status: "contacte", key_figures: { refuses_prospecting: true } }) === "opposé à la prospection");
    check("« ne plus contacter » : refusée", followUpBlock({ status: "contacte", do_not_contact: true }) === "ne plus contacter");
    check("perdu : refusée", followUpBlock({ status: "perdu" }) === "perdu");
    check("a répondu (statut) : refusée", followUpBlock({ status: "repondu" }) === "a répondu" && followUpBlock({ status: "en_discussion" }) === "a répondu");
    check("a répondu (réponse reçue, statut pas encore à jour) : refusée", followUpBlock({ status: "contacte" }, { replied: true }) === "a répondu");
    check("contacté, sans opposition ni réponse : permise", followUpBlock({ status: "contacte", key_figures: { pappers_read: true } }) === null);
  }

  console.log("\n2. « Aujourd'hui » : les quatre opposés n'apparaissent jamais en relance");
  {
    const control = prospect("TEMOIN SAS", { key_figures: { pappers_read: true } });
    const replied = prospect("REPONDU SARL", { key_figures: { pappers_read: true } });
    const all = [...OPPOSED.map((name) => prospect(name)), control, replied];
    const db = new FakeDb({
      prospects: all,
      messages: all.map((p) => sentIntro(p.id)),
      reminders: all.map((p) => reminder(p.id)),
      inbound_messages: [{ id: "in-1", user_id: USER, prospect_id: replied.id, received_at: "2026-09-30T09:00:00Z", handled: true, deleted_at: null, from_email: "x@y.fr", body: "Merci", subject: "Re" }],
      signal_candidates: [], prospect_discards: [], jobs: [],
    });
    const items = flatten((await loadToday(db as unknown as Db, USER, new Date("2026-10-05T07:30:00Z"))).groups);
    const relances = items.filter((item) => item.kind === "relance").map((item) => item.companyName);
    check("aucune relance proposée pour HUMAN SIGHT, SELECTION HABITAT, BRIOL DIFFUSION, BONNIN", OPPOSED.every((name) => !relances.includes(name)), relances);
    check("réponse déjà traitée : pas de relance non plus", !relances.includes("REPONDU SARL"));
    check("témoin (non opposé, sans réponse) : sa relance J+4 reste proposée", relances.includes("TEMOIN SAS"), relances);
  }

  console.log("\n3. Serveur : programmation, envoi, tick n8n (même contrôle)");
  {
    const body = `Bonjour,\n\nCorps.\n\n${OPT_OUT_SENTENCE}\n\nAxel Remillat`;
    const human = prospect("HUMAN SIGHT");
    const db = new FakeDb({ prospects: [human, prospect("PERDU SA", { status: "perdu", key_figures: { pappers_read: true } })], messages: [sentIntro(human.id)], inbound_messages: [] });
    const relance = { id: "m-r1", user_id: USER, prospect_id: human.id, type: "relance_1", status: "draft", body, subject: "Re: Objet", deleted_at: null, send_status: "draft", thread_id: "t" };
    const refused = await checkSendRules(db as unknown as Db, relance as unknown as OutboxMessage, "contact@human-sight.fr", new Date("2026-10-05T08:00:00Z"));
    check("relance vers un opposé : refusée (409)", Boolean(refused && !refused.ok && refused.status === 409 && /opposé/.test(refused.error)), refused);
    const intro = await checkSendRules(db as unknown as Db, { ...relance, id: "m-i", type: "intro" } as unknown as OutboxMessage, "contact@human-sight.fr", new Date("2026-10-05T08:00:00Z"));
    check("toute prise de contact vers un opposé : refusée", Boolean(intro && !intro.ok && /opposé|déjà contacté/.test(intro.error)), intro);
    const lost = await checkSendRules(db as unknown as Db, { ...relance, id: "m-p", prospect_id: "perdu-sa" } as unknown as OutboxMessage, "a@perdu.fr", new Date("2026-10-05T08:00:00Z"));
    check("relance vers un prospect perdu : refusée", Boolean(lost && !lost.ok && /perdu/.test(lost.error)), lost);
    const reply = await checkSendRules(db as unknown as Db, { ...relance, id: "m-rep", type: "reponse" } as unknown as OutboxMessage, "contact@human-sight.fr", new Date("2026-10-05T08:00:00Z"));
    check("une RÉPONSE à un mail reçu reste possible (pas de refus « opposé »)", !reply || reply.ok || !/opposé/.test(reply.error), reply);
  }

  console.log("\n4. Préparation quotidienne : aucun brouillon de relance rédigé");
  {
    let written = 0;
    const db = new FakeDb({ prospects: [prospect("BRIOL DIFFUSION")], messages: [sentIntro("briol-diffusion")], inbound_messages: [] });
    const result = await draftFollowUp(db as unknown as Db, {
      userId: USER,
      prospect: prospect("BRIOL DIFFUSION") as unknown as Prospect,
      type: "relance_1",
      complete: (async () => ((written += 1), "texte")) as never,
    });
    check("BRIOL DIFFUSION : refus, aucun appel OpenAI, aucun brouillon", !result.ok && /opposé/.test(result.error) && written === 0 && db.rows("messages").length === 1, result);
  }

  console.log(failures === 0 ? "\nTous les tests des relances passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

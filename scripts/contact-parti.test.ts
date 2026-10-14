/**
 * CONTACT PARTI (Cowork #54) — fixtures ANONYMISÉES (noms et domaines inventés).
 * Détection FR + EN, distincte de l'absence ; contacts proposés du même domaine ;
 * choix suggéré ; relances vers l'adresse partie annulées ; fiche marquée.
 * Aucun envoi, aucun réseau. Exécution : `npm run test:contact-parti`.
 */
import { autoReplyKind } from "../lib/inbound/auto-reply";
import { isDeparted, proposedContacts } from "../lib/inbound/departed";
import { applyDeparted, departedEmails, setPrimaryContact } from "../lib/inbound/departed-server";
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

// Calqué sur le cas réel du 14/10, entièrement inventé.
const EN = {
  from_email: "p.martin@exemple-robinets.test",
  subject: "Réponse automatique : Demandes de références",
  body: "Thank you for your email.\n\nPlease note that I am no longer working at Exemple Robinets.\n\nFor any inquiries regarding products, orders, or logistics, please contact Claire Dubois at C.DUBOIS@exemple-robinets.test.\n\nFor commercial inquiries, please contact Hugo Bernard at h.bernard@exemple-robinets.test.\n\nThank you for your understanding.\n\nBest regards,",
};
const FR = {
  from_email: "l.petit@fictive-sa.test",
  subject: "Réponse automatique",
  body: "Bonjour,\nJe ne fais plus partie de la société Fictive SA depuis le 30 septembre.\nPour toute question commerciale, merci de contacter Marie Leroy : m.leroy@fictive-sa.test\nPour les commandes et la logistique, contactez Paul Garnier à l'adresse p.garnier@fictive-sa.test\nVous pouvez aussi écrire à contact@autre-domaine.test.\nCordialement",
};
const ABSENCE = { from_email: "a.b@fictive-sa.test", subject: "Absent du bureau", body: "Je suis absente jusqu'au 20 octobre. En cas d'urgence, vous pouvez contacter m.leroy@fictive-sa.test." };

async function main() {
  console.log("\n1. Détection : contact parti ≠ absence");
  check("EN « no longer working at » : contact parti", autoReplyKind(EN) === "parti", autoReplyKind(EN));
  check("FR « ne fais plus partie de la société » : contact parti", autoReplyKind(FR) === "parti", autoReplyKind(FR));
  for (const text of ["Je ne travaille plus chez Fictive SA.", "M. Durand a quitté la société.", "Cette adresse n'est plus active.", "He has left the company.", "This mailbox is no longer monitored.", "Je ne suis plus en poste depuis lundi."]) {
    check(`détecté : « ${text} »`, isDeparted({ body: text }), text);
  }
  check("une absence reste une absence", autoReplyKind(ABSENCE) === "absence", autoReplyKind(ABSENCE));
  check("une vraie réponse qui en parle tard n'est pas un départ", !isDeparted({ body: `${"Bonjour, merci pour votre message. ".repeat(20)} Notre ancien acheteur ne travaille plus chez nous.` }));
  check("« non merci » n'est pas un départ", !isDeparted({ body: "Bonjour, non merci." }));

  console.log("\n2. Contacts proposés (même domaine) et choix suggéré");
  const en = proposedContacts(EN.body, { domain: "exemple-robinets.test", departedEmail: EN.from_email });
  check("EN : deux contacts, adresses en minuscules", en.length === 2 && en[0].email === "c.dubois@exemple-robinets.test" && en[1].email === "h.bernard@exemple-robinets.test", en);
  check("EN : noms extraits", en[0].name === "Claire Dubois" && en[1].name === "Hugo Bernard", en.map((c) => c.name));
  check("EN : familles (opérations, commercial)", en[0].family === "operations" && en[1].family === "commercial", en.map((c) => [c.role, c.family]));
  check("EN : suggéré = opérations / logistique", en[0].suggested && !en[1].suggested);
  const fr = proposedContacts(FR.body, { domain: "fictive-sa.test", departedEmail: FR.from_email });
  check("FR : autre domaine écarté, l'expéditeur aussi", fr.length === 2 && fr.every((c) => c.email.endsWith("@fictive-sa.test")), fr.map((c) => c.email));
  check("FR : suggéré = commandes / logistique, pas le commercial cité d'abord", fr.find((c) => c.suggested)?.email === "p.garnier@fictive-sa.test", fr);
  check("FR : noms extraits", fr.map((c) => c.name).join(",") === "Marie Leroy,Paul Garnier", fr.map((c) => c.name));

  console.log("\n3. Effets : relances vers l'adresse partie annulées, fiche marquée, rien d'envoyé");
  const db = new FakeDb({
    prospects: [{ id: "p1", user_id: "u", company_name: "Exemple Robinets", email: EN.from_email, status: "relance_1", key_figures: { segment: null } }],
    messages: [
      { id: "r2", user_id: "u", prospect_id: "p1", type: "relance_2", status: "draft", send_status: "scheduled", scheduled_at: "2026-10-20T08:00:00Z", scheduled_to: EN.from_email },
      { id: "r2b", user_id: "u", prospect_id: "p1", type: "relance_2", status: "draft", send_status: "scheduled", scheduled_at: "2026-10-21T08:00:00Z", scheduled_to: "autre@exemple-robinets.test" },
      { id: "i1", user_id: "u", prospect_id: "p1", type: "intro", status: "sent", send_status: "sent", sent_to: EN.from_email },
    ],
    prospect_events: [],
  });
  const out = await applyDeparted(db as unknown as Db, { userId: "u", prospect: { id: "p1", email: EN.from_email, key_figures: {} }, inbound: { id: "in1", from_email: EN.from_email, body: EN.body, received_at: "2026-10-14T08:02:16Z" } });
  const msg = (id: string) => db.rows("messages").find((row) => row.id === id) as Record<string, unknown>;
  const fiche = () => db.rows("prospects")[0] as { email: string; key_figures: Record<string, unknown> };
  check("relance programmée vers l'adresse partie : annulée (brouillon, plus de date)", msg("r2").send_status === "draft" && msg("r2").scheduled_at === null && /contact parti/i.test(String(msg("r2").send_error)), msg("r2"));
  check("relance vers une autre adresse : intacte", msg("r2b").send_status === "scheduled");
  check("mail déjà parti : intact", msg("i1").send_status === "sent");
  check("compteur : 1 relance annulée", out.cancelled === 1, out);
  check("adresse marquée « partie », jamais réutilisable", departedEmails(fiche().key_figures).includes(EN.from_email));
  check("contacts proposés dans la fiche, rien d'automatique (adresse principale inchangée)", Array.isArray(fiche().key_figures.proposed_contacts) && fiche().email === EN.from_email);
  check("historique : événement « contact »", db.rows("prospect_events").length === 1);
  const again = await applyDeparted(db as unknown as Db, { userId: "u", prospect: { id: "p1", email: EN.from_email, key_figures: fiche().key_figures }, inbound: { id: "in1", from_email: EN.from_email, body: EN.body, received_at: "2026-10-14T08:02:16Z" } });
  check("rejouer : idempotent (pas de doublon)", again.cancelled === 0 && departedEmails(fiche().key_figures).length === 1 && (fiche().key_figures.proposed_contacts as unknown[]).length === 2);

  console.log("\n4. « Utiliser comme contact principal » : action d'Axel, contrôlée");
  const refused = await setPrimaryContact(db as unknown as Db, { userId: "u", prospectId: "p1", email: "inconnu@exemple-robinets.test" });
  check("adresse non proposée : refusée", !refused.ok);
  const back = await setPrimaryContact(db as unknown as Db, { userId: "u", prospectId: "p1", email: EN.from_email });
  check("adresse partie : refusée", !back.ok);
  const used = await setPrimaryContact(db as unknown as Db, { userId: "u", prospectId: "p1", email: "c.dubois@exemple-robinets.test" });
  check("contact proposé → principal (nom, rôle), aucune relance reprogrammée", used.ok && fiche().email === "c.dubois@exemple-robinets.test" && msg("r2").send_status === "draft", fiche());

  console.log(failures === 0 ? "\nTous les tests « contact parti » passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

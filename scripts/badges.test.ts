/**
 * BADGES DE LA BARRE et « lu / non lu » des mails reçus (Cowork #21).
 *
 * Axel voyait « Opportunités 2 » alors qu'il avait tout vu et répondu, et un
 * compteur de corbeille qui ne correspondait à rien. Chaque règle est verrouillée
 * ici, sur une fausse base en mémoire : aucun réseau, aucun envoi, aucune écriture.
 * `npm run test:badges`
 */
import { badgeCounts } from "../lib/badges/counts";
import { countsAsUnread, isUnread, unreadBadgeCount, validatedAntispamIds } from "../lib/inbound/read-state";
import { setInboundRead } from "../lib/inbound/read-server";
import { mailboxCounts } from "../lib/outbox/mailbox";
import type { Db } from "../lib/trash/scope";
import type { InboundMessage, Message, Prospect } from "../types";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-12T09:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** Un mail reçu, réduit à ce que les règles lisent. */
const mail = (over: Partial<InboundMessage> = {}) =>
  ({
    id: "in-1",
    user_id: "u1",
    prospect_id: "p1",
    from_email: "dirigeant@acme-outillage.fr",
    subject: "Re: Votre proposition",
    body: "Bonjour, oui ça m'intéresse, rappelez-moi jeudi.",
    category: "reponse",
    thread_id: null,
    received_at: daysAgo(1),
    handled: false,
    created_at: daysAgo(1),
    read_at: null,
    deleted_at: null,
    ...over,
  }) as InboundMessage;

const ABSENCE = mail({ id: "in-absence", subject: "Réponse automatique : Votre proposition", body: "Je suis absent jusqu'au 20/10." });
const ANTISPAM = mail({
  id: "in-antispam",
  from_email: "acme@invitations.mailinblack.com",
  subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL",
  body: "Votre message est en attente de validation. https://app.mailinblack.com/mibc-fr-06/invitation?token=zz",
});

const prospect = (over: Partial<Prospect> = {}) => ({ id: "p1", company_name: "ACME OUTILLAGE", email: "dirigeant@acme-outillage.fr", key_figures: {}, ...over }) as Prospect;

async function main() {
  console.log("\n1. « Lu » n'est pas « soldé »");
  {
    check("sans read_at : non lu", isUnread(mail()));
    check("read_at posé : lu", !isUnread(mail({ read_at: daysAgo(0) })));
    // Le piège qu'on évite : `handled` sort le mail de la file du jour.
    check("un mail SOLDÉ mais jamais ouvert reste « non lu » à l'écran", isUnread(mail({ handled: true })));
    check("un mail lu et non soldé compte toujours pour le badge", countsAsUnread(mail({ handled: false })) && !countsAsUnread(mail({ read_at: daysAgo(0) })));
    check("à la corbeille : ne compte pas", !countsAsUnread(mail({ deleted_at: daysAgo(0) })));
  }

  console.log("\n2. Le badge « boîte mail » ne compte que ce qui demande une action");
  {
    check("une vraie réponse non lue compte", countsAsUnread(mail()));
    check("une absence ne compte jamais", !countsAsUnread(ABSENCE));
    check("un anti-spam non validé compte (il faut cliquer)", countsAsUnread(ANTISPAM));

    const validated = [prospect({ key_figures: { antispam_inbound_id: "in-antispam", antispam_validated_at: daysAgo(0) } as never })];
    check("l'identifiant validé est lu sur la FICHE", validatedAntispamIds(validated).has("in-antispam"));
    check("un anti-spam déjà validé ne compte plus", !countsAsUnread(ANTISPAM, validatedAntispamIds(validated)));
    check("validation sans date : rien n'est validé", validatedAntispamIds([prospect({ key_figures: { antispam_inbound_id: "in-antispam" } as never })]).size === 0);

    const inbox = [mail(), ABSENCE, ANTISPAM, mail({ id: "in-lu", read_at: daysAgo(0) })];
    check("4 reçus, 2 comptent (réponse + anti-spam)", unreadBadgeCount(inbox, []) === 2, unreadBadgeCount(inbox, []));
    check("anti-spam validé : il n'en reste qu'un", unreadBadgeCount(inbox, validated) === 1, unreadBadgeCount(inbox, validated));
    check(
      "le compteur des onglets suit la même règle",
      mailboxCounts(inbox, [] as Message[], validated).nonLus === 1,
      mailboxCounts(inbox, [] as Message[], validated).nonLus,
    );
    check("le total « Reçus » reste le nombre de mails vivants", mailboxCounts(inbox, [] as Message[], validated).recus === 4);
  }

  console.log("\n3. Écriture du « lu / non lu » : affichage seul");
  {
    const db = new FakeDb({ inbound_messages: [{ ...mail(), user_id: "u1" } as unknown as Record<string, unknown>] });
    const marked = await setInboundRead(db as unknown as Db, { userId: "u1", inboundId: "in-1", read: true, now: NOW });
    const row = db.rows("inbound_messages")[0];
    check("marquer lu pose read_at", marked.ok && row.read_at === NOW.toISOString(), row.read_at);
    check("et ne touche NI handled, NI le statut, NI la corbeille", row.handled === false && row.deleted_at === null);

    const back = await setInboundRead(db as unknown as Db, { userId: "u1", inboundId: "in-1", read: false, now: NOW });
    check("marquer non lu efface read_at", back.ok && db.rows("inbound_messages")[0].read_at === null);

    const other = await setInboundRead(db as unknown as Db, { userId: "u2", inboundId: "in-1", read: true, now: NOW });
    check("le mail d'un autre compte est refusé", !other.ok);

    const trashed = new FakeDb({ inbound_messages: [{ ...mail({ deleted_at: daysAgo(1) }), user_id: "u1" } as unknown as Record<string, unknown>] });
    check("un mail à la corbeille est refusé", !(await setInboundRead(trashed as unknown as Db, { userId: "u1", inboundId: "in-1", read: true })).ok);
  }

  console.log("\n4. Badge « Opportunités » : non vue ET non traitée ET fraîche");
  {
    const opportunity = (over: Record<string, unknown>) => ({
      id: "o1",
      platform: "codeur",
      title: "Création d'un site vitrine",
      body: "Nous cherchons un développeur pour un site vitrine.",
      categories: [],
      budget: null,
      fit_score: 9,
      status: "a_repondre",
      seen_at: null,
      filter_reason: null,
      published_at: daysAgo(1),
      created_at: daysAgo(1),
      ...over,
    });
    const count = async (rows: Record<string, unknown>[]) =>
      (await badgeCounts(new FakeDb({ opportunities: rows, inbound_messages: [], prospects: [], messages: [] }) as unknown as Db, NOW)).alerts;

    check("alerte non vue, à répondre, fraîche → 1", (await count([opportunity({})])) === 1);
    check("marquée « Vu » → 0", (await count([opportunity({ seen_at: daysAgo(0) })])) === 0);
    check("proposition ENVOYÉE → 0 (le cas d'Axel : tout vu et répondu)", (await count([opportunity({ status: "envoyee" })])) === 0);
    check("ignorée → 0", (await count([opportunity({ status: "ignoree" })])) === 0);
    check("fermée → 0", (await count([opportunity({ status: "fermee" })])) === 0);
    check("conversation en cours → 0", (await count([opportunity({ status: "entretien" })])) === 0);
    check("publiée il y a 10 jours → 0", (await count([opportunity({ published_at: daysAgo(10), created_at: daysAgo(10) })])) === 0);
    check("pré-filtrée (motif renseigné) → 0", (await count([opportunity({ filter_reason: "hors cible" })])) === 0);
    check(
      "mission de lancement Codeur à petit score → 1 quand même",
      (await count([opportunity({ id: "o2", fit_score: 3, title: "Création site vitrine 5 pages", budget: "Moins de 500 €" })])) === 1,
    );
    check("score faible hors lancement → 0", (await count([opportunity({ platform: "upwork", fit_score: 4 })])) === 0);
    check("deux annonces, deux alertes", (await count([opportunity({}), opportunity({ id: "o3" })])) === 2);
  }

  console.log("\n5. Badge « corbeille » : le vrai nombre d'éléments");
  {
    const db = new FakeDb({
      opportunities: [],
      prospects: [
        { id: "p1", deleted_at: daysAgo(2) },
        { id: "p2", deleted_at: null },
        // Déjà expiré (> 14 jours) : /corbeille le purge à l'ouverture, le badge ne doit pas le compter.
        { id: "p3", deleted_at: daysAgo(20) },
      ],
      messages: [{ id: "m1", deleted_at: daysAgo(1) }],
      inbound_messages: [{ id: "in1", deleted_at: daysAgo(3), read_at: null }],
    });
    const badges = await badgeCounts(db as unknown as Db, NOW);
    check("1 prospect + 1 mail envoyé + 1 mail reçu = 3", badges.trash === 3, badges.trash);
    check("l'élément expiré n'est pas compté", badges.trash === 3);
    check("un mail reçu à la corbeille n'est pas « non lu »", badges.unread === 0, badges.unread);
  }

  console.log("\n6. Les trois badges d'un coup, sur une base vide");
  {
    const empty = await badgeCounts(new FakeDb({ opportunities: [], prospects: [], messages: [], inbound_messages: [] }) as unknown as Db, NOW);
    check("aucun badge affiché", empty.alerts === 0 && empty.unread === 0 && empty.trash === 0, empty);

    // Table absente (base pas encore migrée) : 0, jamais une page en erreur.
    const missing = await badgeCounts(new FakeDb({}) as unknown as Db, NOW);
    check("table absente : 0 et aucune exception", missing.alerts === 0 && missing.unread === 0 && missing.trash === 0, missing);
  }

  console.log(failures === 0 ? "\nTous les tests des badges passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

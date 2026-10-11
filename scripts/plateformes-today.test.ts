/**
 * Conversations de plateforme dans « Aujourd'hui » (Cowork #17).
 *
 * Sur fixtures, parce qu'il n'y a RIEN à mesurer en vrai : au 11/10, aucun
 * e-mail Codeur de type « message » n'a jamais été ingéré (77 alertes de
 * nouveau projet, un e-mail marketing). Le mécanisme doit donc être juste
 * avant qu'un premier message n'arrive, pas après.
 */
import { followUpsToSend, messagesToAnswer, platformCounts } from "../lib/today/platform";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Envoyee le 11/10 a 16:20 : au 15/10 a 09:00 il s est ecoule 3 jours pleins
// (2,7 arrondis a 2 au 14/10 — le delai se compte en jours ENTIERS).
const NOW = new Date("2026-10-15T09:00:00Z");

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "o1",
    platform: "codeur",
    status: "envoyee",
    title: "Site d'affiliation",
    url: "https://www.codeur.com/projects/491048-site-d-affiliation",
    sent_at: "2026-10-11T16:20:00.000Z",
    replied_at: null,
    proposal: "Bonjour, ma proposition…",
    language: "fr",
    followed_up_at: null,
    conversation_at: null,
    follow_up_text: null,
    ...over,
  }) as never;

console.log("\n1. Message reçu : avec et sans extrait");
{
  const answered = messagesToAnswer([row({ status: "reponse", replied_at: "2026-10-13T08:00:00.000Z" })], [
    { opportunityId: "o1", receivedAt: "2026-10-13T08:00:00.000Z", excerpt: "Bonjour, quel est le délai ?" },
  ]);
  check("un message reçu devient une tâche", answered.length === 1);
  check("badge plateforme et titre du projet", answered[0]?.platformLabel === "Codeur" && answered[0]?.title === "Site d'affiliation", String(answered[0]?.platformLabel));
  check("l'extrait de l'e-mail est reporté", answered[0]?.excerpt === "Bonjour, quel est le délai ?", String(answered[0]?.excerpt));
  check("la proposition envoyée ouvre la conversation", answered[0]?.sent?.at === "2026-10-11T16:20:00.000Z");
  check("le lien de l'annonce est là", (answered[0]?.url ?? "").includes("codeur.com/projects/491048"));

  // Codeur ne met pas le texte du message dans ses e-mails : la vue doit le dire.
  const sans = messagesToAnswer([row({ status: "reponse" })], []);
  check("sans extrait : aucun contenu inventé", sans[0]?.excerpt === null, String(sans[0]?.excerpt));
  check("un message reçu n'a jamais de texte à copier", sans[0]?.text === null);
}

console.log("\n2. Rattachement et ordre");
{
  const tasks = messagesToAnswer(
    [row({ id: "a", status: "reponse" }), row({ id: "b", status: "reponse", title: "Autre projet" })],
    [
      { opportunityId: "a", receivedAt: "2026-10-12T08:00:00.000Z", excerpt: "ancien" },
      { opportunityId: "b", receivedAt: "2026-10-13T08:00:00.000Z", excerpt: "récent" },
      // Deux e-mails pour la même fiche : le plus récent gagne.
      { opportunityId: "a", receivedAt: "2026-10-12T18:00:00.000Z", excerpt: "le plus récent de a" },
    ],
  );
  check("le message le plus récent passe en tête", tasks[0]?.opportunityId === "b", String(tasks[0]?.opportunityId));
  check("l'extrait retenu est le dernier reçu pour la fiche", tasks[1]?.excerpt === "le plus récent de a", String(tasks[1]?.excerpt));
  check("une fiche sans réponse n'entre pas", messagesToAnswer([row({ status: "envoyee" })], []).length === 0);
}

console.log("\n3. Relances dues");
{
  // Envoyée le 11/10, Codeur = 3 jours : due le 14/10.
  const due = followUpsToSend([row()], NOW);
  check("une proposition Codeur de 3 jours est due", due.length === 1 && due[0].kind === "relance");
  check("le texte de repli est prêt à copier", (due[0]?.text ?? "").includes("Site d'affiliation"), String(due[0]?.text).slice(0, 60));
  check("aucune URL dans le texte de relance", !/https?:\/\//.test(due[0]?.text ?? ""), String(due[0]?.text));
  check("signé du nom seul", (due[0]?.text ?? "").trim().endsWith("Axel Remillat"));
  check("le nombre de jours est affiché", due[0]?.days === 3, String(due[0]?.days));

  check("déjà relancée : plus due", followUpsToSend([row({ followed_up_at: "2026-10-13T08:00:00.000Z" })], NOW).length === 0);
  check("déjà répondue : plus due", followUpsToSend([row({ replied_at: "2026-10-13T08:00:00.000Z" })], NOW).length === 0);
  check("Upwork attend 5 jours, pas 3", followUpsToSend([row({ platform: "upwork" })], NOW).length === 0);
  check(
    "Upwork devient due au 5e jour",
    followUpsToSend([row({ platform: "upwork" })], new Date("2026-10-17T09:00:00Z")).length === 1,
  );
  check(
    "le texte déjà rédigé est préféré au repli",
    followUpsToSend([row({ follow_up_text: "Mon texte à moi." })], NOW)[0]?.text === "Mon texte à moi.",
  );
  check(
    "la plus ancienne en tête",
    followUpsToSend([row({ id: "recent" }), row({ id: "vieux", sent_at: "2026-10-05T08:00:00.000Z" })], NOW)[0]?.opportunityId === "vieux",
  );
}

console.log("\n4. Compteur de l'en-tête");
{
  const tasks = [...messagesToAnswer([row({ status: "reponse" })], []), ...followUpsToSend([row({ id: "o2" })], NOW)];
  const counts = platformCounts(tasks);
  check("un message et une relance comptés séparément", counts.messages === 1 && counts.relances === 1, JSON.stringify(counts));
}

console.log("\n5. Aucun effet sur le plafond d'envoi");
{
  /*
   * Rien ne part d'ORION pour ces tâches : elles n'ont ni messageId, ni
   * destinataire, ni créneau. Le plafond se calcule sur la table `messages`
   * (lib/today/capacity.ts), que ce module ne touche pas — il ne lit que
   * `opportunities`. Le test fixe l'invariant qui compte : une tâche de
   * plateforme n'expose aucun identifiant de message.
   */
  const tasks = [...messagesToAnswer([row({ status: "reponse" })], []), ...followUpsToSend([row({ id: "o2" })], NOW)];
  check(
    "aucune tâche ne porte d'identifiant de message ORION",
    tasks.every((task) => !("messageId" in task) && !("scheduledAt" in task)),
  );
  check("chaque tâche pointe une opportunité, pas un prospect", tasks.every((task) => Boolean(task.opportunityId)));
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

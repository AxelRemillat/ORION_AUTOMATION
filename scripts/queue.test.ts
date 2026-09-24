/**
 * Tests de la file d'actions du Cockpit.
 *
 * Ce qui est verrouille ici : l'ORDRE (une reponse passe avant une relance en
 * retard, qui passe avant une relance du jour...), le fait qu'une action
 * traitee ou reportee sorte vraiment, et surtout qu'un report REVIENNE le
 * lendemain. Une file qui ment est pire qu'une absence de file.
 *
 * Execution : `npm run test:queue`.
 */
import { buildQueue, tomorrowMorning } from "../app/(app)/cockpit/_lib/queue";
import type { ActionStateRow } from "../app/(app)/cockpit/_lib/queue";
import type { Message, Prospect, Reminder } from "../types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-09-24T10:00:00Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const prospect = (id: string, name: string, over: Partial<Prospect> = {}): Prospect => ({
  id,
  user_id: "u",
  company_name: name,
  siren: null,
  website: null,
  email: null,
  sector: null,
  size_range: null,
  city: null,
  source: "auto",
  signals: [],
  key_figures: {},
  pain_point: null,
  status: "nouveau",
  created_at: iso(-30),
  updated_at: iso(-30),
  ...over,
});

const reminder = (id: string, prospectId: string, dueDays: number): Reminder => ({
  id,
  prospect_id: prospectId,
  user_id: "u",
  due_at: iso(dueDays),
  done: false,
  created_at: iso(-10),
});

const draft = (id: string, prospectId: string): Message => ({
  id,
  prospect_id: prospectId,
  user_id: "u",
  type: "intro",
  subject: "Objet",
  body: "Corps",
  status: "draft",
  sent_at: null,
  thread_id: null,
  created_at: iso(-2),
});

const P = {
  alpha: prospect("p1", "Alpha"),
  beta: prospect("p2", "Beta"),
  gamma: prospect("p3", "Gamma"),
  delta: prospect("p4", "Delta"),
};
const ALL = Object.values(P);

console.log("\n1. L'ordre de la file suit l'urgence, pas l'ordre des tables");
{
  const result = buildQueue({
    prospects: ALL,
    messages: [draft("m1", P.gamma.id)],
    reminders: [reminder("r1", P.beta.id, -6), reminder("r2", P.alpha.id, 0)],
    inbound: [{ id: "i1", prospect_id: P.delta.id }],
    now: NOW,
    size: 10,
  });
  const kinds = result.visible.map((action) => action.kind);

  check("la reponse passe en premier", kinds[0] === "reponse", kinds.join(" > "));
  check("puis la relance en retard", kinds[1] === "relance_retard", kinds.join(" > "));
  check("puis la relance du jour", kinds[2] === "relance_jour", kinds.join(" > "));
  check("puis le brouillon", kinds[3] === "brouillon", kinds.join(" > "));
  check("l'approche ferme la marche", kinds[kinds.length - 1] === "approche", kinds.join(" > "));
}

console.log("\n2. Trois a la fois, et le compteur dit la verite");
{
  const result = buildQueue({
    prospects: ALL,
    messages: [draft("m1", P.gamma.id)],
    reminders: [reminder("r1", P.beta.id, -6), reminder("r2", P.alpha.id, 0)],
    inbound: [{ id: "i1", prospect_id: P.delta.id }],
    now: NOW,
  });
  check("trois actions affichees", result.visible.length === 3, String(result.visible.length));
  check("le total compte tout ce qui attend", result.total > 3, String(result.total));
}

console.log("\n3. Parmi les relances en retard, la plus vieille d'abord");
{
  const result = buildQueue({
    prospects: ALL,
    messages: [],
    reminders: [reminder("recent", P.alpha.id, -1), reminder("vieux", P.beta.id, -9)],
    now: NOW,
    size: 10,
  });
  check("la plus en retard passe devant", result.visible[0]?.id === "relance-vieux");
  check(
    "et elle flambe plus fort",
    (result.visible[0]?.heat ?? 0) > (result.visible[1]?.heat ?? 1),
    `${result.visible[0]?.heat} vs ${result.visible[1]?.heat}`,
  );
}

console.log("\n4. « Fait » sort definitivement, « Reporte » revient demain");
{
  const base = {
    prospects: ALL,
    messages: [],
    reminders: [reminder("r1", P.alpha.id, -3), reminder("r2", P.beta.id, -2)],
    now: NOW,
    size: 10,
  };

  const done: ActionStateRow[] = [{ action_id: "relance-r1", state: "done", snooze_until: null }];
  const afterDone = buildQueue({ ...base, states: done });
  check(
    "l'action traitee a disparu",
    !afterDone.visible.some((action) => action.id === "relance-r1"),
  );

  const snoozed: ActionStateRow[] = [
    { action_id: "relance-r1", state: "snoozed", snooze_until: tomorrowMorning(NOW).toISOString() },
  ];
  const afterSnooze = buildQueue({ ...base, states: snoozed });
  check(
    "l'action reportee est masquee aujourd'hui",
    !afterSnooze.visible.some((action) => action.id === "relance-r1"),
  );

  // Le lendemain : l'echeance du report est passee.
  const tomorrow = buildQueue({ ...base, states: snoozed, now: NOW + DAY });
  check(
    "elle revient le lendemain",
    tomorrow.visible.some((action) => action.id === "relance-r1"),
  );
}

console.log("\n5. Une action se referme toute seule quand l'evenement a lieu");
{
  // Relance soldee en base : plus rien a faire, sans passer par « Fait ».
  const solded: Reminder = { ...reminder("r1", P.alpha.id, -3), done: true };
  const afterReminder = buildQueue({
    prospects: ALL,
    messages: [],
    reminders: [solded],
    now: NOW,
    size: 10,
  });
  check(
    "relance soldee -> hors file",
    !afterReminder.visible.some((action) => action.id === "relance-r1"),
  );

  // Brouillon envoye : le message n'est plus un brouillon.
  const sent: Message = { ...draft("m1", P.gamma.id), status: "sent", sent_at: iso(0) };
  const afterSend = buildQueue({
    prospects: ALL,
    messages: [sent],
    reminders: [],
    now: NOW,
    size: 10,
  });
  check(
    "brouillon envoye -> hors file",
    !afterSend.visible.some((action) => action.kind === "brouillon"),
  );
}

console.log("\n6. Rien a faire : file vide et total a zero");
{
  const result = buildQueue({ prospects: [], messages: [], reminders: [], now: NOW });
  check("aucune action", result.visible.length === 0);
  check("total nul", result.total === 0);
}

console.log(
  failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`,
);
process.exit(failures === 0 ? 0 : 1);

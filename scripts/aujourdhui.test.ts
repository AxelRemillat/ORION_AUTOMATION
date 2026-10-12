/**
 * « Aujourd'hui » — les règles qui décident de ce qu'Axel voit et de ce qui part.
 *
 * Tout est testé sur fixtures, sans réseau ni crédit :
 *   - l'ordre des groupes (réponses, relances, nouveaux, à compléter) ;
 *   - les exclusions (opposé, « ne plus contacter », hors cible, écarté) ;
 *   - les étiquettes et la complétion automatique (3 tentatives au plus) ;
 *   - le passage automatique au suivant ;
 *   - le plan d'envoi : rien sans validation, plafond respecté, surplus reporté ;
 *   - le corps : mention « stop » et signature verrouillées, jamais dupliquées ;
 *   - la migration : additive, aucune perte de données possible.
 *
 * Exécution : `npm run test:aujourdhui`.
 */
import { applyYield, nextBusinessDay, planYield, relancesWaitingOf } from "../lib/today/yield";
import { FakeDb } from "./fake-supabase";
import { readFileSync } from "node:fs";
import { flatten, groupToday, nextTodo, type RawTodayItem } from "../lib/today/group";
import { completionLabel, isComplete, shouldRetryCompletion, tagsOf } from "../lib/today/tags";
import { businessDays, planDays, planSchedule, sendDay } from "../lib/today/plan";
import { loadCapacity } from "../lib/today/capacity";
import { joinBody, splitBody } from "../lib/today/body";
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";
import type { TodayItem } from "../lib/today/types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const item = (over: Partial<RawTodayItem>): RawTodayItem => ({
  key: over.key ?? "x",
  kind: "nouveau",
  status: "todo",
  prospectId: over.key ?? "p",
  candidateId: null,
  messageId: "m",
  inboundId: null,
  companyName: "ACME",
  subline: "",
  score: 3,
  contact: { email: "a@b.fr", kind: "nominatif", name: null, phone: null },
  messageType: "intro",
  received: null,
  signal: null,
  facts: [],
  subject: "Objet",
  body: "Bonjour,\n\nTexte.",
  optOut: true,
  signature: "Axel Remillat",
  why: [],
  tags: [],
  website: "https://acme.fr",
  attempts: 0,
  scheduledAt: null,
  draftPending: false,
  exclusion: null,
  ...over,
});

console.log("\n1. Les quatre groupes, dans cet ordre");
{
  const groups = groupToday([
    item({ key: "n1", score: 2 }),
    item({ key: "c1", tags: ["Email manquant"], contact: { email: null, kind: "aucun", name: null, phone: "04 78 00 00 00" } }),
    item({ key: "r1", kind: "relance", messageType: "relance", dueAt: "2026-10-02" }),
    item({ key: "a1", kind: "reponse", messageType: "reponse", receivedAt: "2026-10-01T08:00:00Z" }),
    item({ key: "n2", score: 5 }),
  ]);
  check("ordre des groupes", groups.map((group) => group.kind).join(",") === "reponse,relance,nouveau,a_completer", groups.map((group) => group.kind).join(","));
  check("libellé du premier groupe", groups[0].label === "Réponses à traiter");
  const news = groups.find((group) => group.kind === "nouveau")!.items.map((entry) => entry.key);
  check("nouveaux triés par score décroissant", news.join(",") === "n2,n1", news.join(","));
  check("une fiche incomplète part dans « À compléter »", groups[3].items[0].key === "c1");
  check("ordre de ↓ / ↑ = ordre d'affichage", flatten(groups).map((entry) => entry.key).join(",") === "a1,r1,n2,n1,c1");
}

console.log("\n2. Exclus : ils n'apparaissent dans aucun groupe");
{
  const groups = groupToday([
    item({ key: "ok" }),
    item({ key: "oppose", exclusion: "opposé à la prospection" }),
    item({ key: "dnc", exclusion: "ne plus contacter" }),
    item({ key: "hors", exclusion: "hors cible" }),
    item({ key: "ecarte", exclusion: "écarté : pas de vrai besoin" }),
  ]);
  const keys = flatten(groups).map((entry) => entry.key);
  check("seule la fiche valide reste", keys.join(",") === "ok", keys.join(","));
}

console.log("\n3. Une fiche n'apparaît qu'une fois : la réponse prime");
{
  const groups = groupToday([
    item({ key: "rep", kind: "reponse", messageType: "reponse", prospectId: "P" }),
    item({ key: "rel", kind: "relance", messageType: "relance", prospectId: "P" }),
    item({ key: "intro", prospectId: "P" }),
  ]);
  const keys = flatten(groups).map((entry) => entry.key);
  check("relance et intro du même prospect masquées", keys.join(",") === "rep", keys.join(","));
}

console.log("\n4. Étiquettes et complétude");
{
  const base = { email: "a@b.fr", emailDoubtful: false, oppositionUnverified: false, website: "x", hasBusinessProfile: true, hasDraft: true, draftPending: false };
  check("fiche complète : aucune étiquette", tagsOf(base).length === 0);
  check("email manquant", tagsOf({ ...base, email: null }).includes("Email manquant"));
  check("email douteux", tagsOf({ ...base, emailDoubtful: true }).includes("Email non vérifié"));
  check("opposition non vérifiée", tagsOf({ ...base, oppositionUnverified: true }).includes("Opposition non vérifiée"));
  check("site introuvable", tagsOf({ ...base, website: null }).includes("Site introuvable"));
  // Lot 2a (02/10/2026) : site connu + profil vide = « Profil à compléter », bloquant.
  check("site connu, profil vide : « Profil à compléter »", tagsOf({ ...base, hasBusinessProfile: false }).includes("Profil à compléter"));
  check("… bloquant : pas dans « Nouveaux »", !isComplete(tagsOf({ ...base, hasBusinessProfile: false }), true));
  check("sans site, profil vide : simple information", tagsOf({ ...base, website: null, hasBusinessProfile: false }).includes("Profil métier vide"));
  check("brouillon manquant", tagsOf({ ...base, hasDraft: false }).includes("Brouillon manquant"));
  check("brouillon en préparation : pas « manquant »", !tagsOf({ ...base, hasDraft: false, draftPending: true }).includes("Brouillon manquant"));
  // Site et profil sont des signaux de qualité, pas des blocages.
  check("site + profil manquants n'empêchent pas « Nouveaux »", isComplete(tagsOf({ ...base, website: null, hasBusinessProfile: false }), true));
  check("email manquant bloque", !isComplete(tagsOf({ ...base, email: null }), true));
  check("opposition non vérifiée bloque", !isComplete(tagsOf({ ...base, oppositionUnverified: true }), true));
  check("sans brouillon : jamais « Nouveaux »", !isComplete([], false));
}

console.log("\n5. Complétion automatique : une par run, trois au plus");
{
  check("première tentative", shouldRetryCompletion({ attempts: 0, runId: "r1" }));
  check("pas deux fois dans le même run", !shouldRetryCompletion({ attempts: 1, lastAttemptRun: "r1", runId: "r1" }));
  check("au run suivant, on retente", shouldRetryCompletion({ attempts: 1, lastAttemptRun: "r1", runId: "r2" }));
  check("au-delà de 3, on s'arrête", !shouldRetryCompletion({ attempts: 3, lastAttemptRun: "r2", runId: "r3" }));
  check("libellé final", completionLabel(3) === "À compléter manuellement");
  check("libellé intermédiaire", completionLabel(2).includes("2 / 3"));
}

console.log("\n6. Passage automatique au suivant");
{
  const list = [{ status: "valide" }, { status: "todo" }, { status: "ecarte" }, { status: "todo" }] as Pick<TodayItem, "status">[];
  check("après 0 → 1", nextTodo(list, 0) === 1);
  check("après 1 → 3 (saute l'écarté)", nextTodo(list, 1) === 3);
  check("après 3 → revient à 1", nextTodo(list, 3) === 1);
  check("plus rien à faire : la sélection ne bouge pas", nextTodo([{ status: "valide" }, { status: "ecarte" }] as Pick<TodayItem, "status">[], 1) === 1);
}

console.log("\n7. Plan d'envoi");
{
  const monday = new Date("2026-10-05T06:00:00Z"); // lundi 8 h à Paris
  const steady = () => 0; // écart minimal : 2 min
  const items = [
    item({ key: "n1", status: "valide" }),
    item({ key: "todo", status: "todo" }),
    item({ key: "rel", kind: "relance", status: "valide" }),
    item({ key: "rep", kind: "reponse", status: "valide" }),
    item({ key: "n2", status: "valide" }),
  ];
  const plan = planSchedule({ items, remaining: 10, now: monday, random: steady });
  const order = plan.planned.map((entry) => entry.key).join(",");
  check("jamais un brouillon non validé", !plan.planned.some((entry) => entry.key === "todo"));
  check("réponses, puis relances, puis intros", order === "rep,rel,n1,n2", order);
  check("premier envoi à 9 h (Paris)", plan.planned[0].at.toISOString() === "2026-10-05T07:00:00.000Z", plan.planned[0].at.toISOString());
  check("2 à 7 minutes d'écart", plan.planned.every((entry, index) => index === 0 || entry.at.getTime() - plan.planned[index - 1].at.getTime() >= 120_000));

  const capped = planSchedule({ items, remaining: 2, now: monday, random: steady });
  check("plafond respecté", capped.planned.length === 2, String(capped.planned.length));
  check("surplus reporté, motif « plafond »", capped.postponed.length === 2 && capped.postponed.every((entry) => entry.reason === "plafond"));
  check("le surplus, ce sont les intros", capped.postponed.map((entry) => entry.key).join(",") === "n1,n2");

  const late = planSchedule({ items, remaining: 10, now: new Date("2026-10-05T14:59:00Z"), random: () => 0.99 }); // 16 h 59
  check("passé 17 h, reporté au lendemain", late.planned.length >= 0 && late.postponed.every((entry) => entry.reason === "fenetre"));
  check("un samedi, le plan vise lundi", sendDay(new Date("2026-10-03T08:00:00Z")) === "2026-10-05");
  check("un mail sans brouillon n'est pas planifié", planSchedule({ items: [item({ key: "x", status: "valide", messageId: null })], remaining: 5, now: monday }).planned.length === 0);
}

console.log("\n8. Corps : mention « stop » et signature verrouillées");
{
  const signature = "Axel Remillat\nAutomatisation & IA pour PME · axelremillat.com/pme";
  const stored = `Bonjour,\n\nTexte du mail.\n\n${OPT_OUT_SENTENCE}\n\n${signature}`;
  const split = splitBody(stored, signature);
  check("le texte éditable n'a ni mention ni signature", split.core === "Bonjour,\n\nTexte du mail.", JSON.stringify(split.core));
  check("la mention est reconnue", split.optOut);
  check("la signature est reconnue", split.signature === signature);
  check("aller-retour sans perte", joinBody(split.core, split) === stored);
  const edited = joinBody("Bonjour,\n\nTexte retouché.", split);
  check("une retouche garde UNE mention", edited.split(OPT_OUT_SENTENCE).length === 2);
  check("une retouche garde UNE signature", edited.split("Axel Remillat").length === 2);
  check("réponse sans mention : rien n'est ajouté", !splitBody("Bonjour,\n\nOui.", signature).optOut);
}

console.log("\n9. Migration : aucune perte de données possible");
{
  const sql = readFileSync("supabase/migrations/20261002142022_today_queue.sql", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  check("aucun drop de table ou de colonne", !/drop\s+(table|column)/.test(sql));
  check("aucune suppression de lignes", !/\bdelete\s+from\b|\btruncate\b/.test(sql));
  check("aucune réécriture de lignes", !/\bupdate\s+public\./.test(sql));
  check("aucun type de colonne modifié", !/alter\s+column/.test(sql));
  check("les colonnes ajoutées ont un défaut ou acceptent NULL", !/add column if not exists \w+ \w+ not null(?! default)/.test(sql));
  check("RLS et GRANT dans la même migration", sql.includes("enable row level security") && sql.includes("grant select, insert, update, delete on public.prospect_discards"));
}

/** Verification asynchrone : le rapport final l'attend (fin du fichier). */
let capacityChecks: Promise<void> = Promise.resolve();

/*
 * CRENEAUX DEJA RESERVES (Cowork #7, 09/10/2026).
 *
 * Axel voyait « envois 16/25 » et ne pouvait programmer aucune des 14 relances
 * validees. Le plafond etait pourtant engage a 25/25 : 16 envois partis plus 9
 * intros PROGRAMMEES sur le meme jour. `remaining` valait bien 0 — c'est
 * l'affichage qui ne montrait que les envois partis. Ces tests fixent
 * l'arithmetique et exposent `plannedToday`, pour qu'on puisse le dire a
 * l'ecran. Aucune valeur de plafond n'est touchee.
 */
{
  const now = new Date("2026-10-09T14:23:00Z"); // vendredi, 16 h 23 a Paris
  const sentRow = (day: string) => ({ status: "sent", sent_at: `${day}T08:00:00Z`, type: "intro", gmail_message_id: "g1" });
  // Premier envoi reel il y a 10 jours ouvres : plafond 25.
  const sent = [
    sentRow("2026-09-26"),
    ...Array.from({ length: 16 }, () => sentRow("2026-10-09")),
  ];
  const planned = Array.from({ length: 9 }, () => ({ scheduled_at: "2026-10-09T13:00:00Z" }));

  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain as never;
      for (const key of ["select", "eq", "in", "is"]) chain[key] = self;
      // `messages` est lue deux fois : les envois, puis les programmations.
      chain.select = (columns: string) => {
        chain.__planned = columns.includes("scheduled_at");
        return self();
      };
      chain.then = (resolve: (value: { data: unknown }) => unknown) =>
        Promise.resolve({ data: table === "messages" ? (chain.__planned ? planned : sent) : [] }).then(resolve);
      return chain as never;
    },
  };

  capacityChecks = (async () => {
    const capacity = await loadCapacity(db as never, "u1", now);
    check("le plafond du jour 10 reste 25", capacity.dailyCap === 25, String(capacity.dailyCap));
    check("les 16 envois du jour sont comptes", capacity.sentToday === 16, String(capacity.sentToday));
    check(
      "les 9 intros programmees sont comptees a part",
      capacity.plannedToday === 9,
      String(capacity.plannedToday),
    );
    check(
      "16 envoyes + 9 programmes = plafond engage, plus un creneau",
      capacity.remaining === 0,
      String(capacity.remaining),
    );
  })();
}

// `loadCapacity` lit une base (fausse ici) : le rapport attend sa verification
// avant de conclure, sinon `process.exit` la couperait avant qu'elle ne compte.
// « Céder la place aux relances » (Cowork #42) — chiffres réels du vendredi 09/10/2026 :
// plafond 25 (jour 10), 16 envoyés, 9 intros programmées, 14 relances validées sans créneau.
const yieldChecks = (async () => {
  console.log("\nCéder la place aux relances (Cowork #42, 09/10)");
  const intros = Array.from({ length: 9 }, (_, index) => ({
    messageId: `intro-${index + 1}`,
    companyName: `Intro ${index + 1}`,
    // 15:20, 15:24 … 15:52 Paris (13:20 UTC …)
    scheduledAt: new Date(Date.UTC(2026, 9, 9, 13, 20 + index * 4)).toISOString(),
  }));
  const plan = planYield({ remaining: 0, day: "2026-10-09", relancesWaiting: 14, intros, taken: ["2026-10-12T07:00:00.000Z"] });
  check("plafond engagé (16 + 9 = 25/25) et 14 relances validées → le bouton s'affiche", plan.show && plan.relancesWaiting === 14);
  check("9 intros à décaler (autant qu'il y en a, ≤ 14 relances)", plan.moves.length === 9);
  check("vendredi 09/10 → jour ouvré suivant : lundi 12/10", plan.nextDay === "2026-10-12" && nextBusinessDay("2026-10-09") === "2026-10-12");
  check("en tête du lundi : dès 9 h, dans l'ordre d'origine, sans se superposer au 9 h déjà pris", plan.moves[0].to > "2026-10-12T07:00:00.000Z" && plan.moves.every((move, index) => index === 0 || move.to > plan.moves[index - 1].to) && plan.moves.every((move) => move.to.startsWith("2026-10-12")));
  const few = planYield({ remaining: 0, day: "2026-10-09", relancesWaiting: 3, intros });
  check("3 relances → les 3 intros les PLUS TARDIVES du jour seulement", few.moves.map((move) => move.messageId).sort().join(",") === "intro-7,intro-8,intro-9");
  check("créneau encore libre → pas de bouton", !planYield({ remaining: 1, day: "2026-10-09", relancesWaiting: 14, intros }).show);
  check("aucune relance validée → pas de bouton", !planYield({ remaining: 0, day: "2026-10-09", relancesWaiting: 0, intros }).show);
  check("aucune intro programmée → pas de bouton", !planYield({ remaining: 0, day: "2026-10-09", relancesWaiting: 14, intros: [] }).show);
  check("relances en attente = relances VALIDÉES (pas les brouillons, pas les programmées)", relancesWaitingOf([{ kind: "relance", status: "valide" }, { kind: "relance", status: "todo" }, { kind: "relance", status: "programme" }, { kind: "nouveau", status: "valide" }] as unknown as TodayItem[]) === 1);

  // Écriture : seulement après confirmation, seulement scheduled_at, jamais un envoi en cours.
  const db = new FakeDb({
    messages: [
      { id: "intro-9", user_id: "u", type: "intro", send_status: "scheduled", scheduled_at: intros[8].scheduledAt, subject: "Objet", body: "Texte inchangé" },
      { id: "intro-8", user_id: "u", type: "intro", send_status: "sending", scheduled_at: intros[7].scheduledAt, subject: "Objet", body: "Texte" },
      { id: "intro-7", user_id: "u", type: "intro", send_status: "scheduled", scheduled_at: intros[6].scheduledAt, subject: "Objet", body: "Texte" },
    ],
  });
  const result = await applyYield(db as never, "u", few, ["intro-9", "intro-8"]);
  const row = (id: string) => db.tables.messages.find((message) => message.id === id)!;
  check("décalage : l'intro confirmée et encore programmée change de créneau (lundi), son texte ne bouge pas", String(row("intro-9").scheduled_at).startsWith("2026-10-12") && row("intro-9").body === "Texte inchangé" && row("intro-9").send_status === "scheduled");
  check("décalage : une intro en cours d'envoi n'est jamais touchée", row("intro-8").scheduled_at === intros[7].scheduledAt && result.skipped === 1);
  check("décalage : rien sans confirmation (intro-7 du plan, non confirmée, ne bouge pas)", row("intro-7").scheduled_at === intros[6].scheduledAt && result.moved === 1);
})();

// Programmation sur plusieurs jours (Cowork #50) — lundi 12/10/2026, 13 h 53 : plafond du jour engagé, 12 validés.
{
  console.log("\nProgrammer sur plusieurs jours (Cowork #50)");
  const steady = () => 0;
  const validated = Array.from({ length: 12 }, (_, index) => item({ key: `n${index + 1}`, status: "valide" }));
  const monday = new Date("2026-10-12T11:53:00Z"); // 13 h 53 Paris
  check("jours ouvrés depuis lundi : lun., mar., mer.", businessDays(monday, 3).join(",") === "2026-10-12,2026-10-13,2026-10-14", businessDays(monday, 3).join(","));
  check("depuis vendredi : le week-end est sauté (ven., lun., mar.)", businessDays(new Date("2026-10-16T15:00:00Z"), 3).join(",") === "2026-10-16,2026-10-19,2026-10-20");
  check("un samedi : lundi d'abord", businessDays(new Date("2026-10-17T09:00:00Z"), 1)[0] === "2026-10-19");

  // Plafonds différents : lundi plein (25/25), mardi 15 dont 10 déjà engagés, mercredi 40 libre.
  const days = [
    { day: "2026-10-12", cap: 25, used: 25 },
    { day: "2026-10-13", cap: 15, used: 10 },
    { day: "2026-10-14", cap: 40, used: 0 },
  ];
  const tuesdayRelance = new Date("2026-10-13T07:00:00Z"); // relance J+4 déjà programmée mardi 9 h
  const plan = planDays({ items: validated, days, taken: [tuesdayRelance], now: monday, random: steady });
  const perDay = plan.days.map((room) => room.planned).join(",");
  check("lundi plein → 0 ; mardi : 5 places (15 − 10) ; mercredi : le reste (7)", perDay === "0,5,7", perDay);
  check("les 12 mails validés sont tous placés, rien de reporté", plan.planned.length === 12 && plan.postponed.length === 0);
  const tuesday = plan.planned.filter((entry) => entry.day === "2026-10-13");
  check("mardi : jamais à moins de 2 min de la relance déjà programmée à 9 h", tuesday.every((entry) => Math.abs(entry.at.getTime() - tuesdayRelance.getTime()) >= 120_000), tuesday.map((entry) => entry.at.toISOString()).join(","));
  const wednesday = plan.planned.filter((entry) => entry.day === "2026-10-14");
  check("mercredi : premier envoi à 9 h (Paris)", wednesday[0]?.at.toISOString() === "2026-10-14T07:00:00.000Z", wednesday[0]?.at.toISOString());
  check("chaque envoi reste dans 9 h – 17 h de son jour", plan.planned.every((entry) => { const hour = Number(entry.at.toLocaleTimeString("fr-FR", { hour: "2-digit", timeZone: "Europe/Paris" }).slice(0, 2)); return hour >= 9 && hour < 17; }));

  const todayOnly = planDays({ items: validated, days: days.slice(0, 1), now: monday, random: steady });
  check("horizon « aujourd'hui seulement », jour plein : 0 programmé, 12 restent validés", todayOnly.planned.length === 0 && todayOnly.postponed.length === 12);
  const roomToday = planDays({ items: validated, days: [{ day: "2026-10-12", cap: 25, used: 20 }, days[2]], now: monday, random: steady });
  check("place restante aujourd'hui : utilisée d'abord (5), dès maintenant + 3 min", roomToday.days[0].planned === 5 && roomToday.planned[0].at.getTime() >= monday.getTime() + 3 * 60_000);
  const evening = planDays({ items: validated, days: [{ day: "2026-10-12", cap: 25, used: 0 }, days[2]], now: new Date("2026-10-12T15:30:00Z"), random: steady });
  check("passé 17 h : aujourd'hui 0 malgré la place, tout part le jour ouvré suivant", evening.days[0].planned === 0 && evening.days[1].planned === 12);
  const friday = businessDays(new Date("2026-10-16T16:00:00Z"), 3).map((day) => ({ day, cap: 4, used: 0 }));
  const weekend = planDays({ items: validated, days: friday, now: new Date("2026-10-16T16:00:00Z"), random: steady });
  check("vendredi 18 h : rien le samedi ni le dimanche (lundi 4, mardi 4, 4 reportés)", weekend.planned.every((entry) => ["2026-10-19", "2026-10-20"].includes(entry.day)) && weekend.planned.length === 8 && weekend.postponed.length === 4);
}

void Promise.all([capacityChecks, yieldChecks]).then(() => {
  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
});

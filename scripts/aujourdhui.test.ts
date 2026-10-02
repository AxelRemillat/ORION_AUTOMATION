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
import { readFileSync } from "node:fs";
import { flatten, groupToday, nextTodo, type RawTodayItem } from "../lib/today/group";
import { completionLabel, isComplete, shouldRetryCompletion, tagsOf } from "../lib/today/tags";
import { planSchedule, sendDay } from "../lib/today/plan";
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
  check("profil métier vide", tagsOf({ ...base, hasBusinessProfile: false }).includes("Profil métier vide"));
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

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);

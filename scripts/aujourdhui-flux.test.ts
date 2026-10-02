/**
 * « Aujourd'hui » — les flux, sur base en mémoire (scripts/fake-supabase.ts).
 * Aucun réseau, aucun crédit : les appels payants sont des doubles.
 *
 *   - les fiches des runs passés apparaissent dans la file (aucune perte) ;
 *   - le déclencheur du matin : heure, interrupteur, une fois par jour ;
 *   - la complétion automatique : une tentative par run, trois au plus ;
 *   - la programmation : jamais sans validation, plafond respecté ;
 *   - « Écarter » ajoute une ligne, « Annuler » la neutralise — rien n'est effacé.
 *
 * Exécution : `npm run test:aujourdhui`.
 */
import { FakeDb } from "./fake-supabase";
import { autoRunDue, startDueAutoRuns } from "../lib/today/auto-run";
import { runCompletionStage } from "../lib/today/complete";
import { loadToday } from "../lib/today/load";
import { flatten } from "../lib/today/group";
import { discard, scheduleBatch, undoDiscard } from "../lib/today/actions-core";
import { needsIntroDraft } from "../lib/jobs/handlers/prepare";
import { cleanPrefs, DEFAULT_PREFS } from "../lib/funnel/settings";
import type { Db } from "../lib/trash/scope";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const USER = "u1";
const NOW = new Date("2026-10-05T07:30:00Z"); // lundi 9 h 30 à Paris
const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, company_name: `Société ${id}`, status: "nouveau", email: `contact@${id}.fr`, website: `https://${id}.fr`,
  // Registre lu (Pappers) : l'opposition est connue. Une fiche sans cette marque
  // est « Opposition non vérifiée » depuis le 02/10/2026 (ADJUVOO).
  key_figures: { pappers_read: true }, signals: [], sector: "Transport", city: "Lyon", deleted_at: null, do_not_contact: false, business_profile: { a: 1 }, ...over,
});
const candidate = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, run_id: "run-30-09", statut: "creusé", publication: "pret", prospect_id: prospectId, source: "bodacc",
  date_signal: "2026-09-29", texte_brut: "Modification du dirigeant", url_source: null, siren: "123456789", company_name: `Société ${prospectId}`,
  hash: `h-${id}`, motif_rejet: null, facts: { label: "Nouveau dirigeant" }, badges: [], score: 4, triage: { score: 4 }, weight: 1,
  created_at: "2026-09-30T05:00:00Z", updated_at: "2026-09-30T05:00:00Z",
  contact: { badge: "nominatif", email: `contact@${prospectId}.fr` }, identity: null, ...over,
});
const draft = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, prospect_id: prospectId, type: "intro", status: "draft", send_status: "draft", subject: "Objet",
  body: "Bonjour,\n\nTexte.", created_at: "2026-10-01T05:00:00Z", deleted_at: null, validated_at: null, ...over,
});

async function main() {
  console.log("\n10. Les fiches des runs du 30/09 et du 01/10 sont dans la file");
  {
    const db = new FakeDb({
      prospects: [prospect("a"), prospect("b"), prospect("c", { email: null })],
      signal_candidates: [candidate("ca", "a"), candidate("cb", "b", { run_id: "run-01-10" }), candidate("cc", "c", { publication: "a_completer", contact: { badge: "aucun" } })],
      messages: [draft("ma", "a")],
    });
    const items = flatten((await loadToday(db as unknown as Db, USER, NOW)).groups);
    check("les trois fiches sont présentes", ["a", "b", "c"].every((id) => items.some((item) => item.prospectId === id)), items.map((item) => item.key).join(","));
    check("avec brouillon : « Nouveaux prospects »", items.find((item) => item.prospectId === "a")?.kind === "nouveau");
    check("sans brouillon : « À compléter », Brouillon manquant", items.find((item) => item.prospectId === "b")?.tags.includes("Brouillon manquant") === true);
    check("sans email : « Email manquant »", items.find((item) => item.prospectId === "c")?.tags.includes("Email manquant") === true);
    check("b n'attend que son brouillon → préparé automatiquement", needsIntroDraft(items.find((item) => item.prospectId === "b")!));
    check("c n'a pas d'email → pas de brouillon payé pour rien", !needsIntroDraft(items.find((item) => item.prospectId === "c")!));
    check("aucune ligne écrite par la lecture", db.rows("prospect_discards").length === 0 && db.rows("messages").length === 1);
  }

  console.log("\n11. Déclencheur du matin");
  {
    const at = (iso: string) => new Date(iso);
    check("5 h pile à Paris : dû", autoRunDue({ daily: true, autoHour: 5, lastRunOn: "2026-10-04", now: at("2026-10-05T03:00:00Z") }));
    check("4 h 59 : pas encore", !autoRunDue({ daily: true, autoHour: 5, lastRunOn: null, now: at("2026-10-05T02:59:00Z") }));
    check("déjà tourné aujourd'hui : non", !autoRunDue({ daily: true, autoHour: 5, lastRunOn: "2026-10-05", now: at("2026-10-05T09:00:00Z") }));
    check("interrupteur coupé : jamais", !autoRunDue({ daily: false, autoHour: 5, lastRunOn: null, now: at("2026-10-05T09:00:00Z") }));
    const db = new FakeDb({ funnel_settings: [{ user_id: USER, daily: true, auto_hour: 5, daily_target: 25, last_auto_run_on: "2026-10-04" }], jobs: [] });
    const first = await startDueAutoRuns(db as unknown as Db, at("2026-10-05T03:01:00Z"));
    const second = await startDueAutoRuns(db as unknown as Db, at("2026-10-05T03:02:00Z"));
    check("un run lancé, un seul", first === 1 && second === 0 && db.rows("jobs").length === 1, `${first}/${second}/${db.rows("jobs").length}`);
    const job = db.rows("jobs")[0] as { params?: { kind?: string; digLimit?: number }; user_id?: string };
    check("job « prepare », objectif 25, pour le bon compte", job?.params?.kind === "prepare" && job.params.digLimit === 25 && job.user_id === USER);
    check("réglages bornés", cleanPrefs({ autoHour: 99, dailyTarget: 0 }, DEFAULT_PREFS).autoHour === 23 && cleanPrefs({ dailyTarget: 0 }).dailyTarget === 1);
    check("défauts : 5 h, 25 fiches", DEFAULT_PREFS.autoHour === 5 && DEFAULT_PREFS.dailyTarget === 25);
  }

  console.log("\n12. Complétion automatique : une fois par run, trois au plus");
  {
    const db = new FakeDb({
      prospects: [prospect("p1", { email: null }), prospect("p2", { email: null })],
      signal_candidates: [
        candidate("c1", "p1", { publication: "a_completer", contact: { badge: "aucun" } }),
        candidate("c2", "p2", { publication: "a_completer", contact: { badge: "aucun", attempts: 3 } }),
      ],
    });
    let calls = 0;
    const deps = { findContact: async (id: string) => ((calls += 1), id === "p1" && calls > 1 ? { email: "dg@p1.fr" } : { email: null }) as never };
    const run = (runId: string) => runCompletionStage(db as unknown as Db, USER, runId, { deps, limit: 6, deadline: Date.now() + 60_000, refilter: () => ({ status: "retenu" }) });
    await run("r1");
    await run("r1");
    check("même run : une seule tentative", calls === 1, String(calls));
    check("la fiche à 3 tentatives n'est plus retentée", !db.rows("signal_candidates").some((row) => row.id === "c2" && (row.contact as { attempts: number }).attempts > 3));
    await run("r2");
    const c1 = db.rows("signal_candidates").find((row) => row.id === "c1")!;
    check("run suivant : email trouvé, fiche « prête »", c1.publication === "pret" && (c1.contact as { email?: string }).email === "dg@p1.fr");
    check("tentatives comptées", (c1.contact as { attempts?: number }).attempts === 2);
  }

  console.log("\n13. Programmation : jamais sans validation, plafond respecté");
  {
    const db = new FakeDb({
      prospects: [prospect("a"), prospect("b"), prospect("c")],
      signal_candidates: [candidate("ca", "a"), candidate("cb", "b"), candidate("cc", "c")],
      messages: [draft("ma", "a", { validated_at: "2026-10-05T07:00:00Z" }), draft("mb", "b"), draft("mc", "c", { validated_at: "2026-10-05T07:00:00Z" })],
    });
    const at = "2026-10-05T08:00:00.000Z"; // 10 h Paris
    const result = await scheduleBatch(db as unknown as Db, USER, [
      { key: "prospect:b", at },
      { key: "prospect:a", at: "2026-10-05T16:30:00.000Z" }, // 18 h 30 : hors fenêtre
      { key: "prospect:c", at },
    ], 0, NOW);
    const refused = result.ok ? result.refused.map((entry) => `${entry.key}:${entry.error}`) : [];
    check("non validé : refusé", refused.some((entry) => entry.startsWith("prospect:b:Non validé")));
    check("hors 9 h – 17 h : refusé", refused.some((entry) => entry.startsWith("prospect:a:Hors de la fenêtre")));
    check("plafond atteint : refusé", refused.some((entry) => entry.startsWith("prospect:c:Plafond")));
    check("rien n'est programmé", db.rows("messages").every((row) => row.send_status === "draft"));
  }

  console.log("\n14. Écarter puis Annuler : rien n'est effacé");
  {
    const db = new FakeDb({ prospects: [prospect("a")], messages: [draft("ma", "a", { validated_at: "2026-10-05T07:00:00Z" })], prospect_discards: [] });
    const done = await discard(db as unknown as Db, USER, { kind: "nouveau", reason: "hors_cible", prospectId: "a", messageId: "ma", inboundId: null, candidateId: null });
    check("motif enregistré", done.ok && db.rows("prospect_discards")[0]?.reason === "hors_cible");
    check("le brouillon écarté perd sa validation, mais reste", db.rows("messages")[0]?.validated_at === null && db.rows("messages").length === 1);
    if (done.ok) await undoDiscard(db as unknown as Db, USER, done.discardId);
    check("« Annuler » neutralise sans supprimer", db.rows("prospect_discards").length === 1 && Boolean(db.rows("prospect_discards")[0]?.undone_at));
  }

  console.log(failures === 0 ? "\nTous les tests de flux passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

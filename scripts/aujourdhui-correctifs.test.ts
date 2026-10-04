/**
 * Correctifs du lot 1 « Aujourd'hui » (02/10/2026), sur les cas réels relevés
 * en prod : ARTFLEX (déjà contacté), ADJUVOO (opposée), MAVIFLEX (filiale
 * Hörmann), montée en charge (premier envoi réel le 28/09). Chiffres clés
 * recopiés de la base, fixtures seulement : aucun appel réseau, aucun crédit.
 * Exécution : `npm run test:aujourdhui-correctifs`.
 */
import { offTargetReason } from "../lib/funnel/off-target";
import { readFileSync } from "node:fs";
import { fetchInpiOpposition, resetInpiToken } from "../lib/enrichment/inpi";
import { candidateDomains, NOT_OFFICIAL } from "../lib/enrichment/site";
import { cappedScore, subsidiaryOf } from "../lib/enrichment/subsidiary";
import { digOne, type DigCandidate, type DigDeps } from "../lib/funnel/dig";
import { latestIntroDraft } from "../lib/jobs/handlers/email";
import { buildDeliverability, businessDaysSince, firstRealSend } from "../lib/outbox/deliverability";
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";
import { checkSendRules, type OutboxMessage } from "../lib/outbox/send";
import { prepareAlert } from "../lib/today/auto-run";
import { runCompletionStage } from "../lib/today/complete";
import { flatten } from "../lib/today/group";
import { loadToday } from "../lib/today/load";
import { oppositionKnown, verifyQueueOppositions } from "../lib/today/opposition";
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

const USER = "u1";

// --- Chiffres clés RÉELS (base, 02/10/2026) ---------------------------------
const ARTFLEX_FIGURES = {
  leader: "Jean-pierre ROMEO", headcount: 21, leader_role: "Président", leader_since: "2016-08-11",
  leader_person: "Jean-Pierre Romeo", group_evidence: ["Registre : représentée par LLED, personne morale"],
  parent_company: "LLED", is_large_group_subsidiary: false,
};
const ADJUVOO_FIGURES = {
  leader: "CONSEILS ASSOCIES SA", headcount: 100, funnel_score: 5, parent_company: "KEY BUSINESS SERVICES SA", is_large_group_subsidiary: false,
};
const MAVIFLEX_FIGURES = {
  leader: "CHRISTOPH PAUL STEPHAN HORMANN", headcount: 100, funnel_score: 5, leader_person: "Christoph Hormann",
  parent_company: "COMPAGNIE FIDUCIAIRE FRANCO-ALLEMANDE (COFFRA)", is_large_group_subsidiary: false,
};

const prospect = (id: string, name: string, siren: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, company_name: name, siren, status: "nouveau", email: `contact@${id}.fr`, website: `https://${id}.fr`,
  key_figures: {}, signals: [], sector: "Industrie", city: "Lyon", deleted_at: null, do_not_contact: false,
  business_profile: { offre: "x" }, naf_code: "28.29B", size_range: "100 à 199 salariés", ...over,
});
const message = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, prospect_id: prospectId, type: "intro", status: "draft", send_status: "draft", subject: "Objet",
  body: "Bonjour,\n\nTexte.", created_at: "2026-10-01T05:00:00Z", deleted_at: null, validated_at: null, sent_at: null,
  thread_id: null, reply_to_inbound_id: null, reply_to_gmail_message_id: null, gmail_message_id: null, origin: null, ...over,
});
const candidate = (id: string, prospectId: string, over: Record<string, unknown> = {}) => ({
  id, user_id: USER, run_id: "fe69d62f", statut: "creusé", publication: "pret", prospect_id: prospectId, source: "france-travail",
  date_signal: "2026-09-29", texte_brut: "Offre", url_source: null, siren: null, company_name: prospectId, hash: `h-${id}`,
  motif_rejet: null, facts: { label: "Recrutement" }, badges: [], score: 5, triage: { score: 5 }, weight: 1,
  created_at: "2026-09-30T05:00:00Z", updated_at: "2026-09-30T05:00:00Z", contact: { badge: "generique" }, identity: null, ...over,
});

/** API RNE simulée sur les fixtures INPI (aucun réseau). */
const inpiFetch = (async (input: string | URL) => {
  const url = String(input);
  if (url.endsWith("/sso/login")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
  const siren = url.split("/").pop() as string;
  return new Response(readFileSync(`scripts/fixtures/inpi/${siren}.json`, "utf8"), { status: 200 });
}) as unknown as typeof fetch;

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n1. ARTFLEX : déjà contacté, jamais en intro");
  {
    const artflex = prospect("artflex", "ARTFLEX", "520644386", { status: "contacte", key_figures: { ...ARTFLEX_FIGURES, pappers_read: true } });
    const sent = message("m-sent", "artflex", {
      status: "sent", send_status: "sent", sent_at: "2026-09-30T13:14:08.947Z", gmail_message_id: "g1", created_at: "2026-09-30T13:05:28Z",
    });
    const evalLegacy = message("m-eval-ancien", "artflex", { created_at: "2026-09-30T14:43:03Z" }); // éval d'avant le marquage
    const evalMarked = message("m-eval", "artflex", { origin: "eval", created_at: "2026-10-02T10:00:00Z" });
    const tables = () => ({
      prospects: [artflex],
      messages: [sent, evalLegacy, evalMarked],
      reminders: [{ id: "r1", user_id: USER, prospect_id: "artflex", due_at: "2026-10-04T13:14:08.947Z", done: false }],
      signal_candidates: [], inbound_messages: [], prospect_discards: [], jobs: [],
    });

    const friday = flatten((await loadToday(new FakeDb(tables()) as unknown as Db, USER, new Date("2026-10-02T14:00:00Z"))).groups);
    check("ven. 02/10 : ARTFLEX absent de la file (ni nouveau, ni à compléter)", !friday.some((item) => item.prospectId === "artflex"), friday.map((item) => item.key));

    const monday = flatten((await loadToday(new FakeDb(tables()) as unknown as Db, USER, new Date("2026-10-05T07:30:00Z"))).groups);
    const artflexItems = monday.filter((item) => item.prospectId === "artflex");
    check("lun. 05/10 : ARTFLEX revient UNIQUEMENT en relance J+4", artflexItems.length === 1 && artflexItems[0].kind === "relance", artflexItems.map((item) => item.key));
    check("… sans reprendre le brouillon d'intro d'éval", artflexItems[0]?.messageId === null);

    // Un prospect jamais contacté qui n'a qu'un brouillon d'éval : rien ne remonte.
    const onlyEval = new FakeDb({
      prospects: [prospect("x", "X", "111111111", { key_figures: { pappers_read: true } })],
      messages: [message("mx", "x", { origin: "eval" })],
      reminders: [], signal_candidates: [], inbound_messages: [], prospect_discards: [], jobs: [],
    });
    const items = flatten((await loadToday(onlyEval as unknown as Db, USER, new Date("2026-10-02T14:00:00Z"))).groups);
    check("brouillon d'éval seul : jamais dans la file", items.length === 0, items.map((item) => item.key));

    // La génération : l'éval ne réécrit pas le brouillon de l'appli, et l'inverse.
    const ctx = { db: new FakeDb({ messages: [evalLegacy, evalMarked] }) as unknown as Db, userId: USER };
    check("génération appli : reprend le brouillon de l'appli, pas celui de l'éval", (await latestIntroDraft(ctx as never, "artflex")) === "m-eval-ancien");
    check("génération éval : ne reprend QUE le brouillon d'éval", (await latestIntroDraft(ctx as never, "artflex", "eval")) === "m-eval");

    // Le serveur refuse l'intro (programmation, envoi, tick : même contrôle).
    const db = new FakeDb({ ...tables(), prospects: [{ ...artflex, email: "contact@artflex-robinetterie.fr" }] });
    const refused = await checkSendRules(db as unknown as Db, evalLegacy as unknown as OutboxMessage, "contact@artflex-robinetterie.fr", new Date("2026-10-02T14:00:00Z"));
    check("serveur : intro refusée, prospect déjà contacté", Boolean(refused && !refused.ok && refused.error.includes("déjà contacté")), refused);
    const relance = await checkSendRules(
      db as unknown as Db,
      { ...evalLegacy, id: "m-r1", type: "relance_1" } as unknown as OutboxMessage,
      "contact@artflex-robinetterie.fr",
      new Date("2026-10-05T08:00:00Z"),
    );
    check("… une relance, elle, n'est pas concernée par ce refus", !relance || relance.ok || !relance.error.includes("déjà contacté"), relance);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. ADJUVOO : opposée — dans AUCUN groupe, aucune complétion");
  {
    // Filiale (dirigée par une société), ADJUVOO serait hors cible d'office depuis le
    // 05/10 : ce test porte sur l'OPPOSITION, on lui donne un dirigeant personne physique.
    const adjuvoo = prospect("adjuvoo", "ADJUVOO", "898001029", { key_figures: { ...ADJUVOO_FIGURES, leader_person: "Jean Test" } });
    const db = new FakeDb({
      prospects: [adjuvoo],
      messages: [message("ma", "adjuvoo", { created_at: "2026-10-02T16:31:06Z" })],
      signal_candidates: [candidate("ca", "adjuvoo")],
      reminders: [], inbound_messages: [], prospect_discards: [], jobs: [],
    });
    const now = new Date("2026-10-02T17:00:00Z");
    check("chiffres réels : opposition jamais lue (ni Pappers, ni vérification)", !oppositionKnown(ADJUVOO_FIGURES));
    const before = flatten((await loadToday(db as unknown as Db, USER, now)).groups).find((item) => item.prospectId === "adjuvoo");
    check("avant vérification : jamais en « Nouveaux », « Opposition non vérifiée »", before?.kind === "a_completer" && before.tags.includes("Opposition non vérifiée"), before?.tags);

    resetInpiToken();
    process.env.INPI_USERNAME = "test@example.com";
    process.env.INPI_PASSWORD = "test";
    const report = await verifyQueueOppositions(db as unknown as Db, USER, {
      verify: async (siren) => {
        const read = await fetchInpiOpposition(siren, inpiFetch, 0);
        return read.ok ? { ok: true, refuses: read.refuses, source: "inpi" } : { ok: false, error: read.error };
      },
      limit: 40,
      deadline: Date.now() + 60_000,
    });
    const figures = db.rows("prospects")[0].key_figures as Record<string, unknown>;
    check("préparation : opposition lue à l'INPI, ADJUVOO marquée opposée", report.opposed === 1 && figures.refuses_prospecting === true && figures.opposition_source === "inpi", report);
    const after = flatten((await loadToday(db as unknown as Db, USER, now)).groups);
    check("après vérification : ADJUVOO dans aucun groupe", !after.some((item) => item.prospectId === "adjuvoo"), after.map((item) => item.key));
    check("… rien n'est supprimé (fiche, brouillon, candidat intacts)", db.rows("prospects").length === 1 && db.rows("messages").length === 1 && db.rows("signal_candidates").length === 1);

    // Complétion : ni recherche gratuite ni Hunter sur une fiche exclue.
    const completion = new FakeDb({
      prospects: [
        { ...adjuvoo, email: null, key_figures: { ...ADJUVOO_FIGURES, refuses_prospecting: true } },
        prospect("dnc", "DNC", "222222222", { email: null, do_not_contact: true, key_figures: { pappers_read: true } }),
        prospect("ok", "OK", "333333333", { email: null, key_figures: { pappers_read: true } }),
      ],
      signal_candidates: [
        candidate("c-adj", "adjuvoo", { publication: "a_completer", contact: { badge: "aucun" } }),
        candidate("c-dnc", "dnc", { publication: "a_completer", contact: { badge: "aucun" } }),
        candidate("c-ok", "ok", { publication: "a_completer", contact: { badge: "aucun" } }),
      ],
    });
    const searched: string[] = [];
    const out = await runCompletionStage(completion as unknown as Db, USER, "run-x", {
      deps: { findContact: async (id) => (searched.push(id), { confidence: 0, found_by: "aucun" }) },
      limit: 6,
      deadline: Date.now() + 60_000,
      refilter: () => ({ status: "retenu" }),
    });
    check("complétion : opposée et « ne plus contacter » jamais cherchées", searched.length === 1 && searched[0] === "ok" && out.excluded === 2, { searched, out });
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Montée en charge : jour 5, plafond 15 (premier envoi réel le 28/09)");
  {
    // Historique réel des envois (dates et marques Gmail de la base).
    const history = [
      { status: "sent", sent_at: "2026-09-19T12:28:36.597Z", type: "intro", gmail_message_id: null }, // JACQUET PARIS : marqué à la main
      { status: "sent", sent_at: "2026-09-27T13:07:46.545Z", type: "reponse", gmail_message_id: "g0" }, // VIVAUTO : réponse
      { status: "sent", sent_at: "2026-09-28T07:00:03.662Z", type: "intro", gmail_message_id: "g1" },
      { status: "sent", sent_at: "2026-09-28T07:00:03.662Z", type: "intro", gmail_message_id: "g2" },
      { status: "sent", sent_at: "2026-09-28T07:00:03.662Z", type: "intro", gmail_message_id: "g3" },
      { status: "sent", sent_at: "2026-09-28T07:01:01.043Z", type: "intro", gmail_message_id: "g4" },
      { status: "sent", sent_at: "2026-09-30T13:14:08.947Z", type: "intro", gmail_message_id: "g5" },
      { status: "sent", sent_at: "2026-10-01T07:00:08.927Z", type: "intro", gmail_message_id: "g6" },
    ] as const;
    const now = new Date("2026-10-02T14:00:00Z");
    check("premier envoi réel : 28/09 (ni le 19/09 marqué à la main, ni la réponse du 27/09)", firstRealSend([...history]) === "2026-09-28T07:00:03.662Z");
    const state = buildDeliverability([...history], now);
    check("ven. 02/10 : jour 5, plafond 15", state.warmupDay === 5 && state.dailyCap === 15, state);
    check("jours ouvrés : le week-end ne compte pas (lun. 05/10 = jour 6)", businessDaysSince("2026-09-28T07:00:03Z", new Date("2026-10-05T08:00:00Z")) === 6);
    check("jour 8 (mer. 07/10) : plafond 25", buildDeliverability([...history], new Date("2026-10-07T08:00:00Z")).dailyCap === 25);

    // Le serveur applique le même plafond : 15 envois partis aujourd'hui → refus.
    const today = Array.from({ length: 15 }, (_, index) => message(`t${index}`, `autre-${index}`, {
      status: "sent", send_status: "sent", sent_at: `2026-10-02T${String(8 + Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 10).padStart(2, "0")}:00Z`, gmail_message_id: `t${index}`,
    }));
    const db = new FakeDb({
      prospects: [prospect("p", "P", "444444444", { key_figures: { pappers_read: true }, email: "a@p.fr" })],
      messages: [...history.map((row, index) => message(`h${index}`, "z", row as unknown as Record<string, unknown>)), ...today, message("draft", "p")],
      inbound_messages: [],
    });
    const body = `Bonjour,

Corps.

${OPT_OUT_SENTENCE}

Axel Remillat`;
    const capped = await checkSendRules(db as unknown as Db, message("draft", "p", { body }) as unknown as OutboxMessage, "a@p.fr", now);
    check("serveur : 15/15 → refusé (et non 25)", Boolean(capped && !capped.ok && capped.status === 429 && capped.error.includes("15/15")), capped);
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Profil métier et brouillons des fiches existantes");
  {
    check("« maviflex.com » n'est plus pris pour x.com", !NOT_OFFICIAL.test("maviflex.com"));
    check("… les vrais réseaux restent écartés", ["x.com", "www.linkedin.com", "societe.com", "annuaire-entreprises.data.gouv.fr", "pappers.fr"].every((d) => NOT_OFFICIAL.test(d)));
    check("MAVIFLEX : son site est bien candidat à la lecture", candidateDomains({ name: "MAVIFLEX", knownWebsite: "https://maviflex.com" }).some((c) => c.domain === "maviflex.com"));
    check("en-tête : préparation en échec → erreur affichée", prepareAlert({ status: "failed", error: "délai dépassé", at: "x", failedDrafts: 0, firstDraftError: null }) === "Dernière préparation en échec : délai dépassé");
    check("en-tête : brouillons en échec → comptés", prepareAlert({ status: "done", error: null, at: "x", failedDrafts: 2, firstDraftError: "quota OpenAI" }) === "2 brouillon(s) non rédigé(s) : quota OpenAI");
    check("en-tête : tout va bien → rien", prepareAlert({ status: "done", error: null, at: "x", failedDrafts: 0, firstDraftError: null }) === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Filiale de groupe : MAVIFLEX (Hörmann)");
  {
    check("MAVIFLEX : dirigeant Christoph Hörmann → filiale du groupe Hörmann", subsidiaryOf(MAVIFLEX_FIGURES) === "Hörmann", subsidiaryOf(MAVIFLEX_FIGURES));
    check("ARTFLEX : holding personnelle (LLED, dirigeant Romeo) → PAS une filiale", subsidiaryOf(ARTFLEX_FIGURES) === null);
    check("ADJUVOO : dirigée par une société, sans dirigeant personne physique → filiale", subsidiaryOf(ADJUVOO_FIGURES) === "KEY BUSINESS SERVICES SA");
    check("drapeau registre : société mère étrangère → filiale", subsidiaryOf({ parent_foreign: true, parent_company: "HÖRMANN KG" }) === "HÖRMANN KG");
    check("score plafonné à 3", cappedScore(5, "Hörmann") === 3 && cappedScore(5, null) === 5 && cappedScore(2, "X") === 2);

    const db = new FakeDb({
      prospects: [prospect("maviflex", "MAVIFLEX", "328025721", { key_figures: { ...MAVIFLEX_FIGURES, pappers_read: true } })],
      messages: [message("mm", "maviflex", { created_at: "2026-10-02T16:29:11Z" })],
      signal_candidates: [candidate("cm", "maviflex", { score: 5 })],
      reminders: [], inbound_messages: [], prospect_discards: [], jobs: [],
    });
    const item = flatten((await loadToday(db as unknown as Db, USER, new Date("2026-10-02T17:00:00Z"))).groups).find((row) => row.prospectId === "maviflex");
    // Règle du 05/10/2026 (Cowork) : une filiale de groupe n'est PAS proposée par
    // défaut — elle est hors cible, comme « grand groupe ». Avant : badge + score 3.
    check("« Aujourd'hui » : filiale de groupe hors de toute file (hors cible)", item === undefined, { tags: item?.tags, score: item?.score });
    const reason = offTargetReason({ company_name: "MAVIFLEX", size_range: null, key_figures: MAVIFLEX_FIGURES } as never);
    check("… la raison est dite (groupe Hörmann)", reason?.includes("Hörmann") === true, reason);

    const outcome = await digOne(
      {
        enrich: async () => ({ company_name: "MAVIFLEX", key_figures: { ...MAVIFLEX_FIGURES, pappers_read: true, opposition_checked: true }, signals: [], warnings: [] }) as never,
        createProspect: async () => ({ id: "p" }),
        findContact: async () => ({ confidence: 0, found_by: "aucun" }),
        brief: async () => undefined,
      } as DigDeps,
      { id: "c", signal: {}, base: { company_name: "MAVIFLEX" }, triage: { score: 5 }, weight: 1 } as unknown as DigCandidate,
    );
    check("entonnoir : la fiche creusée porte la filiale (badge + score 3 à la publication)", outcome.subsidiary === "Hörmann", outcome);
  }

  console.log(failures === 0 ? "\nTous les correctifs du lot 1 passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

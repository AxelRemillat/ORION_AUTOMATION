/**
 * Lot 6a — volume quotidien et mesure de ce qui marche. Fixtures seulement :
 * aucun appel réseau, aucun crédit. `npm run test:volume`
 */
import { fetchPappers } from "../lib/enrichment/pappers";
import { pappersNeed } from "../lib/enrichment/pappers-policy";
import { DEFAULT_PREFS } from "../lib/funnel/settings";
import { widenPlan } from "../lib/jobs/handlers/prepare";
import { nextRampStep } from "../lib/settings/ramp";
import { buildReadiness } from "../lib/usage/readiness";
import { deriveVariant, recordMessageVariant } from "../lib/variants/record";
import { lengthBand, outcomeOf, variantStats, type SentVariant } from "../lib/variants/stats";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

async function main() {
  console.log("\n1. Sobriété Pappers");
  {
    const base = (over: Record<string, unknown>) => ({ siren: "520644386", parent_company: null, figures: { revenue_eur: 2_000_000 }, ...over }) as never;
    check("annuaire suffisant (CA publié, dirigeant personne) : Pappers non appelé", !pappersNeed(base({})).needed);
    check("aucun CA publié : Pappers (finances)", pappersNeed(base({ figures: {} })).needed);
    check("dirigée par une société (CA publié) : plus de Pappers — holding résolue dans l'annuaire", !pappersNeed(base({ parent_company: "LLED" })).needed);
    check("sans SIREN : jamais", !pappersNeed(base({ siren: null })).needed);

    process.env.PAPPERS_API_KEY = "cle-de-test";
    const store = new Map<string, unknown>();
    const cache = { read: async <T,>(key: string) => (store.get(key) as T) ?? null, write: async (key: string, value: unknown) => void store.set(key, value) };
    let calls = 0;
    const fetchJson = (async () => ((calls += 1), { ok: true, data: { opposition_utilisation_commerciale: false } })) as never;
    const allowance = async () => ({ allowed: true });
    await fetchPappers("520644386", { cache, fetchJson, allowance });
    const again = await fetchPappers("520644386", { cache, fetchJson, allowance });
    check("même fiche relue (ex. recherche de contact après l'enrichissement) : 1 seul crédit", calls === 1 && again.ok, calls);
    store.set("pappers:skip:111111111", true);
    const skipped = await fetchPappers("111111111", { cache, fetchJson, allowance });
    check("fiche marquée « Pappers non nécessaire » : aucun appel", !skipped.ok && calls === 1);
    const forced = await fetchPappers("111111111", { cache, fetchJson, allowance, force: true });
    check("repli d'opposition / holding (force) : l'appel part", forced.ok && calls === 2);
    delete process.env.PAPPERS_API_KEY;
  }

  console.log("\n2. Objectif quotidien et élargissement de l'entonnoir");
  {
    check("« Mails prêts visés par jour » : 15 par défaut", DEFAULT_PREFS.dailyTarget === 15);
    const reached = widenPlan({ ready: 15, target: 15, days: 14, departements: ["69"], budgetOk: true, alreadyWidened: false });
    check("objectif atteint : pas d'élargissement", !reached.widen);
    const plan = widenPlan({ ready: 6, target: 15, days: 14, departements: ["69", "38"], budgetOk: true, alreadyWidened: false });
    check("6/15 : fenêtre doublée (28 j), toute la France, plafond de creusage 24", plan.widen && plan.days === 28 && plan.departements.length === 0 && plan.digLimit === 24, plan);
    check("budget du jour atteint : pas d'élargissement", !widenPlan({ ready: 6, target: 15, days: 14, departements: [], budgetOk: false, alreadyWidened: false }).widen);
    check("un seul élargissement par préparation", !widenPlan({ ready: 6, target: 15, days: 28, departements: [], budgetOk: true, alreadyWidened: true }).widen);
    check("fenêtre plafonnée à 30 jours", (widenPlan({ ready: 0, target: 30, days: 20, departements: [], budgetOk: true, alreadyWidened: false }) as { days: number }).days === 30);
  }

  console.log("\n3. Mails prêts et coût par mail prêt");
  {
    const days = ["2026-10-02", "2026-10-03", "2026-10-05"].map((day) => ({ day, eur: { openai: 1.2, hunter: 0.3, pappers: 0, linkup: 0.05, gratuit: 0 } }));
    const drafts = [
      { created_at: "2026-10-02T15:00:00Z", quality_score: 9.5, type: "intro" },
      { created_at: "2026-10-02T15:05:00Z", quality_score: 9, type: "intro" },
      { created_at: "2026-10-02T15:10:00Z", quality_score: 8.5, type: "intro" }, // < 9 : pas prêt
      { created_at: "2026-10-02T15:20:00Z", quality_score: 9.8, type: "intro", origin: "eval" }, // éval : jamais compté
      { created_at: "2026-10-05T06:00:00Z", quality_score: 9.2, type: "intro" },
    ];
    const r = buildReadiness(days, drafts);
    check("mails prêts : brouillons d'intro ≥ 9, hors éval", r.totalReady === 3 && r.days[0].ready === 2, r.days);
    check("coût par mail prêt le 02/10 : 1,55 € ÷ 2", r.days[0].costPerReady === 0.78, r.days[0]);
    check("jour sans mail prêt : coût non défini (pas 0)", r.days[1].costPerReady === null);
    check("sur la fenêtre : dépense ÷ mails prêts ; moyenne par jour ouvré", r.costPerReady === 1.55 && r.readyPerDay === 1.5, r);
  }

  console.log("\n4. Variantes : enregistrement et taux par valeur");
  {
    const v = deriveVariant("Vos demandes de prix ?", "Bonjour Monsieur Romeo,\n\nChez un distributeur de robinetterie, chaque demande arrive avec ses références.\nJe vous montre en 15 minutes.\n\nSi le sujet ne vous concerne pas, un simple « stop » en réponse et je ne vous relancerai pas.\n\nAxel Remillat");
    check("variante dérivée du texte : objet « question », premier mot, longueur", v.subjectStyle === "question" && v.openingWord === "chez" && (v.length ?? 0) > 10, v);
    const rows: Record<string, unknown>[] = [];
    const writer = { from: () => ({ upsert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }) }) };
    const saved = await recordMessageVariant(writer, { messageId: "m1", userId: "u1", hookType: "recrutement", pain: "devis", demo: "factures", cta: "rdv-15-min", ...v });
    check("recordMessageVariant : une ligne par mail (upsert)", saved && rows[0].message_id === "m1" && rows[0].hook_type === "recrutement" && rows[0].subject_style === "question");
    check("ne lève jamais (table absente)", (await recordMessageVariant({ from: () => { throw new Error("x"); } }, { messageId: "m2" })) === false);

    const sent: SentVariant[] = Array.from({ length: 34 }, (_, i) => ({
      prospect_id: `p${i}`, sent_at: "2026-10-01T07:00:00Z", hook_type: i < 31 ? "recrutement" : "signal", length: 80,
    }));
    const inbound = [
      { prospect_id: "p0", received_at: "2026-10-02T09:00:00Z", from_email: "dg@a.fr", body: "Volontiers, appelez-moi.", category: "reponse" },
      { prospect_id: "p1", received_at: "2026-10-01T07:01:00Z", from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" },
      { prospect_id: "p2", received_at: "2026-10-02T09:00:00Z", from_email: "x@a.fr", body: "STOP" },
      { prospect_id: "p31", received_at: "2026-10-02T09:00:00Z", from_email: "y@a.fr", body: "Oui !" },
      { prospect_id: "p3", received_at: "2026-09-30T09:00:00Z", from_email: "z@a.fr", body: "réponse AVANT l'envoi" },
    ];
    check("issue : réponse / rebond / stop ; un mail reçu avant l'envoi ne compte pas", outcomeOf(sent[0], inbound) === "reply" && outcomeOf(sent[1], inbound) === "bounce" && outcomeOf(sent[2], inbound) === "stop" && outcomeOf(sent[3], inbound) === null);
    const stats = variantStats(sent, inbound);
    const recrutement = stats.hook_type.find((row) => row.value === "recrutement")!;
    const signal = stats.hook_type.find((row) => row.value === "signal")!;
    check("taux par valeur : recrutement 31 envois, 1 réponse, 1 rebond, 1 stop", recrutement.sends === 31 && recrutement.replies === 1 && recrutement.bounces === 1 && recrutement.stops === 1, recrutement);
    check("≥ 30 envois : significatif ; 3 envois : « pas significatif »", recrutement.significant && !signal.significant && signal.replyRate === 1 / 3);
    check("attribut absent : « non renseigné » ; longueur en tranches", stats.demo[0].value === "non renseigné" && lengthBand(80) === "60–90 mots");
  }

  console.log("\n5. Prochaine marche et ses conditions");
  {
    const now = new Date("2026-10-05T10:00:00Z");
    const ok = nextRampStep({ currentCap: 15, sentTotal: 120, inbound: [], dnsOk: { spf: true, dkim: true }, now });
    check("conditions réunies : palier suivant (25) prêt", ok.ready && ok.target === 25 && ok.current === 15);
    const bounce = nextRampStep({ currentCap: 15, sentTotal: 120, inbound: [{ from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification", received_at: "2026-10-03T10:00:00Z" }], dnsOk: { spf: true, dkim: true }, now });
    check("un rebond dur il y a 2 jours : pas prête", !bounce.ready && !bounce.conditions[0].ok);
    const stops = nextRampStep({ currentCap: 15, sentTotal: 100, inbound: [{ from_email: "a@b.fr", body: "STOP", received_at: "2026-09-01T10:00:00Z" }, { from_email: "c@b.fr", body: "stop", received_at: "2026-09-02T10:00:00Z" }], dnsOk: { spf: true, dkim: true }, now });
    check("2 % de « stop » : pas prête", !stops.ready && !stops.conditions[1].ok);
    check("peu d'envois (8) : pas prête, et dit pourquoi", !nextRampStep({ currentCap: 15, sentTotal: 8, inbound: [], dnsOk: { spf: true, dkim: true }, now }).conditions[3].ok);
  }


  console.log("\n6. Holdings résolues dans l'annuaire gratuit");
  {
    const { holdingFromDirectory, readHolding } = await import("../lib/enrichment/holding-free");
    const company = (over: Record<string, unknown>) => ({
      ok: true as const,
      data: { siren: "812345678", company_name: "LLED", leader_person: "Jean-Pierre Romeo", figures: { effectif_code: "03", revenue_eur: 120_000 }, ...over },
    });
    const profile = await holdingFromDirectory("812345678", (async () => company({})) as never);
    check("annuaire : dirigeant personne physique, plancher d'effectif, CA", profile?.people[0]?.name === "Jean-Pierre Romeo" && profile.headcount === 6 && profile.revenue_eur === 120_000, profile);
    check("homonyme renvoyé par l'annuaire (autre SIREN) : ignoré", (await holdingFromDirectory("812345678", (async () => company({ siren: "999999999" })) as never)) === null);

    let pappers = 0;
    const fakePappers = async () => ((pappers += 1), { siren: "812345678", name: null, people: [], revenue_eur: 80_000_000, headcount: 900 });
    const free = await readHolding("812345678", { resolve: (async () => company({})) as never, pappers: fakePappers });
    check("chiffres publiés : 0 crédit Pappers", free?.source === "annuaire" && free.pappersCalls === 0 && pappers === 0, free);
    const noFigures = await readHolding("812345679", { resolve: (async () => company({ siren: "812345679", figures: { effectif_code: "NN" } })) as never, pappers: fakePappers });
    check("aucun chiffre dans l'annuaire : Pappers (finances pour la règle d'exclusion), dirigeant gardé", noFigures?.source === "pappers" && noFigures.pappersCalls === 1 && pappers === 1 && noFigures.profile.people[0]?.name === "Jean-Pierre Romeo", noFigures);
  }
  console.log(failures === 0 ? "\nTous les tests du volume passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

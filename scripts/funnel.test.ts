/**
 * Tests de l'entonnoir « signaux d'abord » — fixtures, faux Supabase, faux
 * LLM, faux contact. Aucun réseau.
 *
 * Exécution : `npm run test:funnel`.
 */
import { FakeDb } from "./fake-supabase";
import { CASES, TODAY } from "./funnel-fixtures";
import { disqualify } from "../lib/funnel/eligible";
import { filterSignal } from "../lib/funnel/filter";
import { parseCapitalChange } from "../lib/funnel/harvest";
import { toIdentity } from "../lib/funnel/identify";
import { painForJob } from "../lib/funnel/pain-map";
import { settle, triage, TRIAGE_BATCH, type TriageAsk, type TriageInput } from "../lib/funnel/triage";
import { contactBadge, type DigDeps } from "../lib/funnel/dig";
import { DEFAULT_PREFS } from "../lib/funnel/settings";
import { runDigStage, runFilterStage, runTriageStage } from "../lib/funnel/stages";
import { countFunnel, insertHarvest } from "../lib/funnel/store";
import { newLeaderLabel, revenueLabel } from "../lib/funnel/view";
import { byKind } from "../lib/jobs/handlers";
import type { JobHandler, StepContext } from "../lib/jobs/runner";
import type { SignalCandidateRow } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const verdictOf = (key: keyof typeof CASES) => {
  const { signal, company } = CASES[key];
  return filterSignal(signal, company ? toIdentity(signal, company) : null, { now: TODAY });
};

(async () => {
  console.log("\n1. Cas réels du brief — filtre déterministe");
  {
    const artflex = verdictOf("artflex");
    check("ARTFLEX +959,76 € : rejeté, pas « Croissance »", artflex.status === "rejeté" && /marginale/.test(artflex.reason ?? ""), artflex.reason ?? "");
    check("ARTFLEX : le montant est cité", /959,76/.test(artflex.reason ?? ""), artflex.reason ?? "");
    const sunr = verdictOf("sunr");
    check("SUN'R +2 000 € : rejeté (bruit)", sunr.status === "rejeté", sunr.reason ?? "");
    // DEVESA est une boulangerie (10.71C) de 10-19 salariés : écartée depuis le
    // 30/09/2026 (boulangerie sous 20 salariés connus).
    const devesa = verdictOf("devesa");
    check("DEVESA : boulangerie de 10-19 salariés écartée", devesa.status === "rejeté" && /boulangerie de moins de 20/.test(devesa.reason ?? ""), devesa.reason ?? "");
    // La règle « purement juridique » se teste sur une entreprise hors cible B2C :
    // la même annonce SAS → EURL, portée par DBP MEDICAL (métallurgie, 10-19 sal.).
    const legal = filterSignal(CASES.devesa.signal, toIdentity(CASES.devesa.signal, CASES.dbp.company!), { now: TODAY });
    check("SAS→EURL : gardé mais purement juridique", legal.status === "filtré" && legal.legalOnly, legal.reason ?? "");
    // Poids plafonné à 0,2 avant le bonus de secteur : toujours sous un vrai signal de la même entreprise.
    const real = verdictOf("dbp");
    check("SAS→EURL : poids plus faible qu'un vrai signal", legal.weight < real.weight && legal.weight <= 0.35, `${legal.weight} vs ${real.weight}`);
    // DBP MEDICAL et GLOBAL 2F passent le FILTRE : l'annuaire ne porte ni
    // l'opposition à la prospection (il rend « O ») ni l'effectif zéro (il rend
    // « NN »). Les deux sont écartés à l'étage 4, sur les données Pappers —
    // vérifié en direct le 28/09/2026, voir le bloc « étage 4 ».
    const dbp = verdictOf("dbp");
    check("DBP MEDICAL : le filtre ne peut pas voir l'opposition", dbp.status === "filtré", dbp.reason ?? "");
    // GLOBAL 2F est un commerce de détail (NAF 47.25Z, boissons) sans effectif
    // déclaré : la nouvelle règle B2C l'écarte dès le filtre. Son effectif zéro,
    // lui, reste invisible à l'annuaire — c'est l'étage 4 qui le voit.
    const global = verdictOf("global2f");
    // Depuis le 30/09/2026, tout le commerce de détail (NAF 47) est exclu d'office.
    check("GLOBAL 2F : écarté, commerce de détail (NAF 47)", global.status === "rejeté" && /secteur exclu \(NAF 47/.test(global.reason ?? ""), global.reason ?? "");
    const adviso = verdictOf("adviso");
    check("ADVISO / Groupe Échelle : rejeté (client)", adviso.status === "rejeté" && /client/.test(adviso.reason ?? ""), adviso.reason ?? "");
    const delica = verdictOf("delica");
    check("DELICADESSERT « tribunal de commerce » : exclu", delica.status === "rejeté" && /tribunal de commerce/.test(delica.reason ?? ""), delica.reason ?? "");
    const growth = verdictOf("growth");
    check("témoin : +300 k€ (+150 %) reste une croissance", growth.status === "filtré" && growth.weight >= 0.7, `${growth.status} ${growth.weight}`);
  }

  console.log("\n2. Siège et établissement secondaire");
  {
    const champeil = verdictOf("champeil");
    check("CHAMPEIL : badge « décision au siège (BORDEAUX) »", champeil.badges.some((badge) => badge === "décision au siège (BORDEAUX)"), champeil.badges.join(","));
    const human = verdictOf("humanSight");
    check("HUMAN SIGHT : badge « décision au siège (PUTEAUX) »", human.badges.some((badge) => badge.includes("PUTEAUX")), human.badges.join(","));
    check("HUMAN SIGHT : offre ADV gardée (employeur confirmé)", human.status === "filtré", human.reason ?? "");
    const aggregated = filterSignal(
      { ...CASES.humanSight.signal, url: "https://www.hellowork.com/fr-fr/emplois/1.html" },
      { ...toIdentity(CASES.humanSight.signal, CASES.humanSight.company!), employerConfirmed: false },
      { now: TODAY },
    );
    check("offre d'agrégateur sans employeur confirmé : rejetée", aggregated.status === "rejeté" && /agrégateur/.test(aggregated.reason ?? ""));
    const vague = filterSignal({ ...CASES.humanSight.signal, text: "Serveur H/F", facts: { ...CASES.humanSight.signal.facts, jobTitle: "Serveur H/F" } }, toIdentity(CASES.humanSight.signal, CASES.humanSight.company!), { now: TODAY });
    check("intitulé non révélateur : rejeté", vague.status === "rejeté", vague.reason ?? "");
    check("secteur exclu par défaut (nettoyage 81.21Z)", filterSignal(CASES.growth.signal, toIdentity(CASES.growth.signal, { ...CASES.growth.company!, naf_code: "81.21Z" }), { now: TODAY }).status === "rejeté");
    check("introuvable à l'annuaire : rejeté", filterSignal(CASES.growth.signal, null).reason === "entreprise introuvable à l'annuaire");
  }

  console.log("\n3. Offre d'emploi → pain, et capital");
  {
    check("ADV → saisie commandes-devis", painForJob("Assistant(e) ADV H/F") === "saisie des commandes et des devis");
    check("technico-commercial → devis", painForJob("Technico-commercial itinérant") === "production des devis");
    check("aide-comptable → factures", painForJob("Aide-comptable") === "factures fournisseurs et rapprochement bancaire");
    check("ordonnanceur → planning", painForJob("Ordonnanceur atelier") === "planning");
    check("magasinier → stock", painForJob("Magasinier cariste") === "gestion du stock");
    check("serveur → rien", painForJob("Serveur") === null);
    const change = parseCapitalChange("Capital social porté de 10 000,00 € à 10 959,76 €.");
    check("capital avant/après lu dans le texte", change?.before === 10_000 && change?.after === 10_959.76, JSON.stringify(change));
    check("sans phrase de capital : null", parseCapitalChange("Modification du capital") === null);
  }

  console.log("\n4. Tri LLM (faux modèle)");
  {
    const make = (key: keyof typeof CASES, id: string): TriageInput => {
      const { signal, company } = CASES[key];
      const identity = toIdentity(signal, company!);
      return { id, signal, identity, verdict: filterSignal(signal, identity, { now: TODAY }) };
    };
    const legalSignal = CASES.devesa.signal;
    const legalIdentity = toIdentity(legalSignal, CASES.dbp.company!);
    const legalInput: TriageInput = { id: "d", signal: legalSignal, identity: legalIdentity, verdict: filterSignal(legalSignal, legalIdentity, { now: TODAY }) };
    const devesa = settle(legalInput, { id: "d", utilisable: true, sujet_est_l_entreprise: true, type: "autre", pain_probable: "x", accroche_possible: "y", score: 5, raison: "r" });
    check("modification juridique : score plafonné à 3, non retenu", devesa.triage?.score === 3 && !devesa.retained);
    const client = settle(make("growth", "c"), { id: "c", utilisable: true, sujet_est_l_entreprise: false, type: "croissance", pain_probable: "x", accroche_possible: "y", score: 5, raison: "parle de KLARSEN" });
    check("sujet ≠ l'entreprise (CHAMPEIL → KLARSEN) : rejeté", !client.retained && /client/.test(client.reason ?? ""));
    const job = settle(make("humanSight", "h"), { id: "h", utilisable: true, sujet_est_l_entreprise: true, type: "recrutement", pain_probable: "recrutement", accroche_possible: "Vous recrutez un ADV.", score: 4, raison: "r" });
    // La table dicte la nature du pain ; le modèle y ajoute le contexte propre à l'entreprise.
    check("offre : pain imposé par la table", job.triage?.pain_probable.startsWith("saisie des commandes et des devis") === true, job.triage?.pain_probable ?? "");
    check("offre : jamais le sujet de l'accroche", job.triage?.accroche_possible === "" && job.retained);
    check("item absent de la réponse : rejeté", settle(make("growth", "z"), undefined).reason === "tri indisponible pour ce signal");

    let calls = 0;
    const inputs = Array.from({ length: 45 }, (_, index) => make("growth", `g${index}`));
    const ask: TriageAsk = async (_system, user) => {
      calls += 1;
      if (calls === 1) return "pas du JSON";
      const ids = user.split("\n").map((line) => JSON.parse(line).id as string);
      return JSON.stringify({ items: ids.map((id) => ({ id, utilisable: true, sujet_est_l_entreprise: true, type: "croissance", pain_probable: `pain propre à ${id}`, accroche_possible: "a", score: 4, raison: "r" })) });
    };
    const out = await triage(ask, inputs);
    check(`lots de ${TRIAGE_BATCH} : 45 signaux → 3 lots (+1 reprise)`, calls === 4, String(calls));
    // Tous ont un verdict ; le quota de variété (45 signaux du même type) en écarte ensuite.
    check("tous triés", out.length === 45 && out.every((item) => item.triage !== null));
  }

  console.log("\n5. Entonnoir complet sur faux Supabase");
  {
    const fake = new FakeDb({ signal_candidates: [] });
    const db = fake as never;
    const signals = Object.values(CASES).map((item) => item.signal);
    const inserted = await insertHarvest(db, "u1", "run1", signals);
    check("moisson écrite", inserted === signals.length, String(inserted));
    check("dédoublonnage : relecture sans doublon", (await insertHarvest(db, "u1", "run1", signals)) === 0);

    const byName = new Map(Object.values(CASES).map((item) => [item.signal.companyName, item.company]));
    await runFilterStage(db, "u1", "run1", {
      prefs: DEFAULT_PREFS,
      lookup: async (signal) => ({ ok: true, company: byName.get(signal.companyName) ?? null }),
      known: new Set([CASES.sunr.signal.siren!]),
      now: TODAY,
    });
    const rows = () => fake.rows("signal_candidates") as unknown as SignalCandidateRow[];
    const byCompany = (name: string) => rows().find((row) => row.company_name === name)!;
    check("déjà connu : rejeté avant tout appel", byCompany("SUN'R GROUPE").motif_rejet?.startsWith("déjà en portefeuille") === true);
    check("chaque rejet porte un motif", rows().filter((row) => row.statut === "rejeté").every((row) => Boolean(row.motif_rejet)));

    const scores: Record<string, number> = { LOGIFLUX: 5, CHAMPEIL: 4, "HUMAN SIGHT": 4, "BOULANGERIE DEVESA": 5 };
    const ask: TriageAsk = async (_system, user) =>
      JSON.stringify({
        items: user.split("\n").map((line) => {
          const item = JSON.parse(line) as { id: string; entreprise: string };
          return { id: item.id, utilisable: true, sujet_est_l_entreprise: true, type: "croissance", pain_probable: `pain de ${item.entreprise}`, accroche_possible: "a", score: scores[item.entreprise] ?? 2, raison: "r" };
        }),
      });
    await runTriageStage(db, "u1", "run1", ask);
    const retained = rows().filter((row) => row.statut === "retenu").map((row) => row.company_name).sort();
    check("retenus : score ≥ 4 et sujet = l'entreprise", retained.join(",") === "CHAMPEIL,HUMAN SIGHT,LOGIFLUX", retained.join(","));

    const created: string[] = [];
    const deps: DigDeps = {
      enrich: async (candidate) => ({ ...candidate.base, key_figures: {}, signals: [], warnings: [] }),
      createProspect: async (company) => {
        created.push(company.company_name);
        return { id: `p-${company.company_name}` };
      },
      findContact: async (prospectId) =>
        prospectId === "p-LOGIFLUX"
          ? { email: "marie.dupont@logiflux.fr", email_type: "nominatif", confidence: 92, found_by: "hunter" }
          : prospectId === "p-CHAMPEIL"
            ? { email: "contact@champeil.fr", email_type: "generique", confidence: 60, found_by: "site" }
            : { confidence: 0, found_by: "aucun" },
      brief: async () => undefined,
    };
    const first = await runDigStage(db, "u1", "run1", { deps, limit: 15, perStep: 2 });
    check("creusage par score décroissant, 2 par étape", first.dug === 2 && created[0] === "LOGIFLUX", created.join(","));
    await runDigStage(db, "u1", "run1", { deps, limit: 15, perStep: 2 });
    const again = await runDigStage(db, "u1", "run1", { deps, limit: 15, perStep: 2 });
    check("idempotent : rien de creusé deux fois", again.dug === 0 && created.length === 3, created.join(","));
    check("email nominatif → Prospects prêts", byCompany("LOGIFLUX").publication === "pret");
    check("email générique → prêt, badge 🟡", byCompany("CHAMPEIL").publication === "pret" && (byCompany("CHAMPEIL").contact as { badge?: string }).badge === "generique");
    check("sans email → À compléter", byCompany("HUMAN SIGHT").publication === "a_completer");
    check("badge contact « aucun »", contactBadge({ confidence: 0, found_by: "aucun" }) === "aucun");

    const counts = countFunnel(rows());
    check("bandeau : bruts → filtrés → retenus → contactables", counts.bruts === 10 && counts.retenus === 3 && counts.creuses === 3 && counts.contactables === 2, JSON.stringify(counts));
    const shown = rows().filter((row) => row.publication === "pret");
    check("objectif ≥ 60 % des fiches affichées = signal daté + email", shown.length > 0 && shown.every((row) => row.date_signal && (row.contact as { email?: string }).email));

    const limited = new FakeDb({ signal_candidates: rows().map((row) => ({ ...row, statut: row.statut === "creusé" ? "retenu" : row.statut, publication: null, prospect_id: null })) });
    const capped = await runDigStage(limited as never, "u1", "run1", { deps, limit: 1, perStep: 4 });
    check("plafond N respecté", capped.dug === 1);
  }

  console.log("\n6. Affichage des cartes");
  {
    const now = new Date("2026-09-27");
    check("CA à 0 : « non publié »", revenueLabel(0, 2024, now) === "CA non publié");
    check("CA absent : « non publié »", revenueLabel(null, null, now) === "CA non publié");
    check("CA récent : année affichée", revenueLabel(3_200_000, 2024, now) === "CA 2024 : 3,2 M€", String(revenueLabel(3_200_000, 2024, now)));
    check("CA de plus de 3 ans : masqué", revenueLabel(3_200_000, 2021, now) === null);
    check("nouvelle direction : le NOUVEAU dirigeant", newLeaderLabel(CASES.dbp.signal.facts) === "Claire MARTIN, présidente");
    check("sans changement de dirigeant : rien", newLeaderLabel(CASES.artflex.signal.facts) === null);
  }

  console.log("\n7. Aiguillage du job search_signals");
  {
    const calls: string[] = [];
    const handler = (name: string, steps: number): JobHandler => ({
      steps: Array.from({ length: steps }, (_, index) => async () => {
        calls.push(`${name}${index}`);
        return {};
      }),
    });
    const routed = byKind(handler("scan", 3), { funnel: handler("entonnoir", 5) });
    const ctx = (kind?: string) => ({ job: { params: kind ? { kind } : {} } }) as unknown as StepContext;
    const run = async (kind?: string) => {
      for (const step of routed.steps) if ((await step(ctx(kind))).done) break;
    };
    await run();
    check("sans kind : l'ancien scan, 3 étapes puis fin", calls.join(",") === "scan0,scan1,scan2", calls.join(","));
    calls.length = 0;
    await run("funnel");
    check("kind funnel : les 5 étapes de l'entonnoir", calls.join(",") === "entonnoir0,entonnoir1,entonnoir2,entonnoir3,entonnoir4", calls.join(","));
  }

  console.log("\n étage 4 — ce qu'on refuse de publier (chiffres réels Pappers)");
  {
    const facts = (over: Partial<Parameters<typeof disqualify>[0]>) =>
      disqualify({ refusesProspecting: false, noStaff: false, capitalEur: null, equityEur: null, ...over });

    // DBP MEDICAL (844687566), releve le 28/09/2026 : l'annuaire rend
    // statut_diffusion « O », Pappers rend opposition_utilisation_commerciale
    // « true ». C'est Pappers qui fait foi.
    check(
      "opposition à la prospection : écartée",
      /opposition à la prospection/.test(facts({ refusesProspecting: true, capitalEur: 50_000, equityEur: 305_926 })?.reason ?? ""),
    );
    // GLOBAL 2F (833040736) : « 0 salarie », effectif_max 0, entreprise_employeuse false.
    check("aucun salarié : écarté", /aucun salarié/.test(facts({ noStaff: true, capitalEur: 6_000 })?.reason ?? ""));
    // 901509364, releve le 28/09/2026 : capital 5 085,75 €, capitaux propres 2 376 €.
    check(
      "capitaux propres sous la moitié du capital : écartés",
      /capitaux propres/.test(facts({ capitalEur: 5_085.75, equityEur: 2_376 })?.reason ?? ""),
    );
    check("capitaux propres au-dessus : gardés", facts({ capitalEur: 50_000, equityEur: 305_926 }) === null);
    // GLOBAL 2F n'a AUCUN compte publie : la regle des capitaux propres ne peut
    // pas s'appliquer, et l'absence de chiffre n'est pas un mauvais chiffre.
    check("comptes confidentiels : la règle ne s'applique pas", facts({ capitalEur: 6_000, equityEur: null }) === null);
    check("capital inconnu : la règle ne s'applique pas", facts({ capitalEur: null, equityEur: 100 }) === null);
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

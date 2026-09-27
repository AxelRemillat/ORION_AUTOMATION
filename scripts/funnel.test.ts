/**
 * Tests de l'entonnoir « signaux d'abord » — fixtures, faux Supabase, faux
 * LLM, faux contact. Aucun réseau.
 *
 * Exécution : `npm run test:funnel`.
 */
import { FakeDb } from "./fake-supabase";
import { CASES, TODAY } from "./funnel-fixtures";
import { filterSignal } from "../lib/funnel/filter";
import { parseCapitalChange } from "../lib/funnel/harvest";
import { toIdentity } from "../lib/funnel/identify";
import { painForJob } from "../lib/funnel/pain-map";
import { settle, triage, TRIAGE_BATCH, type TriageAsk, type TriageInput } from "../lib/funnel/triage";
import { contactBadge, type DigDeps } from "../lib/funnel/dig";
import { DEFAULT_PREFS } from "../lib/funnel/settings";
import { runDigStage, runFilterStage, runTriageStage } from "../lib/funnel/stages";
import { countFunnel, insertHarvest } from "../lib/funnel/store";
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
    const devesa = verdictOf("devesa");
    check("DEVESA SAS→EURL : gardé mais purement juridique", devesa.status === "filtré" && devesa.legalOnly);
    check("DEVESA : poids faible", devesa.weight <= 0.2, String(devesa.weight));
    const dbp = verdictOf("dbp");
    check("DBP MEDICAL : exclu (opposition à la prospection)", dbp.status === "rejeté" && /opposée à la prospection/.test(dbp.reason ?? ""), dbp.reason ?? "");
    const global = verdictOf("global2f");
    check("GLOBAL 2F : exclu (0 salarié, motif supposé)", global.status === "rejeté" && /0 salarié/.test(global.reason ?? ""), global.reason ?? "");
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
    check("CHAMPEIL : badge « décision au siège (Bordeaux) »", champeil.badges.some((badge) => badge === "décision au siège (Bordeaux)"), champeil.badges.join(","));
    const human = verdictOf("humanSight");
    check("HUMAN SIGHT : badge « décision au siège (Puteaux) »", human.badges.some((badge) => badge.includes("Puteaux")), human.badges.join(","));
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
    const devesa = settle(make("devesa", "d"), { id: "d", utilisable: true, sujet_est_l_entreprise: true, type: "autre", pain_probable: "x", accroche_possible: "y", score: 5, raison: "r" });
    check("DEVESA : score plafonné à 3, non retenu", devesa.triage?.score === 3 && !devesa.retained);
    const client = settle(make("growth", "c"), { id: "c", utilisable: true, sujet_est_l_entreprise: false, type: "croissance", pain_probable: "x", accroche_possible: "y", score: 5, raison: "parle de KLARSEN" });
    check("sujet ≠ l'entreprise (CHAMPEIL → KLARSEN) : rejeté", !client.retained && /client/.test(client.reason ?? ""));
    const job = settle(make("humanSight", "h"), { id: "h", utilisable: true, sujet_est_l_entreprise: true, type: "recrutement", pain_probable: "recrutement", accroche_possible: "Vous recrutez un ADV.", score: 4, raison: "r" });
    check("offre : pain imposé par la table", job.triage?.pain_probable === "saisie des commandes et des devis");
    check("offre : jamais le sujet de l'accroche", job.triage?.accroche_possible === "" && job.retained);
    check("item absent de la réponse : rejeté", settle(make("growth", "z"), undefined).reason === "tri indisponible pour ce signal");

    let calls = 0;
    const inputs = Array.from({ length: 45 }, (_, index) => make("growth", `g${index}`));
    const ask: TriageAsk = async (_system, user) => {
      calls += 1;
      if (calls === 1) return "pas du JSON";
      const ids = user.split("\n").map((line) => JSON.parse(line).id as string);
      return JSON.stringify({ items: ids.map((id) => ({ id, utilisable: true, sujet_est_l_entreprise: true, type: "croissance", pain_probable: "p", accroche_possible: "a", score: 4, raison: "r" })) });
    };
    const out = await triage(ask, inputs);
    check(`lots de ${TRIAGE_BATCH} : 45 signaux → 3 lots (+1 reprise)`, calls === 4, String(calls));
    check("tous triés", out.length === 45 && out.every((item) => item.retained));
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
      lookup: async (signal) => byName.get(signal.companyName) ?? null,
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
          return { id: item.id, utilisable: true, sujet_est_l_entreprise: true, type: "croissance", pain_probable: "p", accroche_possible: "a", score: scores[item.entreprise] ?? 2, raison: "r" };
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

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

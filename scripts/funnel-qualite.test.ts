/**
 * Qualité de l'entonnoir — cas du run réel du 30/09/2026 (69, 38, 42, 01, 73, 74 · 14 j) :
 * 13 retenus dont 11 « Reprise d'un fonds de commerce » de micro-commerces B2C,
 * 0 contactable, 2 390 bruts jamais examinés, 12 fiches « en attente de creusage ».
 * Aucun réseau : identités construites à la main, faux Supabase, faux LLM.
 *
 * Exécution : `npm run test:funnel-qualite`.
 */
import { FakeDb } from "./fake-supabase";
import { bodaccRank, examinationPlan } from "../lib/funnel/budget";
import { disqualify } from "../lib/funnel/eligible";
import { offTargetReason } from "../lib/funnel/off-target";
import { extractPhones } from "../lib/contact-finder/extract";
import { digOne, type DigDeps } from "../lib/funnel/dig";
import { DEFAULT_EXCLUDED_SECTORS, filterSignal } from "../lib/funnel/filter";
import { applyTypeQuota, MAX_SHARE_PER_TYPE, signalFamily } from "../lib/funnel/quota";
import { DEFAULT_PREFS } from "../lib/funnel/settings";
import { GOVERNANCE_ONLY, MAX_LOOKUPS, runDigStage, runFilterStage } from "../lib/funnel/stages";
import { NOT_EXAMINED, yieldBySource } from "../lib/funnel/store";
import { capGenericPains, GENERIC_PAIN_MAX_SCORE, onePerCompany, settle, userPrompt, type TriageInput, type TriageOutcome } from "../lib/funnel/triage";
import type { HarvestedSignal, Identity, Triage } from "../lib/funnel/types";
import type { SignalCandidateRow } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date("2026-09-30T12:00:00Z");

let counter = 0;
function signal(label: string, over: Partial<HarvestedSignal> & { jobTitle?: string } = {}): HarvestedSignal {
  counter += 1;
  const source = over.source ?? "bodacc";
  return {
    source,
    date: over.date ?? "2026-09-25",
    text: over.text ?? label,
    url: over.url ?? `https://www.bodacc.fr/annonce/${counter}`,
    siren: over.siren ?? String(800000000 + counter),
    companyName: over.companyName ?? `SOCIETE ${counter}`,
    facts: {
      label: source === "france-travail" ? "Recrutement" : label,
      signalType: source === "france-travail" ? "recrutement" : "croissance",
      strength: "fort",
      jobTitle: over.jobTitle ?? null,
    },
    hash: `h${counter}`,
  };
}

function identity(over: Partial<Identity>): Identity {
  return {
    siren: "800000000",
    name: "SOCIETE",
    naf: "46.69B",
    effectifCode: "12",
    diffusion: "O",
    adminState: "A",
    createdOn: "2010-01-01",
    legalCode: "5710",
    isBranch: false,
    headOfficeCity: null,
    city: "Lyon",
    revenue: 3_000_000,
    revenueYear: 2025,
    employerConfirmed: true,
    ...over,
  };
}

const REPRISE = "Reprise d'un fonds de commerce";
const verdict = (s: HarvestedSignal, i: Identity) => filterSignal(s, i, { now: NOW });

(async () => {
  console.log("\n1. Effectif non déclaré : micro-structure probable");
  {
    const kebab = verdict(signal(REPRISE), identity({ name: "KEBAB DES ALPES", naf: "00.00Z", effectifCode: "NN", createdOn: "2026-06-23", revenue: null }));
    check("KEBAB DES ALPES (NN, créé en juin 2026) : rejeté", kebab.status === "rejeté" && /micro-structure probable/.test(kebab.reason ?? ""), kebab.reason ?? "");
    const old = verdict(signal("Modification du capital"), identity({ effectifCode: "NN", createdOn: "1990-01-01", revenue: null }));
    check("NN, ancienne, sans CA publié : rejetée", old.status === "rejeté" && /aucun chiffre d'affaires publié/.test(old.reason ?? ""), old.reason ?? "");
    const withRevenue = verdict(signal("Nomination d'un directeur général"), identity({ effectifCode: "NN", createdOn: "2005-01-01", revenue: 8_000_000 }));
    check("NN, ancienne, CA publié : gardée", withRevenue.status === "filtré", withRevenue.reason ?? "");
    const offer = verdict(
      signal("Recrutement", { source: "france-travail", url: "https://candidat.francetravail.fr/offres/1", jobTitle: "Assistant(e) ADV H/F", text: "Assistant(e) ADV H/F" }),
      identity({ effectifCode: "NN", createdOn: "2026-01-10", revenue: null }),
    );
    check("NN mais offre d'emploi révélatrice : gardée (ils embauchent)", offer.status === "filtré", offer.reason ?? "");
  }

  console.log("\n2. Exclusion B2C par NAF, quelle que soit la taille");
  {
    for (const code of ["47", "55", "56", "96", "93", "88", "862", "869"]) {
      check(`défaut : ${code} exclu`, (DEFAULT_EXCLUDED_SECTORS as readonly string[]).includes(code));
    }
    const restaurant = verdict(signal("Nomination d'un directeur"), identity({ naf: "56.30Z", effectifCode: "21" }));
    check("restaurant de 50-99 salariés : exclu quand même", restaurant.status === "rejeté" && /secteur exclu/.test(restaurant.reason ?? ""), restaurant.reason ?? "");
    const garderie = verdict(signal("Yoan LEBOURG devient gérant"), identity({ name: "GARDERIE PITCHOUN", naf: "88.91A", effectifCode: "11" }));
    check("GARDERIE PITCHOUN (88.91A) : exclue", garderie.status === "rejeté" && /secteur exclu/.test(garderie.reason ?? ""), garderie.reason ?? "");
    const cabinet = verdict(signal("Nomination"), identity({ naf: "86.23Z", effectifCode: "11" }));
    check("cabinet dentaire (86.23Z) : exclu", cabinet.status === "rejeté", cabinet.reason ?? "");
    const loisirs = verdict(signal("Nomination"), identity({ naf: "93.19Z", effectifCode: "NN", revenue: 1_000_000 }));
    check("loisirs (93.19Z) : exclu", loisirs.status === "rejeté" && /secteur exclu/.test(loisirs.reason ?? ""), loisirs.reason ?? "");
    const bonnin = verdict(
      signal("Recrutement", { source: "france-travail", url: "https://candidat.francetravail.fr/offres/2", jobTitle: "Assistant(e) ADV H/F", text: "Assistant(e) ADV H/F" }),
      identity({ name: "SARL BONNIN FRERES", naf: "10.71C", effectifCode: "12" }),
    );
    check("BONNIN FRERES (10.71C, 20-49 sal.) : gardée", bonnin.status === "filtré", bonnin.reason ?? "");
    const smallBakery = verdict(signal("Nomination"), identity({ naf: "10.71C", effectifCode: "11" }));
    check("boulangerie 10-19 sal. : écartée", smallBakery.status === "rejeté" && /boulangerie de moins de 20/.test(smallBakery.reason ?? ""), smallBakery.reason ?? "");
  }

  console.log("\n3. Reprise de fonds de commerce : seulement par une entreprise établie");
  {
    const established = verdict(signal(REPRISE), identity({ effectifCode: "12", createdOn: "2012-05-01" }));
    check("repreneur de 20-49 sal., 14 ans : gardé", established.status === "filtré", established.reason ?? "");
    const young = verdict(signal(REPRISE), identity({ effectifCode: "11", createdOn: "2025-06-01" }));
    check("repreneur de 15 mois : micro-reprise", young.status === "rejeté" && /micro-reprise/.test(young.reason ?? ""), young.reason ?? "");
    const small = verdict(signal(REPRISE), identity({ effectifCode: "03", createdOn: "2001-01-01" }));
    check("repreneur de 6-9 sal. : rejeté", small.status === "rejeté", small.reason ?? "");
  }

  console.log("\n4. Tri LLM recalibré");
  {
    const input: TriageInput = {
      id: "x",
      signal: signal("Nomination"),
      identity: identity({ naf: "46.69B", effectifCode: "12", createdOn: "2016-03-01", revenue: 4_200_000, revenueYear: 2025 }),
      verdict: { status: "filtré", reason: null, weight: 0.5, badges: [], legalOnly: false },
    };
    const line = JSON.parse(userPrompt([input], NOW)) as Record<string, unknown>;
    check("le modèle reçoit NAF, effectif lisible, âge et CA", line.naf === "46.69B" && line.effectif === "20 à 49 salariés" && line.age_ans === 10.5 && /4200000 € \(2025\)/.test(String(line.ca)), JSON.stringify(line));
    const unknown = JSON.parse(userPrompt([{ ...input, identity: identity({ effectifCode: "NN", revenue: null }) }], NOW)) as Record<string, unknown>;
    check("effectif et CA inconnus : dits comme tels", unknown.effectif === "non déclaré" && unknown.ca === "non publié", JSON.stringify(unknown));

    const triage = (score: number, pain: string): Triage => ({ utilisable: true, sujet_est_l_entreprise: true, type: "reprise", pain_probable: pain, accroche_possible: "a", score, raison: "r" });
    const outcomes: TriageOutcome[] = [
      { id: "a", triage: triage(4, "Suivi des commandes fournisseurs et des factures."), retained: true, reason: null },
      { id: "b", triage: triage(4, "suivi des commandes  fournisseurs et des factures"), retained: true, reason: null },
      { id: "c", triage: triage(5, "Chiffrage des demandes de prix en robinetterie industrielle"), retained: true, reason: null },
    ];
    const capped = capGenericPains(outcomes);
    check("même pain mot pour mot : plafonné à 3, non retenu", capped[0].triage?.score === GENERIC_PAIN_MAX_SCORE && !capped[0].retained && !capped[1].retained, JSON.stringify(capped.map((o) => o.triage?.score)));
    check("pain spécifique : intact", capped[2].retained && capped[2].triage?.score === 5);

    const offer = settle(
      { ...input, signal: signal("Recrutement", { source: "france-travail", jobTitle: "Assistant(e) ADV H/F", text: "Assistant(e) ADV H/F" }) },
      { id: "x", utilisable: true, sujet_est_l_entreprise: true, type: "recrutement", pain_probable: "ressaisie des commandes de robinetterie reçues par email", accroche_possible: "", score: 5, raison: "r" },
    );
    check("offre : pain = table + contexte de l'entreprise", offer.triage?.pain_probable === "saisie des commandes et des devis : ressaisie des commandes de robinetterie reçues par email", offer.triage?.pain_probable ?? "");
  }

  console.log("\n5. Quota de variété, sur la liste finale");
  {
    const reprise = signal(REPRISE);
    const direction = signal("Jean DUPONT devient président");
    const capital = signal("Modification du capital");
    check("familles : reprise, direction, capital", signalFamily(reprise) === "reprise de fonds" && signalFamily(direction) === "direction" && signalFamily(capital) === "capital");
    // Le 30/09 : 11 reprises + 2 autres retenus, aucun remplaçant.
    const families = new Map<string, string>();
    const outcome = (id: string, family: string, score: number, retained = true): TriageOutcome => {
      families.set(id, family);
      return { id, triage: { utilisable: true, sujet_est_l_entreprise: true, type: "x", pain_probable: `p${id}`, accroche_possible: "", score, raison: "r" }, retained, reason: retained ? null : "score" };
    };
    const list = [
      ...Array.from({ length: 11 }, (_, i) => outcome(`r${i}`, "reprise de fonds", 4)),
      outcome("d1", "direction", 4),
      outcome("c1", "capital", 4),
    ];
    const out = applyTypeQuota(list, (item) => families.get(item.id)!);
    const kept = out.filter((item) => item.retained);
    const reprises = kept.filter((item) => families.get(item.id) === "reprise de fonds").length;
    check(`11/13 reprises → au plus ${MAX_SHARE_PER_TYPE * 100} % des retenus finaux`, reprises / kept.length <= MAX_SHARE_PER_TYPE, `${reprises}/${kept.length}`);
    check("les écartés disent pourquoi", out.filter((item) => !item.retained && families.get(item.id) === "reprise de fonds").every((item) => /quota de variété/.test(item.reason ?? "")));

    // Promotion : une note, jamais un motif (sinon le creusage la saute).
    const withPromo = applyTypeQuota(
      [...Array.from({ length: 5 }, (_, i) => outcome(`q${i}`, "reprise de fonds", 4)), outcome("p1", "direction", 3, false), outcome("p2", "capital", 3, false)],
      (item) => families.get(item.id)!,
    );
    const promoted = withPromo.filter((item) => item.note);
    check("promu : retenu, note renseignée, aucun motif", promoted.length > 0 && promoted.every((item) => item.retained && item.reason === null), JSON.stringify(promoted));

    // Un seul type : il garde au moins une fiche.
    const single = applyTypeQuota(Array.from({ length: 6 }, (_, i) => outcome(`s${i}`, "direction", 4)), (item) => families.get(item.id)!);
    check("un seul type : au moins une fiche gardée", single.filter((item) => item.retained).length >= 1);
  }

  console.log("\n6. Sources : quota dans le plafond, France Travail d'abord");
  {
    const rows = [
      ...Array.from({ length: 2515 }, (_, i) => ({ id: `b${i}`, source: "bodacc", date: "2026-09-20", strength: 3 })),
      ...Array.from({ length: 138 }, (_, i) => ({ id: `f${i}`, source: "france-travail", date: "2026-09-21", strength: 1 })),
    ];
    const plan = examinationPlan(rows, MAX_LOOKUPS);
    // Budget de 600 : TOUTES les offres (138), BODACC plafonné à 20 % (120).
    check("run du 30/09 : toutes les offres, BODACC à 20 %", plan.bySource["france-travail"] === 138 && plan.bySource.bodacc === 120, JSON.stringify(plan.bySource));
    check("France Travail passe en premier", plan.examine[0].source === "france-travail");
    check("le reste est marqué, pas laissé brut", plan.skip.length === rows.length - plan.examine.length && plan.examine.length === 258);
    const fewOffers = examinationPlan([...rows.slice(0, 2515), ...rows.slice(2515, 2515 + 40)], MAX_LOOKUPS);
    check("peu d'offres : toutes prises, BODACC ne comble pas (20 % max)", fewOffers.bySource["france-travail"] === 40 && fewOffers.bySource.bodacc === 120, JSON.stringify(fewOffers.bySource));

    // Étage 2 sur un faux Supabase : les hors-budget sont « non examiné », les autres filtrés.
    const now = "2026-09-30T10:00:00Z";
    const row = (id: string, source: string, jobTitle: string | null = null): Record<string, unknown> => ({
      id, user_id: "u1", run_id: "run1", source, statut: "brut", motif_rejet: null, date_signal: "2026-09-25", texte_brut: jobTitle ?? "Modification du capital",
      url_source: null, siren: `7${id.padStart(8, "0")}`, company_name: `CO ${id}`, hash: id,
      facts: { label: jobTitle ? "Recrutement" : "Modification du capital", strength: "fort", signalType: "croissance", jobTitle },
      badges: [], created_at: now, updated_at: now,
    });
    const fake = new FakeDb({
      signal_candidates: [
        ...Array.from({ length: 30 }, (_, i) => row(`b${i}`, "bodacc")),
        ...Array.from({ length: 10 }, (_, i) => row(`f${i}`, "france-travail", "Assistant(e) ADV H/F")),
        // Intitulés sans pain : écartés gratuitement, hors budget.
        ...Array.from({ length: 5 }, (_, i) => row(`x${i}`, "france-travail", "Ingénieur automaticien (H/F)")),
      ],
    });
    const lookedUp: string[] = [];
    await runFilterStage(fake as never, "u1", "run1", {
      prefs: DEFAULT_PREFS,
      lookup: async (s) => {
        lookedUp.push(s.source);
        return { ok: true, company: null };
      },
      known: new Set(),
      now: NOW,
      cap: 12,
    });
    const stored = fake.rows("signal_candidates") as unknown as SignalCandidateRow[];
    check("plafond respecté : 12 identités", lookedUp.length === 12, String(lookedUp.length));
    // Plafond de 12 : BODACC ≤ 20 % (2), France Travail tout le reste (ses 10 offres).
    check("France Travail : toutes ses offres, lues en premier ; BODACC 2", lookedUp.filter((s) => s === "france-travail").length === 10 && lookedUp.filter((s) => s === "bodacc").length === 2 && lookedUp[0] === "france-travail", lookedUp.join(","));
    check("hors budget : « non examiné », plus aucun brut", stored.filter((r) => r.motif_rejet?.startsWith(NOT_EXAMINED)).length === 28 && !stored.some((r) => r.statut === "brut"));
    check(
      "intitulé sans pain : écarté sans identité, hors budget",
      stored.filter((r) => r.id.startsWith("x")).every((r) => r.statut === "rejeté" && /aucun pain/.test(r.motif_rejet ?? "")) && lookedUp.length === 12,
    );
    const yields = yieldBySource(stored);
    const ft = yields.find((y) => y.source === "france-travail")!;
    check("rendement par source : bruts et examinés", ft.bruts === 15 && ft.examines === 15, JSON.stringify(yields));
  }

  console.log("\n7. Creusage : issue explicite, reprise au run suivant");
  {
    const now = "2026-09-30T10:00:00Z";
    const base = { company_name: "X", siren: "123456789", naf_code: "46.69B", figures: {} };
    const retained = (id: string, run: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
      id, user_id: "u1", run_id: run, source: "bodacc", statut: "retenu", motif_rejet: null, date_signal: "2026-09-25", texte_brut: "Nomination",
      url_source: null, siren: "123456789", company_name: id, hash: id, score: 4, weight: 0.5, badges: [],
      facts: { label: "Jean DUPONT devient président", strength: "fort", signalType: "direction" },
      identity: { ...identity({ name: id }), base },
      triage: { utilisable: true, sujet_est_l_entreprise: true, type: "direction", pain_probable: `p ${id}`, accroche_possible: "", score: 4, raison: "r" },
      created_at: now, updated_at: now, ...over,
    });
    const fake = new FakeDb({
      signal_candidates: [
        retained("OPPOSE", "run2"),
        retained("PROMU", "run2", { badges: ["retenu pour la variété : type « direction » sous-représenté"] }),
        retained("ANCIEN_OK", "run1"),
        retained("ANCIEN_B2C", "run1", { identity: { ...identity({ name: "ANCIEN_B2C", naf: "56.30Z" }), base } }),
        retained("ERREUR_PASSEE", "run1", { motif_rejet: "creusage à reprendre : délai dépassé" }),
      ],
      prospects: [],
    });
    const deps: DigDeps = {
      enrich: async (c) => ({ ...c.base, key_figures: c.id === "OPPOSE" ? { refuses_prospecting: true, pappers_read: true } : { pappers_read: true }, signals: [], warnings: [] }),
      createProspect: async (_company, c) => ({ id: `p-${c.id}` }),
      findContact: async () => ({ email: "contact@x.fr", email_type: "generique", confidence: 60, found_by: "site" }),
      brief: async () => undefined,
    };
    await runDigStage(fake as never, "u1", "run2", { deps, limit: 15, perStep: 10, prefs: DEFAULT_PREFS, now: NOW });
    const byId = new Map((fake.rows("signal_candidates") as unknown as SignalCandidateRow[]).map((r) => [r.id, r]));
    check("écarté au creusage : « rejeté », pas « en attente »", byId.get("OPPOSE")?.statut === "rejeté" && /^creusage : opposition/.test(byId.get("OPPOSE")?.motif_rejet ?? ""), JSON.stringify(byId.get("OPPOSE")?.motif_rejet));
    check("promu pour la variété : bien creusé", byId.get("PROMU")?.statut === "creusé");
    check("retenu d'un run précédent : repris et creusé dans ce run", byId.get("ANCIEN_OK")?.statut === "creusé" && byId.get("ANCIEN_OK")?.run_id === "run2");
    check("retenu d'un run précédent devenu hors cible : re-filtré", byId.get("ANCIEN_B2C")?.statut === "rejeté" && /^re-filtré/.test(byId.get("ANCIEN_B2C")?.motif_rejet ?? ""), byId.get("ANCIEN_B2C")?.motif_rejet ?? "");
    check("erreur passagère d'un run précédent : reprise", byId.get("ERREUR_PASSEE")?.statut === "creusé");
  }

  console.log("\n8. Cible PME 10-249 salariés, groupes, action sociale, gouvernance");
  {
    const tereva = verdict(signal("Recrutement", { source: "france-travail", jobTitle: "Technico-commercial sédentaire H/F", text: "Technico-commercial sédentaire H/F" }), identity({ name: "TEREVA", naf: "46.74B", effectifCode: "42" }));
    check("TÉRÉVA (1 000-1 999 sal.) : trop grande structure au filtre", tereva.status === "rejeté" && /trop grande structure/.test(tereva.reason ?? ""), tereva.reason ?? "");
    const mid = verdict(signal("Nomination"), identity({ effectifCode: "31" }));
    check("200-249 salariés : dans la cible", mid.status === "filtré", mid.reason ?? "");
    const aide = verdict(signal("Recrutement", { source: "france-travail", jobTitle: "Gestionnaire de planification (H/F)", text: "Gestionnaire de planification (H/F)" }), identity({ name: "AIN DOMICILE SERVICES", naf: "88.10A", effectifCode: "31" }));
    check("AIN DOMICILE (88.10A) : action sociale exclue", aide.status === "rejeté" && /secteur exclu/.test(aide.reason ?? ""), aide.reason ?? "");

    const base = { refusesProspecting: false, noStaff: false, capitalEur: null, equityEur: null };
    check("creusage : 1 200 salariés → trop grande structure", /trop grande structure \(1200/.test(disqualify({ ...base, headcount: 1200 })?.reason ?? ""));
    check("creusage : filiale d'un groupe étranger (HÖRMANN)", /groupe étranger/.test(disqualify({ ...base, headcount: 150, foreignParent: true })?.reason ?? ""));
    check("creusage : filiale d'un groupe de plus de 250 salariés", /plus de 250/.test(disqualify({ ...base, headcount: 80, largeGroup: true })?.reason ?? ""));
    check("creusage : PME autonome de 150 salariés → gardée", disqualify({ ...base, headcount: 150 }) === null);
    check(
      "fiche existante filiale étrangère : « hors cible »",
      /groupe étranger/.test(offTargetReason({ key_figures: { parent_foreign: true, headcount: 150, naf_code: "46.73A" }, size_range: null }) ?? ""),
    );

    check("BODACC : établissement avant capital avant nomination", bodaccRank("Création d'établissement") < bodaccRank("Modification du capital") && bodaccRank("Modification du capital") < bodaccRank("Jean DUPONT devient président"));

    const now = "2026-09-30T10:00:00Z";
    const notice = (id: string, label: string): Record<string, unknown> => ({
      id, user_id: "u1", run_id: "run9", source: "bodacc", statut: "brut", motif_rejet: null, date_signal: "2026-09-25", texte_brut: label,
      url_source: null, siren: `6${id.padStart(8, "0")}`, company_name: `CO ${id}`, hash: `g${id}`, facts: { label, strength: "fort", signalType: "direction" },
      badges: [], created_at: now, updated_at: now,
    });
    const fake = new FakeDb({ signal_candidates: [notice("1", "Jean DUPONT devient commissaire aux comptes titulaire"), notice("2", "Marie DURAND devient administrateur"), notice("3", "Paul MARTIN devient président")] });
    const looked: string[] = [];
    await runFilterStage(fake as never, "u1", "run9", {
      prefs: DEFAULT_PREFS,
      lookup: async (s) => {
        looked.push(s.companyName);
        return { ok: true, company: null };
      },
      known: new Set(),
      now: NOW,
    });
    const rows = fake.rows("signal_candidates") as unknown as SignalCandidateRow[];
    check("gouvernance (CAC, administrateur) : écartée sans identité", looked.join() === "CO 3" && rows.filter((r) => r.motif_rejet === GOVERNANCE_ONLY).length === 2, looked.join());
  }

  console.log("\n8 bis. Sans Pappers, rien n'est publié (crédits épuisés le 30/09/2026)");
  {
    const created: string[] = [];
    const outcome = await digOne(
      {
        enrich: async (c) => ({ ...c.base, key_figures: {}, signals: [], warnings: [{ source: "pappers", message: "HTTP 401 Unauthorized" }] }),
        createProspect: async (company) => {
          created.push(company.company_name);
          return { id: "p" };
        },
        findContact: async () => ({ confidence: 0, found_by: "aucun" }),
        brief: async () => undefined,
      },
      {
        id: "c1",
        signal: signal("Recrutement", { source: "france-travail", jobTitle: "Assistant(e) ADV H/F", text: "Assistant(e) ADV H/F" }),
        base: { company_name: "X", siren: "123456789", naf_code: "46.69B", figures: {} } as never,
        triage: { utilisable: true, sujet_est_l_entreprise: true, type: "recrutement", pain_probable: "p", accroche_possible: "", score: 5, raison: "r" },
        weight: 0.5,
      },
    );
    // Repli gratuit (02/10/2026) : l'entonnoir ne bloque plus, la fiche sort « opposition non vérifiée ».
    check(
      "registre non lu : fiche publiée quand même, « opposition non vérifiée »",
      created.length === 1 && outcome.error === null && outcome.oppositionUnverified === true,
      JSON.stringify(outcome),
    );
  }

  console.log("\n8 ter. Une entreprise, un retenu (AJASSOCIES : trois offres)");
  {
    const t = (score: number): Triage => ({ utilisable: true, sujet_est_l_entreprise: true, type: "recrutement", pain_probable: `p${score}`, accroche_possible: "", score, raison: "r" });
    const outs: TriageOutcome[] = [
      { id: "a1", triage: t(4), retained: true, reason: null },
      { id: "a2", triage: t(5), retained: true, reason: null },
      { id: "a3", triage: t(4), retained: true, reason: null },
      { id: "b1", triage: t(4), retained: true, reason: null },
    ];
    const sirens = new Map([["a1", "111"], ["a2", "111"], ["a3", "111"], ["b1", "222"]]);
    const kept = onePerCompany(outs, sirens).filter((o) => o.retained).map((o) => o.id);
    check("la mieux notée par SIREN, les autres écartées", kept.join() === "a2,b1", kept.join());
    check("motif « doublon »", /doublon/.test(onePerCompany(outs, sirens).find((o) => o.id === "a1")?.reason ?? ""));
  }

  console.log("\n9. Téléphones lus sur le site");
  {
    check("tel: +33", extractPhones('<a href="tel:+33478123456">x</a>').join() === "04 78 12 34 56");
    check("écrit avec des points", extractPhones("<p>Tél. 04.78.12.34.56</p>").join() === "04 78 12 34 56");
    check("surtaxé écarté", extractPhones("<p>08 92 12 34 56</p>").length === 0);
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

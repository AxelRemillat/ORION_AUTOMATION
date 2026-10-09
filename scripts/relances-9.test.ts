/**
 * RELANCES À 9/10 — grille v2 (Cowork #12 puis #13) : R1–R10, assemblage, rédaction
 * avec une réécriture ciblée au plus, « À revoir » sinon ; jeu de référence de Cowork
 * (contrôles du code). Fixtures uniquement, aucun appel réel.
 */
import { readFileSync } from "node:fs";
import {
  assembleRelance,
  DEMO_LEADS,
  demoLead,
  introParts,
  judgeRelance,
  parseRelanceJudge,
  relanceCodeChecks,
  relanceMajority,
  relanceSubject,
  relanceVerdictOf,
  TRANSFER_SENTENCE,
  withoutRecruitment,
  withFamilyMark,
  outcomeVerb,
  newLot,
  rememberInLot,
  RELANCE_MODELS,
  buildRelanceWriterPrompt,
  questionKey,
  writeRelance,
  type RelanceContext,
  type RelanceFiche,
} from "../lib/outbox/relance-quality";
import { composeFollowUp, draftFollowUp, ficheOf } from "../lib/outbox/follow-up";
import { assembleShortRelance, chooseRelanceMode, SHORT_QUESTIONS, shortCodeChecks, shortQuestion, whenSent, writeShortRelance } from "../lib/outbox/relance-short";
import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";
import type { AskFn } from "../lib/ai/chat";
import type { Db } from "../lib/trash/scope";
import type { Prospect } from "../types";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}

// Intro fictive, au format des intros envoyées (salutation nominative, lien de démo &v, appel à l'action).
const INTRO_SUBJECT = "Vos demandes de devis de cuves inox";
const INTRO_BODY = [
  "Bonjour Madame Martin,",
  "",
  "Pour vos cuves inox sur mesure, chaque demande de devis arrive par e-mail avec des cotes à ressaisir. Une cote oubliée retarde la réponse au client.",
  "",
  "J'automatise la préparation des devis : je relève les cotes et quantités demandées, puis je vous soumets un devis à valider.",
  "",
  "Exemple testable en une minute : axelremillat.com/agent?v=2",
  "",
  "Auriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
].join("\n");
const FICHE: RelanceFiche = {
  companyName: "INOX FICTIF",
  facts: ["Fabrique des cuves inox pour la viticulture et la brasserie", "Atelier de 2 400 m² à Mâcon"],
  signals: ["Recrute un technicien bureau d'études (2026-09-28)", "Nouvelle gamme de cuves pour brasseurs (2026-09-20)"],
  activity: "Cuves inox sur mesure pour viticulteurs et brasseurs",
};
const PARTS = {
  about: "Vos devis de cuves pour brasseurs arrivent avec des cotes à reprendre une à une.",
  outcome: "Le brasseur reçoit alors son devis le jour même, sans cote oubliée.",
  cta: "Ces demandes de brasseurs arrivent-elles aussi par e-mail ?",
};
const YES = JSON.stringify({ R2: { ok: true, citation_intro: "demande de devis", citation_relance: "devis de cuves pour brasseurs" }, R5: { ok: true, citation: PARTS.cta }, R7: { ok: true, citation: "brasserie" }, R8: { ok: true, citation: "le brasseur reçoit son devis" } });
const NO_R2 = JSON.stringify({ R2: { ok: false, citation_intro: "devis", citation_relance: "candidatures" }, R5: { ok: true, citation: "" }, R7: { ok: true, citation: "" }, R8: { ok: true, citation: "" } });

async function main() {
  console.log("\n1. L'intro envoyée : salutation (R9), objet, lien de démo, appel à l'action");
  const intro = introParts(`Re: ${INTRO_SUBJECT}`, INTRO_BODY);
  check("salutation nominative reprise à l'identique", intro.greeting === "Bonjour Madame Martin,");
  check("« Bonjour Madame, » sans nom → « Bonjour, » (R9)", introParts("x", "Bonjour Madame,\n\nTexte").greeting === "Bonjour," && introParts("x", "Bonjour Monsieur,\n\nT").greeting === "Bonjour,");
  check("objet sans « Re: »", intro.subject === INTRO_SUBJECT);
  check("lien de démo avec son &v", intro.demoLink === "axelremillat.com/agent?v=2", intro.demoLink);
  check("appel à l'action de l'intro repéré", /15 minutes/.test(intro.cta ?? ""));

  console.log("\n2. Assemblage et contrôles du code (R1, R3, R4, R6, R8, R9, R10)");
  const nominative: RelanceContext = { intro, generic: false, seed: "INOX FICTIF" };
  const generic: RelanceContext = { intro, generic: true, seed: "INOX FICTIF" };
  const body = assembleRelance(PARTS, nominative);
  const subject = relanceSubject(intro);
  const code = relanceCodeChecks(subject, body, nominative);
  check("relance nominative : tous les contrôles du code à OUI", code.every((item) => item.ok), code);
  check("ligne du lien variée, jamais « La démo, pour mémoire »", DEMO_LEADS.some((lead) => body.includes(`${lead} axelremillat.com/agent?v=2`)) && !/pour m[ée]moire/.test(body), body);
  check("même fiche → même ligne ; fiches différentes → lignes variées", demoLead("INOX FICTIF") === demoLead("INOX FICTIF") && new Set(["A", "BULLY", "VEDIS", "POK", "SICA", "AXICLIM", "IMAGINE", "ANTARES"].map(demoLead)).size >= 3);
  const genericBody = assembleRelance(PARTS, generic);
  check("adresse générique : transfert ajouté, R4 à OUI", genericBody.includes(TRANSFER_SENTENCE) && relanceCodeChecks(subject, genericBody, generic).find((item) => item.id === "R4")?.ok === true);
  check("adresse nominative AVEC transfert → R4 à NON", relanceCodeChecks(subject, genericBody, nominative).find((item) => item.id === "R4")?.ok === false);
  const at = (id: string, b: string, ctx = nominative) => relanceCodeChecks(subject, b, ctx).find((item) => item.id === id);
  check("objet différent → R1 à NON", relanceCodeChecks("Relance devis", body, nominative).find((item) => item.id === "R1")?.ok === false);
  check("lien absent → R3 à NON", at("R3", body.replace(/axelremillat\.com\/agent\?v=2/, ""))?.ok === false);
  const noV = introParts(INTRO_SUBJECT, INTRO_BODY.replace("agent?v=2", "automatisations?demo=email"));
  // Cowork #14, option (b) : intro sans &v ni famille connue → la relance reprend EXACTEMENT son lien.
  check("intro sans &v ni famille (cas IMAGINE OPTIC) → lien exact de l'intro, R3 à OUI", noV.requireV === false && noV.demoLink === "axelremillat.com/automatisations?demo=email" && relanceCodeChecks(subject, assembleRelance(PARTS, { intro: noV, generic: false }), { intro: noV, generic: false }).find((item) => item.id === "R3")?.ok === true);
  check("intro AVEC &v → le &v reste obligatoire", intro.requireV === true && relanceCodeChecks(subject, body.replace("agent?v=2", "agent"), { intro: { ...intro, demoLink: "axelremillat.com/agent" }, generic: false }).find((item) => item.id === "R3")?.ok === false);
  const withFamily = introParts(INTRO_SUBJECT, INTRO_BODY.replace("agent?v=2", "automatisations?demo=email"), "F3");
  check("intro sans &v mais famille connue (F3) → même lien + &v=3, R3 à OUI", withFamily.demoLink === "axelremillat.com/automatisations?demo=email&v=3" && relanceCodeChecks(subject, assembleRelance(PARTS, { intro: withFamily, generic: false }), { intro: withFamily, generic: false }).find((item) => item.id === "R3")?.ok === true, withFamily.demoLink);
  check("lien déjà marqué : la famille ne le change pas", withFamilyMark("axelremillat.com/agent?v=2", "F4") === "axelremillat.com/agent?v=2" && withFamilyMark("axelremillat.com/agent", "F1") === "axelremillat.com/agent?v=1" && withFamilyMark("axelremillat.com/agent", null) === "axelremillat.com/agent");
  const r6 = (about: string) => at("R6", assembleRelance({ ...PARTS, about }, nominative));
  for (const phrase of ["Je me permets de revenir vers vous", "L'idée est simple", "Cela peut vous faire gagner du temps", "Je reviens vers vous au sujet de vos devis", "La meilleure solution pour vos devis"]) {
    check(`formule interdite « ${phrase} » → R6 à NON`, r6(`${phrase}, ${PARTS.about}`)?.ok === false);
  }
  check("moins de 35 mots → R6 à NON", at("R6", assembleRelance({ about: "Vos devis.", outcome: "Plus vite.", cta: "Oui ?" }, nominative))?.ok === false);
  check("plus de 60 mots → R6 à NON", r6(`${PARTS.about} ${PARTS.about} ${PARTS.about}`)?.ok === false);
  check("« La démo repère… » en sujet de phrase → R8 à NON", at("R8", assembleRelance({ ...PARTS, outcome: "La démo repère les cotes manquantes et prépare le devis." }, nominative))?.ok === false);
  check("phrase méta (« cité dans mon premier message ») → R8 à NON", at("R8", assembleRelance({ ...PARTS, about: "Vos cuves pour brasseurs, distinctes des cuves citées dans mon premier message, demandent d'autres cotes." }, nominative))?.ok === false);
  check("« Bonjour Madame, » sans nom en tête → R9 à NON", at("R9", body.replace("Bonjour Madame Martin,", "Bonjour Madame,"))?.ok === false);
  check("tic « Vos clients recevraient » → R8 à NON", at("R8", assembleRelance({ ...PARTS, outcome: "Vos clients recevraient leur devis plus rapidement." }, nominative))?.ok === false);
  check("tic « … vous prend-elle du temps ? » → R8 à NON", at("R8", assembleRelance({ ...PARTS, cta: "La vérification des cotes vous prend-elle du temps ?" }, nominative))?.ok === false && at("R8", assembleRelance({ ...PARTS, cta: "Le tri des commandes vous prend-il du temps ?" }, nominative))?.ok === false);
  check("recrutement mentionné → R10 à NON", at("R10", assembleRelance({ ...PARTS, about: "Un recrutement est signalé chez vous le 28 septembre pour le bureau d'études et les devis." }, nominative))?.ok === false);
  check("conditionnelle « Si … concerne … » → R10 à NON", at("R10", assembleRelance({ ...PARTS, outcome: "Si une facture fournisseur concerne un dépannage, la référence manquante est signalée." }, nominative))?.ok === false);
  check("signaux de recrutement retirés de la fiche donnée au rédacteur", withoutRecruitment(FICHE.signals).length === 1 && !/recrut/i.test(withoutRecruitment(FICHE.signals).join(" ")));

  console.log("\n3. Lecture du modèle (R2, R5, R7, R8) : vote à 3, majorité");
  check("lecture illisible → null", parseRelanceJudge("pas du JSON") === null);
  const majority = relanceMajority([parseRelanceJudge(YES), parseRelanceJudge(NO_R2), parseRelanceJudge(YES)]);
  check("majorité 2 contre 1 → R2 à OUI, citations intro et relance", majority?.find((item) => item.id === "R2")?.ok === true && /intro : « demande de devis/.test(majority?.find((item) => item.id === "R2")?.citation ?? ""), majority);
  check("égalité → NON", relanceMajority([parseRelanceJudge(YES), parseRelanceJudge(NO_R2)])?.find((item) => item.id === "R2")?.ok === false);
  const calls: string[] = [];
  const judgeAsk: AskFn = async (_role, _system, _user, _t, operation) => (calls.push(operation), YES);
  const verdict = await judgeRelance(judgeAsk, { subject, body, ctx: nominative, introBody: INTRO_BODY, fiche: FICHE });
  check("grille complète : 10/10 critères, prête, 3 lectures", verdict?.ready === true && verdict.items.length === 10 && verdict.score === 10 && calls.length === 3, { verdict, calls });
  check("R8 : la partie code ET la lecture doivent passer", relanceVerdictOf([...code.map((item) => (item.id === "R8" ? { ...item, ok: false } : item)), ...(majority ?? [])]).items.find((item) => item.id === "R8")?.ok === false);
  calls.length = 0;
  const failedCode = await judgeRelance(judgeAsk, { subject: "Autre objet", body, ctx: nominative, introBody: INTRO_BODY, fiche: FICHE });
  check("code en échec → pas d'appel au modèle", failedCode?.ready === false && calls.length === 0);
  const forced = await judgeRelance(judgeAsk, { subject: "Autre objet", body, ctx: nominative, introBody: INTRO_BODY, fiche: FICHE }, "x", 3, true);
  check("mesure d'accord (alwaysRead) : le modèle lit quand même", calls.length === 3 && forced?.ready === false);

  console.log("\n4. Rédaction : une réécriture ciblée au plus, sinon « À revoir »");
  {
    const scripted = (writer: string[], judge: string[]) => {
      const log: string[] = [];
      const ask: AskFn = async (role, system) => {
        if (role === "writer") {
          log.push(/RÉÉCRITURE/.test(system) ? "rewrite" : "first");
          return writer.shift() ?? "";
        }
        return judge.length > 1 ? judge.shift()! : judge[0];
      };
      return { ask, log };
    };
    const good = JSON.stringify(PARTS);
    const input = { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1" as const };
    {
      const { ask, log } = scripted([good], [YES]);
      const out = await writeRelance(ask, input);
      check("prête du premier coup : aucune réécriture", "body" in out && out.ready && out.attempts === 1 && !log.includes("rewrite"), log);
    }
    {
      const bad = JSON.stringify({ ...PARTS, outcome: "La démo repère les cotes manquantes et prépare le devis." });
      const { ask, log } = scripted([bad, good], [YES]);
      const out = await writeRelance(ask, input);
      check("R8 en échec → UNE réécriture ciblée, puis prête", "body" in out && out.ready && out.attempts === 2 && log.filter((entry) => entry === "rewrite").length === 1, log);
    }
    {
      const bad = JSON.stringify({ ...PARTS, about: "Je me permets de revenir vers vous au sujet des devis de cuves." });
      const { ask, log } = scripted([bad, bad, good], [YES]);
      const out = await writeRelance(ask, input);
      check("encore en échec après la réécriture → « À revoir », pas de troisième essai", "body" in out && !out.ready && /R6/.test(out.reason ?? "") && log.length === 2, { reason: "body" in out ? out.reason : out, log });
    }
  }

  console.log("\n5. Composition : intro du fil, signature, mention stop, note et motif");
  {
    const USER = "u1";
    const prospect = {
      id: "p1", user_id: USER, company_name: "INOX FICTIF", status: "contacte", email: "contact@inox-fictif.fr", email_type: "generique", sector: "Chaudronnerie",
      key_figures: { opposition_checked: true, opposition_source: "inpi", facts: [{ text: "Fabrique des cuves inox pour la viticulture", source_url: "https://inox-fictif.fr", page_kind: "home", distinctiveness: 3, process_hint: null }] },
      signals: [{ label: "Recrute un technicien bureau d'études", date: "2026-09-28" }], business_profile: null,
    } as unknown as Prospect;
    const sentIntro = { id: "m-intro", user_id: USER, prospect_id: "p1", type: "intro", status: "sent", subject: INTRO_SUBJECT, body: `${INTRO_BODY}\n\n${OPT_OUT_SENTENCE}\n\nAxel Remillat`, sent_at: "2026-10-05T08:00:00Z", thread_id: "thr-1", gmail_message_id: "gm-1", deleted_at: null };
    const db = new FakeDb({ prospects: [prospect as never], messages: [sentIntro], inbound_messages: [], offers: [] });
    const seen: string[] = [];
    const ask: AskFn = async (role, _system, user) => {
      seen.push(user);
      return role === "writer" ? JSON.stringify(PARTS) : YES;
    };
    const composed = await composeFollowUp(db as unknown as Db, { userId: USER, prospect, type: "relance_1", ask });
    check("composée sans rien écrire en base", composed.ok && db.rows("messages").length === 1, composed);
    if (composed.ok) {
      const draft = composed.draft;
      check("même fil, objet « Re: <objet exact> », salutation de l'intro", draft.thread_id === "thr-1" && draft.subject === `Re: ${INTRO_SUBJECT}` && draft.body.startsWith("Bonjour Madame Martin,"));
      check("adresse générique : transfert ; mention stop une seule fois", draft.body.includes(TRANSFER_SENTENCE) && draft.body.split(OPT_OUT_SENTENCE).length === 2, draft.body);
      check("prête : note 10, aucun motif", draft.ready && draft.quality_score === 10 && draft.quality_reason === null, draft);
      check("le rédacteur n'a vu ni la mention stop ni le recrutement", !seen.some((user) => user.includes(OPT_OUT_SENTENCE) || /recrute/i.test(user)), seen[0]);
    }
    const drafted = await draftFollowUp(db as unknown as Db, { userId: USER, prospect, type: "relance_1", ask });
    const row = db.rows("messages").find((message) => message.type === "relance_1") as Record<string, unknown>;
    check("brouillon enregistré avec note et motif, sans la grille", drafted.ok && row.quality_score === 10 && row.quality_reason === null && !("checklist" in row), row);
    check("fiche : faits sourcés", ficheOf(prospect).facts.includes("Fabrique des cuves inox pour la viticulture"));
    // Cowork #14 : MAVIFLEX, filiale du groupe Hörmann — aucune relance pour une fiche hors cible.
    const filiale = { ...prospect, id: "p2", company_name: "FILIALE FICTIVE", key_figures: { ...(prospect.key_figures as object), leader: "CHRISTOPH HORMANN", leader_person: "CHRISTOPH HORMANN" } } as unknown as Prospect;
    const filialeDb = new FakeDb({ prospects: [filiale as never], messages: [{ ...sentIntro, prospect_id: "p2" }], inbound_messages: [], offers: [] });
    let calls = 0;
    const counted: AskFn = async () => ((calls += 1), YES);
    const refused = await composeFollowUp(filialeDb as unknown as Db, { userId: USER, prospect: filiale, type: "relance_1", ask: counted });
    check("filiale de groupe (Hörmann) : relance refusée, aucun appel au modèle", !refused.ok && /hors cible : filiale de groupe \(Hörmann\)/.test(refused.ok ? "" : refused.error) && calls === 0, refused);
  }

  console.log("\n6. Jeu de référence de Cowork (evals/relances) : les contrôles du code");
  {
    const reference = JSON.parse(readFileSync("evals/relances/reference-2026-10-09.json", "utf8")) as { items: { company: string; note: number; ready: boolean; subject: string; body: string; introGreeting: string; introLink: string | null; generic: boolean }[] };
    check("8 relances notées par Cowork, aucune prête (note < 9)", reference.items.length === 8 && reference.items.every((item) => !item.ready && item.note < 9));
    let caught = 0;
    for (const item of reference.items) {
      const ctx: RelanceContext = { intro: { subject: item.subject.replace(/^Re: /, ""), greeting: introParts("", `${item.introGreeting}\n`).greeting, demoLink: item.introLink, cta: null }, generic: item.generic };
      const failed = relanceCodeChecks(item.subject, item.body, ctx).filter((criterion) => !criterion.ok);
      if (failed.length) caught += 1;
      check(`${item.company} (note ${item.note}) : refusée par le code (${failed.map((criterion) => criterion.id).join(", ") || "—"})`, failed.length > 0);
    }
    check("accord du code avec Cowork : au moins 7 sur 8", caught >= 7, `${caught}/8`);
  }

  console.log("\n7. Cowork #15 : 2e phrase active, modèles de ton, variété dans le lot");
  {
    check("passif « La bonne remise pourrait être appliquée » → R8 à NON", at("R8", assembleRelance({ ...PARTS, outcome: "La bonne remise pourrait être appliquée à chaque commande." }, nominative))?.ok === false);
    check("passif « serait confirmée » → R8 à NON", at("R8", assembleRelance({ ...PARTS, outcome: "Chaque commande serait confirmée avec la bonne référence." }, nominative))?.ok === false);
    check("actif « Vous enverriez le devis du premier coup » → R8 à OUI", at("R8", assembleRelance({ ...PARTS, outcome: "Vous enverriez le devis du premier coup, ou la bonne question tout de suite." }, nominative))?.ok === true);
    check("verbe de 2e phrase : enver, reserver, recev", outcomeVerb("Vous enverriez le devis du premier coup.") === "enver" && outcomeVerb("Votre accueil pourrait réserver le rendez-vous dès réception.") === "reserver" && outcomeVerb("Chaque magasin recevrait sa confirmation.") === "recev");
    check("les 3 modèles de Cowork sont dans la consigne du rédacteur", RELANCE_MODELS.length === 3 && RELANCE_MODELS.every((model) => buildRelanceWriterPrompt({ generic: false, type: "relance_1", feedback: null }).includes(model.split("\n\n")[1])));
    const lot = newLot();
    rememberInLot(lot, { outcome: "Vous enverriez le devis du premier coup.", cta: "Ça vous arrive souvent ?" });
    const withLot: RelanceContext = { ...nominative, lot };
    check("verbe déjà pris dans le lot → R8 à NON", relanceCodeChecks(subject, assembleRelance({ ...PARTS, outcome: "Vous enverriez la bonne cote dès la première réponse." }, withLot), withLot).find((item) => item.id === "R8")?.ok === false);
    check("question déjà posée dans le lot → R8 à NON", relanceCodeChecks(subject, assembleRelance({ ...PARTS, cta: "Ça vous arrive souvent ?" }, withLot), withLot).find((item) => item.id === "R8")?.ok === false);
    check("autre verbe, autre question → R8 à OUI", relanceCodeChecks(subject, assembleRelance({ ...PARTS, outcome: "Le brasseur recevrait son devis le jour même.", cta: "Est-ce que ce cas se présente chez vous ?" }, withLot), withLot).find((item) => item.id === "R8")?.ok === true);
    check("le rédacteur reçoit les verbes et questions déjà pris", /enverr/.test(buildRelanceWriterPrompt({ generic: false, type: "relance_1", feedback: null, lot })) && /ca vous arrive souvent/.test(buildRelanceWriterPrompt({ generic: false, type: "relance_1", feedback: null, lot })));
    // writeRelance alimente le lot : la 2e relance ne peut plus reprendre le verbe de la 1re.
    const shared = newLot();
    const ask: AskFn = async (role) => (role === "writer" ? JSON.stringify({ ...PARTS, outcome: "Le brasseur recevrait son devis complet le jour même, sans cote à redemander.", cta: "Ça vous arrive souvent ?" }) : YES);
    const first = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1", lot: shared });
    const second = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1", lot: shared });
    check("1re relance du lot prête, puis la 2e (même verbe, même question) « À revoir » R8", "body" in first && first.ready && "body" in second && !second.ready && /R8/.test(second.reason ?? "") && shared.verbs[0] === "recev", { first: "body" in first ? first.ready : first, second: "body" in second ? second.reason : second, lot: shared });
  }

  console.log("\n8. Cowork #16 : deux modes choisis par le code (A enrichie, B courte)");
  {
    const fact = (text: string, extra: Partial<{ distinctiveness: number; source_url: string | null; process_hint: string | null }> = {}) => ({ text, distinctiveness: 3, source_url: "https://exemple.fr", process_hint: null, ...extra });
    const a = chooseRelanceMode({ sourcedFacts: [fact("Nouvelle gamme de cuves pour brasseurs", { process_hint: "préparation des devis de cuves sur mesure" })] }, INTRO_SUBJECT, INTRO_BODY);
    check("fait sourcé distinctif sur le processus de l'intro (devis, cuves) → mode A, ancre gardée", a.mode === "A" && /cuves/.test(a.anchor?.text ?? ""), a);
    check("aucun fait → mode B", chooseRelanceMode({ sourcedFacts: [] }, INTRO_SUBJECT, INTRO_BODY).mode === "B");
    check("fait distinctif mais sur un autre processus (paie) → mode B", chooseRelanceMode({ sourcedFacts: [fact("Logiciel de paie déployé dans 12 sites", { process_hint: "gestion de la paie" })] }, INTRO_SUBJECT, INTRO_BODY).mode === "B");
    check("fait peu distinctif (1) → mode B", chooseRelanceMode({ sourcedFacts: [fact("Cuves inox pour la brasserie", { distinctiveness: 1 })] }, INTRO_SUBJECT, INTRO_BODY).mode === "B");
    check("fait non sourcé → mode B", chooseRelanceMode({ sourcedFacts: [fact("Cuves inox pour la brasserie", { source_url: null })] }, INTRO_SUBJECT, INTRO_BODY).mode === "B");
    check("fait de recrutement, même sur « devis » → ignoré, mode B", chooseRelanceMode({ sourcedFacts: [fact("Recrute un chargé de devis cuves", { process_hint: "recrutement d'un chargé de devis" })] }, INTRO_SUBJECT, INTRO_BODY).mode === "B");
    check("mots trop généraux (« suivi des demandes clients ») ne suffisent pas", chooseRelanceMode({ sourcedFacts: [fact("Suivi des demandes clients", { process_hint: "suivi des demandes clients" })] }, "Vos demandes clients", "Suivi des demandes clients en retard.").mode === "B");

    const now = new Date("2026-10-12T08:00:00Z"); // lundi
    check("« de la semaine dernière » (intro le mardi 6/10, relance le lundi 12/10)", whenSent("2026-10-06T09:00:00Z", now) === "de la semaine dernière");
    check("« de mardi » (même semaine)", whenSent("2026-10-13T09:00:00Z", new Date("2026-10-15T08:00:00Z")) === "de mardi");
    check("« du 28 septembre » (plus ancien)", whenSent("2026-09-28T09:00:00Z", now) === "du 28 septembre");

    const lot = newLot();
    const q1 = shortQuestion("ROBIN", lot);
    lot.questions.push(questionKey(q1));
    const q2 = shortQuestion("ROBIN", lot);
    check("question de la relance courte : tirée de la liste, jamais deux fois dans un lot", SHORT_QUESTIONS.includes(q1 as never) && q1 !== q2);
    const bigLot = newLot();
    const asked = ["A", "B", "C", "D", "E", "F", "G", "H"].map((seed) => {
      const question = shortQuestion(seed, bigLot);
      bigLot.questions.push(questionKey(question));
      return question;
    });
    check("lot de 8 relances courtes : 8 questions différentes (cas AGM / TEOPLUS du 09/10)", new Set(asked).size === 8, asked);

    const shortIntro = introParts(INTRO_SUBJECT, INTRO_BODY);
    const sctx = { greeting: shortIntro.greeting, subject: `Re: ${INTRO_SUBJECT}`, introSubject: INTRO_SUBJECT, demoLink: shortIntro.demoLink, requireV: shortIntro.requireV, generic: false, seed: "INOX", when: "de la semaine dernière", question: "Est-ce un sujet chez vous en ce moment ?" };
    const topic = "la préparation de vos devis de cuves sur mesure";
    const shortBody = assembleShortRelance(topic, sctx);
    check("relance courte assemblée : « Je remonte mon message de la semaine dernière sur … »", shortBody.includes("Je remonte mon message de la semaine dernière sur la préparation de vos devis de cuves sur mesure.") && shortBody.startsWith("Bonjour Madame Martin,"), shortBody);
    const shortChecks = shortCodeChecks(`Re: ${INTRO_SUBJECT}`, shortBody, sctx, topic);
    check("relance courte nominative : R1, R3, R4, R6, R9, R10 à OUI", shortChecks.every((item) => item.ok), shortChecks);
    const genericShort = assembleShortRelance(topic, { ...sctx, generic: true });
    check("relance courte générique : transfert, toujours 25–40 mots", shortCodeChecks(`Re: ${INTRO_SUBJECT}`, genericShort, { ...sctx, generic: true }, topic).every((item) => item.ok));
    check("sujet trop long (> 10 mots) → R6 à NON", shortCodeChecks(`Re: ${INTRO_SUBJECT}`, assembleShortRelance("la préparation de vos devis de cuves inox sur mesure pour les brasseurs et viticulteurs", sctx), sctx, "la préparation de vos devis de cuves inox sur mesure pour les brasseurs et viticulteurs").find((item) => item.id === "R6")?.ok === false);

    const R7_YES = JSON.stringify({ R7: { ok: true, citation: "la préparation de vos devis" } });
    let writerCalls = 0;
    const askShort: AskFn = async (role) => (role === "writer" ? ((writerCalls += 1), JSON.stringify({ topic })) : R7_YES);
    const shortLot = newLot();
    const out1 = await writeShortRelance(askShort, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: { companyName: "INOX FICTIF" }, introSentAt: "2026-10-06T09:00:00Z", now, lot: shortLot });
    const callsAfterFirst = writerCalls;
    const out2 = await writeShortRelance(askShort, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: { companyName: "INOX FICTIF" }, introSentAt: "2026-10-06T09:00:00Z", now, lot: shortLot });
    check("relance courte prête (grille B : 7 critères), une seule rédaction", "body" in out1 && out1.ready && out1.verdict?.items.length === 7 && callsAfterFirst === 1, out1);
    check("2e relance courte du lot : autre question", "body" in out1 && "body" in out2 && out1.body.split("\n\n").pop() !== out2.body.split("\n\n").pop());
    const R7_NO = JSON.stringify({ R7: { ok: false, citation: "situation inventée" } });
    const askBad: AskFn = async (role) => (role === "writer" ? JSON.stringify({ topic }) : R7_NO);
    const bad = await writeShortRelance(askBad, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: { companyName: "INOX FICTIF" }, introSentAt: "2026-10-06T09:00:00Z", now });
    check("R7 à NON après correction → « À revoir »", "body" in bad && !bad.ready && /R7/.test(bad.reason ?? ""), bad);
  }

  console.log(failures === 0 ? "\nTous les tests relances 9/10 passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

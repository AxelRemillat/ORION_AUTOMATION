/**
 * RELANCES À 9/10 (Cowork #12) : grille R1–R7, assemblage, rédaction avec une
 * réécriture ciblée au plus, « À revoir » sinon. Fixtures uniquement, aucun appel réel.
 */
import {
  assembleRelance,
  introParts,
  judgeRelance,
  parseRelanceJudge,
  relanceCodeChecks,
  relanceMajority,
  relanceSubject,
  relanceVerdictOf,
  TRANSFER_SENTENCE,
  writeRelance,
  type RelanceContext,
  type RelanceFiche,
} from "../lib/outbox/relance-quality";
import { composeFollowUp, draftFollowUp, ficheOf } from "../lib/outbox/follow-up";
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
  signals: ["Recrute un technicien bureau d'études (2026-09-28)"],
  activity: "Cuves inox sur mesure pour viticulteurs et brasseurs",
};
const NOVELTY = "Vous recrutez un technicien bureau d'études : pendant ce temps, les demandes des brasseurs s'accumulent, et la démo prépare déjà le devis à partir des cotes reçues par e-mail.";
const CTA = "Ces demandes de brasseurs arrivent-elles aussi par e-mail ?";

async function main() {
  console.log("\n1. L'intro envoyée : salutation, objet, lien de démo, appel à l'action");
  const intro = introParts(`Re: ${INTRO_SUBJECT}`, INTRO_BODY);
  check("salutation reprise à l'identique", intro.greeting === "Bonjour Madame Martin,");
  check("objet sans « Re: »", intro.subject === INTRO_SUBJECT);
  check("lien de démo avec son &v", intro.demoLink === "axelremillat.com/agent?v=2", intro.demoLink);
  check("appel à l'action de l'intro repéré", /15 minutes/.test(intro.cta ?? ""));
  check("intro sans salutation « Bonjour » → « Bonjour, »", introParts("x", "Madame,\n\nTexte").greeting === "Bonjour,");

  console.log("\n2. Assemblage et contrôles du code (R1, R3, R4, R6)");
  const nominative: RelanceContext = { intro, generic: false };
  const generic: RelanceContext = { intro, generic: true };
  const body = assembleRelance({ novelty: NOVELTY, cta: CTA }, nominative);
  const subject = relanceSubject(intro);
  const code = relanceCodeChecks(subject, body, nominative);
  check("relance nominative : R1, R3, R4, R6 à OUI", code.every((item) => item.ok), code);
  check("objet « Re: <objet exact> »", subject === `Re: ${INTRO_SUBJECT}`);
  check("lien de démo sur sa propre ligne", body.split("\n").some((line) => line === "La démo, pour mémoire : axelremillat.com/agent?v=2"));
  const genericBody = assembleRelance({ novelty: NOVELTY, cta: CTA }, generic);
  check("adresse générique : phrase de transfert ajoutée, R4 à OUI", genericBody.includes(TRANSFER_SENTENCE) && relanceCodeChecks(subject, genericBody, generic).find((item) => item.id === "R4")?.ok === true);
  check("adresse générique SANS transfert → R4 à NON", relanceCodeChecks(subject, body, generic).find((item) => item.id === "R4")?.ok === false);
  check("adresse nominative AVEC transfert → R4 à NON", relanceCodeChecks(subject, genericBody, nominative).find((item) => item.id === "R4")?.ok === false);
  const r1 = (s: string, b: string) => relanceCodeChecks(s, b, nominative).find((item) => item.id === "R1")?.ok;
  check("objet différent → R1 à NON", r1("Relance devis", body) === false);
  check("salutation différente → R1 à NON", r1(subject, body.replace("Bonjour Madame Martin,", "Bonjour,")) === false);
  const r3 = (b: string) => relanceCodeChecks(subject, b, nominative).find((item) => item.id === "R3")?.ok;
  check("lien de démo absent → R3 à NON", r3(body.replace("La démo, pour mémoire : axelremillat.com/agent?v=2", "La démo, pour mémoire.")) === false);
  check("autre variante de démo (&v=3) → R3 à NON", r3(body.replace("agent?v=2", "agent?v=3")) === false);
  const r6 = (novelty: string) => relanceCodeChecks(subject, assembleRelance({ novelty, cta: CTA }, nominative), nominative).find((item) => item.id === "R6");
  for (const phrase of ["Je me permets de revenir vers vous", "L'idée est simple", "Cela peut vous faire gagner du temps", "Sans réponse de votre part", "Je reviens vers vous au sujet de vos devis", "La meilleure solution pour vos devis"]) {
    check(`formule interdite « ${phrase} » → R6 à NON`, r6(`${phrase}, ${NOVELTY}`)?.ok === false);
  }
  check("trop court (moins de 40 mots) → R6 à NON", r6("Vous recrutez.")?.ok === false);
  check("trop long (plus de 70 mots) → R6 à NON", r6(`${NOVELTY} ${NOVELTY} ${NOVELTY}`)?.ok === false);
  check("le lien ne compte pas comme des mots", /mots/.test(code.find((item) => item.id === "R6")?.citation ?? ""), code.find((item) => item.id === "R6")?.citation);

  console.log("\n3. Lecture du modèle (R2, R5, R7) : vote à 3, majorité");
  const yes = JSON.stringify({ R2: { ok: true, citation_intro: "cotes à ressaisir", citation_relance: "Vous recrutez un technicien" }, R5: { ok: true, citation: CTA }, R7: { ok: true, citation: "recrute" } });
  const noR2 = JSON.stringify({ R2: { ok: false, citation_intro: "devis", citation_relance: "devis" }, R5: { ok: true, citation: CTA }, R7: { ok: true, citation: "" } });
  check("lecture illisible → null", parseRelanceJudge("pas du JSON") === null);
  const majority = relanceMajority([parseRelanceJudge(yes), parseRelanceJudge(noR2), parseRelanceJudge(yes)]);
  check("majorité 2 contre 1 → R2 à OUI, avec citations intro et relance", majority?.find((item) => item.id === "R2")?.ok === true && /intro : « cotes/.test(majority?.find((item) => item.id === "R2")?.citation ?? ""), majority);
  check("égalité → NON", relanceMajority([parseRelanceJudge(yes), parseRelanceJudge(noR2)])?.find((item) => item.id === "R2")?.ok === false);
  const calls: string[] = [];
  const judgeAsk: AskFn = async (_role, _system, _user, _t, operation) => (calls.push(operation), yes);
  const verdict = await judgeRelance(judgeAsk, { subject, body, ctx: nominative, introBody: INTRO_BODY, fiche: FICHE });
  check("grille complète : 7/7, prête, note 10, 3 lectures", verdict?.ready === true && verdict.score === 10 && calls.length === 3, { verdict, calls });
  calls.length = 0;
  const failedCode = await judgeRelance(judgeAsk, { subject: "Autre objet", body, ctx: nominative, introBody: INTRO_BODY, fiche: FICHE });
  check("code en échec → pas d'appel au modèle", failedCode?.ready === false && calls.length === 0);
  check("note : 1 critère à NON → 8,5", relanceVerdictOf([...code, ...(majority ?? [])].map((item) => (item.id === "R5" ? { ...item, ok: false } : item))).score === 8.5);

  console.log("\n4. Rédaction : une réécriture ciblée au plus, sinon « À revoir »");
  {
    const scripted = (writer: string[], judge: string[]) => {
      const log: string[] = [];
      const ask: AskFn = async (role, system) => {
        log.push(role);
        if (role === "writer") {
          log.push(/RÉÉCRITURE/.test(system) ? "rewrite" : "first");
          return writer.shift() ?? "";
        }
        return judge.length > 1 ? judge.shift()! : judge[0];
      };
      return { ask, log };
    };
    const good = JSON.stringify({ novelty: NOVELTY, cta: CTA });
    {
      const { ask, log } = scripted([good], [yes]);
      const out = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1" });
      check("prête du premier coup : une rédaction, aucune réécriture", "body" in out && out.ready && out.attempts === 1 && !log.includes("rewrite"), log);
    }
    {
      const bad = JSON.stringify({ novelty: `Je me permets de revenir vers vous : ${NOVELTY}`, cta: CTA });
      const { ask, log } = scripted([bad, good], [yes]);
      const out = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1" });
      check("R6 en échec → UNE réécriture ciblée, puis prête", "body" in out && out.ready && out.attempts === 2 && log.filter((entry) => entry === "rewrite").length === 1, log);
    }
    {
      const bad = JSON.stringify({ novelty: `Je me permets de revenir vers vous : ${NOVELTY}`, cta: CTA });
      const { ask, log } = scripted([bad, bad, good], [yes]);
      const out = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1" });
      check("encore en échec après la réécriture → « À revoir » (R6), pas de troisième essai", "body" in out && !out.ready && /R6/.test(out.reason ?? "") && log.filter((entry) => entry === "first" || entry === "rewrite").length === 2, { reason: "body" in out ? out.reason : out, log });
    }
    {
      const { ask } = scripted([good, good], [noR2, noR2, noR2, yes]);
      const out = await writeRelance(ask, { introSubject: INTRO_SUBJECT, introBody: INTRO_BODY, generic: false, fiche: FICHE, type: "relance_1" });
      check("R2 à NON → réécriture avec la critique R2", "body" in out && out.attempts === 2, out);
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
      return role === "writer" ? JSON.stringify({ novelty: NOVELTY, cta: CTA }) : yes;
    };
    const composed = await composeFollowUp(db as unknown as Db, { userId: USER, prospect, type: "relance_1", ask });
    check("composée sans rien écrire en base", composed.ok && db.rows("messages").length === 1, composed);
    if (composed.ok) {
      const draft = composed.draft;
      check("même fil (thread, réponse au dernier envoi)", draft.thread_id === "thr-1" && draft.reply_to_gmail_message_id === "gm-1");
      check("objet « Re: <objet exact> », salutation de l'intro", draft.subject === `Re: ${INTRO_SUBJECT}` && draft.body.startsWith("Bonjour Madame Martin,"));
      check("adresse générique : transfert demandé ; mention stop une seule fois", draft.body.includes(TRANSFER_SENTENCE) && draft.body.split(OPT_OUT_SENTENCE).length === 2, draft.body);
      check("prête : note 10, aucun motif", draft.ready && draft.quality_score === 10 && draft.quality_reason === null);
      check("le rédacteur n'a pas reçu la mention stop de l'intro", !seen.some((user) => user.includes(OPT_OUT_SENTENCE)));
    }
    const drafted = await draftFollowUp(db as unknown as Db, { userId: USER, prospect, type: "relance_1", ask });
    const row = db.rows("messages").find((message) => message.type === "relance_1") as Record<string, unknown>;
    check("brouillon enregistré avec note et motif", drafted.ok && row.status === "draft" && row.quality_score === 10 && row.quality_reason === null, row);
    const facts = ficheOf(prospect);
    check("fiche : faits sourcés et signaux datés", facts.facts.includes("Fabrique des cuves inox pour la viticulture") && facts.signals[0] === "Recrute un technicien bureau d'études (2026-09-28)");
    const noIntro = await composeFollowUp(new FakeDb({ prospects: [prospect as never], messages: [], inbound_messages: [], offers: [] }) as unknown as Db, { userId: USER, prospect, type: "relance_1", ask });
    check("aucune intro envoyée → pas de relance", !noIntro.ok);
  }

  console.log(failures === 0 ? "\nTous les tests relances 9/10 passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

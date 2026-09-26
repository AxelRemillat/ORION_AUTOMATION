import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import { validateEmail, type ValidationResult } from "@/lib/emails/validate";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import { chooseProof, entryOfferLabel, promiseLines, signatureFor } from "@/lib/offer/model";
import type { UserOffer } from "@/types";
import type { ToneKey } from "@/lib/tones";
import {
  buildCriticContext,
  buildCriticPrompt,
  failingCriteria,
  parseCritique,
  type Critique,
} from "./critic";
import { buildWritingPrompt, parseEmail, planFor, type GeneratedEmail, type PlanKey } from "./prompt";

/**
 * RÉDACTEUR → validateurs → JUGE → une réécriture au plus.
 *
 * Partagé par la route et le script d'évaluation : l'A/B mesure exactement
 * ce que l'utilisateur voit à l'écran.
 */

/** Phrases de preuve citables : elles viennent de /offre, plus du code. */
const publicProofsOf = (offer: UserOffer): string[] =>
  (offer.proofs ?? []).filter((proof) => proof.publicOk).map((proof) => proof.sentence);

export interface DraftInput {
  ask: AskFn;
  brief: StrategyBrief;
  facts: DerivedFact[];
  tone: ToneKey;
  contact: DecisionMakerContact | null;
  prospectId: string;
  /** Dénomination du registre : sert au contrôle des capitales. */
  registryName: string;
  /** Ce qu'Axel vend et comment il signe (page /offre). */
  offer: UserOffer;
  /** Ouvertures et fins déjà servies. */
  avoid: string[];
  leaderPerson?: string | null;
  /** Dirigeant entrant a qui le mail s'adresse nominativement. */
  addressee?: string | null;
  forbiddenNames?: readonly string[];
  /** `false` pour « Réécrire depuis le brief » : rédacteur seul, pas de juge. */
  judge?: boolean;
  /**
   * Étape qui commence, pour la barre de progression d'un job de fond.
   * Une erreur d'écriture de l'avancement ne doit jamais casser la rédaction.
   */
  onStage?: (stage: "judge" | "rewrite") => Promise<void> | void;
}

export interface DraftOutcome {
  email: GeneratedEmail;
  validation: ValidationResult;
  critique: Critique | null;
  failing: string[];
  plan: PlanKey;
  rewritten: boolean;
}

/**
 * Retire une signature que le modele aurait ecrite malgre la consigne.
 *
 * Il glisse souvent un « Axel » seul sur la derniere ligne — c'est ce qu'il a
 * vu mille fois. On l'enleve avant d'ajouter la vraie, sinon le mail se
 * termine par deux signatures.
 */
/**
 * Chiffres que l'offre autorise dans le corps.
 *
 * « 2 a 3 semaines » et « 15 min » viennent de /offre : ce sont NOS chiffres.
 * Le validateur les refusait comme « absents des faits », ce qui faisait
 * echouer tout mail qui annonçait un delai.
 */
/** Ce qu'Axel s'engage a faire : le juge n'a pas a l'exiger des faits. */
export function commitmentsOf(offer: UserOffer): string[] {
  const entry = entryOfferLabel(offer);
  return [...promiseLines(offer), entry ? `propose ${entry}` : null].filter(
    (line): line is string => Boolean(line),
  );
}

export function offerNumbers(offer: UserOffer): number[] {
  const found = new Set<number>();
  for (const text of [offer.lead_time, offer.entry_duration, offer.entry_pitch]) {
    for (const match of (text ?? "").matchAll(/\d+/g)) {
      const value = Number(match[0]);
      if (Number.isFinite(value)) found.add(value);
    }
  }
  // « quinze minutes » s'ecrit aussi en lettres : on ne peut pas tout couvrir,
  // mais les formes chiffrees de l'offre suffisent au cas courant.
  return [...found];
}

export function stripSignature(body: string): string {
  const lines = body.trimEnd().split(/\r?\n/);
  while (lines.length) {
    const last = (lines[lines.length - 1] ?? "").trim();
    const isSignature =
      last === "" ||
      /^(bien |tres )?cordialement[.,]?$/i.test(last) ||
      /^bonne (journee|journée|soiree|soirée)[.,]?$/i.test(last) ||
      (last.split(/\s+/).length <= 4 && /^[A-ZÀ-Ý][\p{L}'-]*( [A-ZÀ-Ý][\p{L}'-]*)*[.,]?$/u.test(last));
    if (!isSignature) break;
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

export async function draftFromBrief(input: DraftInput): Promise<DraftOutcome | { error: string }> {
  const { ask, brief, tone } = input;
  const writingInput = {
    tone,
    brief,
    facts: input.facts,
    contact: input.contact,
    prospectId: input.prospectId,
    avoid: input.avoid,
    leaderPerson: input.leaderPerson,
    addressee: input.addressee,
    offer: input.offer,
  };
  const plan = planFor(writingInput);
  // La signature est POSEE PAR LE CODE : le modele ne l'ecrit pas, et elle ne
  // compte pas dans les mots. Avant, le mail se terminait par « Axel » seul.
  const signature = signatureFor(input.offer);
  // Le validateur et le juge ne connaissent, eux aussi, que les faits du brief.
  const allowedFacts = briefFacts(brief, input.facts);
  const context = {
    facts: allowedFacts,
    contact: input.contact,
    tone,
    companyName: input.registryName,
    signature,
    offerNumbers: offerNumbers(input.offer),
    proofs: publicProofsOf(input.offer),
    plan,
    forbiddenNames: input.forbiddenNames,
  };

  const sign = (email: GeneratedEmail | null): GeneratedEmail | null =>
    email ? { ...email, body: `${stripSignature(email.body)}

${signature}` } : null;

  const write = (critique?: string) =>
    ask(
      "writer",
      buildWritingPrompt({ ...writingInput, critique }),
      `${critique ? "Réécris" : "Écris"} le mail pour ${brief.companyName}.`,
      critique ? 0.75 : 0.85,
      `redaction:${tone}${critique ? ":rewrite" : ""}`,
    ).then(parseEmail).then(sign);

  const judge = (email: GeneratedEmail, operation: string) =>
    ask("judge", buildCriticPrompt(
        allowedFacts,
        publicProofsOf(input.offer),
        commitmentsOf(input.offer),
        input.offer.title,
      ), buildCriticContext(brief, email), 0, operation).then(
      parseCritique,
    );

  const email = await write();
  if (!email) return { error: "Brouillon inexploitable." };
  const validation = validateEmail(email, context);

  if (input.judge === false) {
    return { email, validation, critique: null, failing: [], plan, rewritten: false };
  }

  await Promise.resolve(input.onStage?.("judge")).catch(() => undefined);
  const critique = await judge(email, "critique");
  const failing = critique ? failingCriteria(critique) : [];
  const first: DraftOutcome = { email, validation, critique, failing, plan, rewritten: false };
  if (validation.ok && failing.length === 0) return first;

  // UNE seule réécriture : au-delà, on rend la main plutôt que de boucler.
  // La longueur est mise EN TETE : c'est le point le plus souvent rate, et
  // celui qui empeche l'envoi.
  const feedback = [
    ...validation.failures.map((line) => `- ${line}`),
    ...failing.map((line) => `- ${line}`),
    ...(validation.failures.some((line) => /mots/.test(line))
      ? [
          "",
          "Pour raccourcir : garde les quatre blocs et le fond, coupe les mots qui ne",
          "portent rien — adverbes, redites, seconde clause du bloc 3. Ne supprime ni",
          "l'accroche, ni la preuve, ni la demande.",
        ]
      : []),
  ].join("\n");
  await Promise.resolve(input.onStage?.("rewrite")).catch(() => undefined);
  const rewritten = await write(feedback);
  if (!rewritten) return first;

  const secondValidation = validateEmail(rewritten, context);
  const secondCritique = await judge(rewritten, "critique:rewrite");
  const secondFailing = secondCritique ? failingCriteria(secondCritique) : [];

  /*
   * Ce qui fait qu'une reecriture est MEILLEURE.
   *
   * Les deux familles d'echec ne se valent pas. Un echec de validateur est une
   * regle dure : un mail de 138 mots depasse le plafond de 125, il ne part pas.
   * Un critere du juge sous le seuil est un avis — utile, mais qui n'empeche
   * pas l'envoi. La somme des deux mettait « trop long » et « ton un peu
   * promotionnel » a egalite, et gardait le mail trop long. D'ou la comparaison
   * lexicographique : d'abord les validateurs, ensuite le juge.
   */
  const improved =
    secondValidation.failures.length < validation.failures.length ||
    (secondValidation.failures.length === validation.failures.length &&
      secondFailing.length < failing.length);
  return improved
    ? { email: rewritten, validation: secondValidation, critique: secondCritique, failing: secondFailing, plan, rewritten: true }
    : first;
}

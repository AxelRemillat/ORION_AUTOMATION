import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import { validateEmail, type ValidationResult } from "@/lib/emails/validate";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import { PERSONA } from "@/lib/persona";
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

const PUBLIC_PROOFS = PERSONA.proofs.filter((proof) => proof.publicOk).map((proof) => proof.text);

export interface DraftInput {
  ask: AskFn;
  brief: StrategyBrief;
  facts: DerivedFact[];
  tone: ToneKey;
  contact: DecisionMakerContact | null;
  prospectId: string;
  /** Dénomination du registre : sert au contrôle des capitales. */
  registryName: string;
  /** Ouvertures et fins déjà servies. */
  avoid: string[];
  leaderPerson?: string | null;
  forbiddenNames?: readonly string[];
  /** `false` pour « Réécrire depuis le brief » : rédacteur seul, pas de juge. */
  judge?: boolean;
}

export interface DraftOutcome {
  email: GeneratedEmail;
  validation: ValidationResult;
  critique: Critique | null;
  failing: string[];
  plan: PlanKey;
  rewritten: boolean;
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
  };
  const plan = planFor(writingInput);
  // Le validateur et le juge ne connaissent, eux aussi, que les faits du brief.
  const allowedFacts = briefFacts(brief, input.facts);
  const context = {
    facts: allowedFacts,
    contact: input.contact,
    tone,
    companyName: input.registryName,
    proofs: PUBLIC_PROOFS,
    plan,
    forbiddenNames: input.forbiddenNames,
  };

  const write = (critique?: string) =>
    ask(
      "writer",
      buildWritingPrompt({ ...writingInput, critique }),
      `${critique ? "Réécris" : "Écris"} le mail pour ${brief.companyName}.`,
      critique ? 0.75 : 0.85,
      `redaction:${tone}${critique ? ":rewrite" : ""}`,
    ).then(parseEmail);

  const judge = (email: GeneratedEmail, operation: string) =>
    ask("judge", buildCriticPrompt(allowedFacts, PUBLIC_PROOFS), buildCriticContext(brief, email), 0, operation).then(
      parseCritique,
    );

  const email = await write();
  if (!email) return { error: "Brouillon inexploitable." };
  const validation = validateEmail(email, context);

  if (input.judge === false) {
    return { email, validation, critique: null, failing: [], plan, rewritten: false };
  }

  const critique = await judge(email, "critique");
  const failing = critique ? failingCriteria(critique) : [];
  const first: DraftOutcome = { email, validation, critique, failing, plan, rewritten: false };
  if (validation.ok && failing.length === 0) return first;

  // UNE seule réécriture : au-delà, on rend la main plutôt que de boucler.
  const feedback = [...validation.failures, ...failing].map((line) => `- ${line}`).join("\n");
  const rewritten = await write(feedback);
  if (!rewritten) return first;

  const secondValidation = validateEmail(rewritten, context);
  const secondCritique = await judge(rewritten, "critique:rewrite");
  const secondFailing = secondCritique ? failingCriteria(secondCritique) : [];

  // On ne garde la réécriture que si elle est réellement meilleure.
  const improved =
    secondValidation.failures.length + secondFailing.length < validation.failures.length + failing.length;
  return improved
    ? { email: rewritten, validation: secondValidation, critique: secondCritique, failing: secondFailing, plan, rewritten: true }
    : first;
}

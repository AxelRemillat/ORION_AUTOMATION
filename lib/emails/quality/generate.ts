import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import { withOptOut } from "@/lib/mail-preflight/opt-out";
import { demoFor } from "./demo-links";
import { judgeMail, PASS_SCORE, type JudgeVerdict } from "./judge";
import { checkMail, type RuleResult } from "./rules";
import { assemble, ctaFor, type MailParts } from "./template";
import { buildWriterPrompt, parseParts } from "./writer";

/**
 * GÉNÉRATION QUALITÉ — objectif « envoyable sans retouche » (≥ 9/10).
 *
 *   rédaction → garde-fou déterministe → juge (modèle léger)
 *   → réécriture si une règle casse ou si la note est < 9 (2 essais au plus)
 *   → toujours < 9 : brouillon gardé, marqué « À revoir » avec la raison.
 *
 * Le meilleur essai est retenu : d'abord celui qui passe le garde-fou, puis la
 * meilleure note. Rien n'est jamais envoyé ici.
 */

export const MAX_REWRITES = 2;

export interface QualityInput {
  ask: AskFn;
  brief: StrategyBrief;
  facts: DerivedFact[];
  prospectId: string;
  companyName: string;
  activity: string | null;
  /** Texte écrit par le prospect lui-même (site, profil, signal) : ses sigles sont permis. */
  prospectText: string;
  greeting: string;
  signature: string;
  forbiddenNames?: readonly string[];
  offerNumbers?: readonly number[];
}

export interface QualityAttempt {
  parts: MailParts;
  /** Corps complet : mention « stop » et signature comprises. */
  body: string;
  rules: RuleResult;
  verdict: JudgeVerdict | null;
}

export interface QualityOutcome {
  subject: string;
  body: string;
  score: number | null;
  /** `true` → « À revoir » : pas dans « Nouveaux prospects ». */
  needsReview: boolean;
  /** Pourquoi il est à revoir, en une ligne ; `null` sinon. */
  reviewReason: string | null;
  attempts: number;
  demo: string;
  history: QualityAttempt[];
}

const rank = (attempt: QualityAttempt) => (attempt.rules.ok ? 100 : 0) - attempt.rules.failures.length + (attempt.verdict?.score ?? 0);

export async function generateQualityDraft(input: QualityInput): Promise<QualityOutcome | { error: string }> {
  const demo = demoFor(`${input.brief.pain.task} ${input.brief.pain.automationIdea}`);
  const cta = ctaFor(input.prospectId);
  const facts = briefFacts(input.brief, input.facts);
  const factText = facts.map((fact) => `- ${fact.label} : ${fact.value}`).join("\n");
  const history: QualityAttempt[] = [];
  let feedback: string | null = null;

  for (let attempt = 0; attempt <= MAX_REWRITES; attempt += 1) {
    const raw = await input.ask(
      "writer",
      buildWriterPrompt({ brief: input.brief, facts, activity: input.activity, companyName: input.companyName, demo, greeting: input.greeting, cta, feedback }),
      `${feedback ? "Réécris" : "Écris"} l'accroche, la proposition et l'objet pour ${input.companyName}.`,
      feedback ? 0.6 : 0.8,
      `qualite:redaction${feedback ? ":rewrite" : ""}`,
    ).catch(() => "");
    const parts = parseParts(raw);
    if (!parts) {
      feedback = "La réponse n'était pas le JSON demandé : {\"subject\",\"hook\",\"proposal\"}.";
      continue;
    }
    const core = assemble(parts, { greeting: input.greeting, demo, cta });
    const rules = checkMail(parts, core, {
      greeting: input.greeting,
      facts,
      prospectText: input.prospectText,
      companyName: input.companyName,
      forbiddenNames: input.forbiddenNames,
      offerNumbers: input.offerNumbers,
    });
    // Le juge ne note qu'un mail qui passe le garde-fou : inutile de payer pour
    // une note que la règle a déjà tranchée.
    const verdict = rules.ok
      ? await judgeMail(input.ask, { subject: parts.subject, body: core, company: input.companyName, facts: factText }, `qualite:juge:${attempt}`)
      : null;
    const body = withOptOut(`${core}\n\n${input.signature}`, input.signature);
    history.push({ parts, body, rules, verdict });
    if (rules.ok && verdict && verdict.score >= PASS_SCORE) break;

    feedback = rules.ok
      ? [`Note du relecteur : ${verdict?.score ?? "?"}/10.`, ...(verdict?.reasons ?? []).map((line) => `- ${line}`), verdict?.fix ? `Consigne : ${verdict.fix}` : ""].filter(Boolean).join("\n")
      : rules.failures.map((line) => `- ${line}`).join("\n");
  }

  if (!history.length) return { error: "Brouillon inexploitable : le rédacteur n'a rendu aucun texte utilisable." };
  const best = [...history].sort((a, b) => rank(b) - rank(a))[0];
  const score = best.verdict?.score ?? null;
  const passed = best.rules.ok && score !== null && score >= PASS_SCORE;
  const reviewReason = passed
    ? null
    : !best.rules.ok
      ? best.rules.failures[0]
      : score === null
        ? "Relecture automatique indisponible : à relire avant envoi."
        : `Note ${score}/10 : ${best.verdict?.reasons[0] ?? "sous le seuil de 9"}`;
  return {
    subject: best.parts.subject,
    body: best.body,
    score,
    needsReview: !passed,
    reviewReason,
    attempts: history.length,
    demo: demo.path,
    history,
  };
}

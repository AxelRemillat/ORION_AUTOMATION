import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import { withOptOut } from "@/lib/mail-preflight/opt-out";
import { demoFor, demoForProposal } from "./demo-links";
import { judgeMail, PASS_SCORE, type JudgeVerdict } from "./judge";
import { checkMail, type RuleResult } from "./rules";
import { ctaFor, type MailParts } from "./template";
import { allowedFamilies, assembleFamily, demoTextOf, familyFor, subjectArmFor, type MailFamily } from "./families";
import { buildWriterPrompt, parseParts } from "./writer";
import { avecAllowed, mailReadiness } from "./readiness";
import type { SubjectArm } from "./experiment";

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
  /** Clichés de fin des autres mails du jour : on varie. */
  usedCliches?: readonly string[];
  /** Brouillons déjà écrits aujourd'hui, et combien ouvrent sur « Avec ». */
  dayOpenings?: { total: number; avec: number };
  /** Expérience n° 1 : bras du style d'objet (défaut : celui du prospect). */
  subjectArm?: SubjectArm;
  /** Site connu : sans lui, « profil insuffisant » dit qu'il n'y a rien à lire. */
  website?: string | null;
  /** Expérience n° 2 : famille imposée (défaut : hachage parmi les familles permises). */
  family?: MailFamily;
  /** Secteur, pour F2 et F4 quand le profil est mince. */
  sector?: string | null;
}

export interface QualityAttempt {
  parts: MailParts;
  /** Corps complet : mention « stop » et signature comprises. */
  body: string;
  rules: RuleResult;
  verdict: JudgeVerdict | null;
  /** Démo retenue pour cet essai. */
  demo?: string;
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
  /** Expérience n° 1 (en pause) : style d'objet, qui suit désormais la famille. */
  subjectStyle: SubjectArm;
  /** Expérience n° 2 : famille du mail. */
  family: MailFamily;
  history: QualityAttempt[];
}

const rank = (attempt: QualityAttempt) => (attempt.rules.ok ? 100 : 0) - attempt.rules.failures.length + (attempt.verdict?.score ?? 0);

/** Pas de mail : la fiche part en « À revoir » avec cette raison, sans appel payant. */
export type QualityBlocked = { blocked: string };

export async function generateQualityDraft(input: QualityInput): Promise<QualityOutcome | QualityBlocked | { error: string }> {
  const ready = mailReadiness({ facts: input.facts, brief: input.brief, hasSite: Boolean(input.website), companyName: input.companyName });
  /*
   * ROUTAGE selon la donnée (05/10/2026) : sans fait vérifié solide (« pain
   * incertain », profil mince), plus de blocage sec — F2 ou F4, qui
   * n'exigent que l'activité et le secteur. Sans même l'activité : bloqué.
   */
  if (!ready.ok && !input.activity?.trim()) return { blocked: ready.reason };
  const own = ready.ok ? ready.own : [];
  const allowed = allowedFamilies(ready.ok);
  const family = input.family && allowed.includes(input.family) ? input.family : familyFor(input.prospectId, allowed);
  const demo = demoFor(`${input.brief.pain.task} ${input.brief.pain.automationIdea}`);
  // Expérience n° 1 en pause : l'objet suit la famille.
  const arm = input.subjectArm ?? subjectArmFor(family);
  const cta = ctaFor(input.prospectId);
  const facts = briefFacts(input.brief, input.facts);
  // Le juge voit les MÊMES faits que le rédacteur : faits du brief + faits
  // propres (site, profil). Sinon il tient pour « supposé » ce qui est lu sur
  // le site (AGCEI, itération 2 : « bobines et transformateurs » notés 6/10).
  const factText = [...new Set([...facts, ...own])].map((fact) => `- ${fact.label} : ${fact.value}`).join("\n");
  const history: QualityAttempt[] = [];
  let feedback: string | null = null;

  for (let attempt = 0; attempt <= MAX_REWRITES; attempt += 1) {
    const raw = await input.ask(
      "writer",
      buildWriterPrompt({ brief: input.brief, facts, own, activity: input.activity, sector: input.sector, companyName: input.companyName, demo, greeting: input.greeting, cta, usedCliches: input.usedCliches, avoidAvec: !avecAllowed(input.dayOpenings), subjectArm: arm, feedback, family }),
      `${feedback ? "Réécris" : "Écris"} l'accroche, la proposition et l'objet pour ${input.companyName}.`,
      feedback ? 0.6 : 0.8,
      `qualite:redaction${feedback ? ":rewrite" : ""}`,
    ).catch(() => "");
    const parts = parseParts(raw, family);
    if (!parts) {
      feedback = "La réponse n'était pas le JSON demandé : {\"subject\",\"hook\",\"proposal\"}.";
      continue;
    }
    // La démo suit ce que le mail DIT (AGCEI, itération 2 : mail sur les devis,
    // démo e-mails choisie d'après un pain « stocks »). Repli : le pain du brief.
    // La démo illustre la phrase « J'automatise… » d'abord, puis l'objet et
    // l'accroche, puis le pain du brief (finition Cowork : SPI ENERGIE).
    const fromProposal = demoForProposal(demoTextOf(family, parts));
    const fromText = demoFor(`${parts.subject} ${parts.hook}`);
    const chosen = fromProposal.key !== "general" ? fromProposal : fromText.key !== "general" ? fromText : demo;
    const core = assembleFamily(family, parts, { greeting: input.greeting, demo: chosen, cta });
    const rules = checkMail(parts, core, {
      greeting: input.greeting,
      facts,
      prospectText: input.prospectText,
      companyName: input.companyName,
      forbiddenNames: input.forbiddenNames,
      offerNumbers: input.offerNumbers,
      usedCliches: input.usedCliches,
      demo: chosen.key,
      subjectArm: arm,
      dayOpenings: input.dayOpenings,
      family,
    });
    // Le juge ne note qu'un mail qui passe le garde-fou : inutile de payer pour
    // une note que la règle a déjà tranchée.
    const verdict = rules.ok
      ? await judgeMail(input.ask, { subject: parts.subject, body: core, company: input.companyName, facts: factText, family }, `qualite:juge:${attempt}`)
      : null;
    const body = withOptOut(`${core}\n\n${input.signature}`, input.signature);
    history.push({ parts, body, rules, verdict, demo: chosen.path });
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
    demo: best.demo ?? demo.path,
    subjectStyle: arm,
    family,
    history,
  };
}

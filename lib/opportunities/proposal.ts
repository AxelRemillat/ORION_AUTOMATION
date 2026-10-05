import type { AskFn } from "@/lib/ai/chat";
import { countWords } from "@/lib/emails/quality/template";
import { DEMO_LINKS, type DemoLink } from "@/lib/emails/quality/demo-links";
import { opportunityDemoUrl } from "./analyze";
import { PROPOSAL_NEGATIVES, PROPOSAL_POSITIVES } from "./calibration";
import type { Language, Platform } from "./types";

/**
 * PROPOSITION pour une annonce freelance — même principe que les mails :
 *
 *   rédaction (le modèle écrit les morceaux) → assemblage par le code (lien de
 *   démo suivi `&src=<plateforme>`, signature) → règles déterministes → juge
 *   (≥ 9) → jusqu'à 2 réécritures avec la critique → meilleur essai gardé.
 *
 * FR pour Codeur, ComeUp, Malt ; EN pour Upwork. 120 à 180 mots, signature
 * non comprise. Rien n'est envoyé : Axel copie la proposition lui-même.
 */

export const PROPOSAL_PASS = 9;
export const PROPOSAL_REWRITES = 2;
export const PROPOSAL_WORDS = { min: 120, max: 180 } as const;

export interface ProposalParts {
  /** Reformulation précise du besoin (montre qu'on a lu). */
  reading: string;
  /** Approche en trois étapes concrètes. */
  steps: string[];
  /** Délai et fourchette de prix — ou question de cadrage si le budget est absent. */
  framing: string;
  /** Une question pour qualifier. */
  question: string;
}

export interface ProposalInput {
  ask: AskFn;
  platform: Platform;
  language: Language;
  title: string;
  body: string;
  budget: string | null;
  need: string;
  demo: DemoLink["key"];
  signature: string;
}

export interface ProposalOutcome {
  text: string;
  score: number | null;
  needsReview: boolean;
  reason: string | null;
  attempts: number;
}

const DEMO_LINE: Record<Language, string> = {
  fr: "Une démo d'un cas proche, testable en une minute :",
  en: "A one-minute demo of a similar case:",
};

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps de la proposition (sans signature), puis la signature. */
export function assembleProposal(parts: ProposalParts, frame: { language: Language; demo: DemoLink["key"]; platform: Platform; signature: string }): { core: string; text: string } {
  const steps = parts.steps.map((step, index) => `${index + 1}. ${clean(step).replace(/^\d+[.)]\s*/, "")}`).join("\n");
  const core = [clean(parts.reading), steps, `${DEMO_LINE[frame.language]} ${opportunityDemoUrl(frame.demo, frame.platform)}`, clean(parts.framing), clean(parts.question)].join("\n\n");
  return { core, text: `${core}\n\n${frame.signature.trim()}` };
}

// --- Règles déterministes -----------------------------------------------------

/** Expérience, clients ou résultats inventés : rien de tout ça n'est prouvé dans l'annonce. */
export const INVENTED_CLAIMS =
  /(mes clients|nos clients|j['’]ai (déjà )?(accompagné|aidé|réalisé|livré|travaillé pour)|ans d['’]exp[ée]rience|plus de \d+ (projets|clients|missions)|\d+\s?%|\bmy clients\b|\bour clients\b|\bI have (already )?(helped|delivered|built|worked with)|years of experience|\d+\+? (projects|clients)|track record|proven)/i;
export const FLATTERY = /(super projet|beau projet|projet passionnant|projet (tr[èe]s )?int[ée]ressant|excellent projet|ravi de|great project|exciting project|amazing|impressive|love this project|perfect fit)/i;
export const PROPOSAL_JARGON =
  /\b(workflow|pipeline|synergie|levier|disruptif|scalable|best practices|leverage|synergy|cutting-edge|state-of-the-art|seamless|end-to-end|robust solution|game[- ]changer)\b/i;
const MONEY = /(\d[\d\s.,]*\s?(€|eur|euros?|\$|usd|k€))|((€|\$)\s?\d)/i;
const FRENCH_MARKERS = /\b(le|les|des|une|pour|vous|nous|avec)\b/gi;

export interface ProposalRules {
  ok: boolean;
  failures: string[];
}

export function checkProposal(parts: ProposalParts, core: string, context: { language: Language; budget: string | null }): ProposalRules {
  const failures: string[] = [];
  const written = [parts.reading, ...parts.steps, parts.framing, parts.question].join("\n");
  const words = countWords(core);
  if (words < PROPOSAL_WORDS.min || words > PROPOSAL_WORDS.max) {
    failures.push(`${words} mots : la proposition fait ${PROPOSAL_WORDS.min} à ${PROPOSAL_WORDS.max} mots (signature non comprise).`);
  }
  if (parts.steps.length !== 3) failures.push(`Approche en ${parts.steps.length} étape(s) : exactement trois étapes concrètes.`);
  if (!parts.reading.trim()) failures.push("Reformulation du besoin absente : reprends précisément ce que demande l'annonce.");
  if (!parts.question.trim().endsWith("?")) failures.push("Il faut UNE question pour qualifier, qui finit par « ? ».");
  const questions = (written.match(/\?/g) ?? []).length;
  const allowed = context.budget?.trim() ? 1 : 2;
  if (questions > allowed) failures.push(`${questions} questions : ${allowed === 1 ? "une seule (la question pour qualifier)" : "deux au plus (cadrage du budget, puis qualification)"}.`);
  const invented = written.match(INVENTED_CLAIMS);
  if (invented) failures.push(`Expérience, clients ou résultat non prouvés (« ${invented[0]} ») : retire-le, parle de ce qui sera fait.`);
  const flattery = written.match(FLATTERY);
  if (flattery) failures.push(`Flatterie (« ${flattery[0]} ») : va droit au besoin.`);
  const jargon = written.match(PROPOSAL_JARGON);
  if (jargon) failures.push(`Jargon (« ${jargon[0]} ») : dis-le avec des mots simples.`);
  if (!context.budget?.trim() && MONEY.test(parts.framing)) {
    failures.push("Budget absent de l'annonce : pas de prix, pose une question de cadrage (volume, délai, outils).");
  }
  if (/https?:\/\/|www\.|axelremillat/i.test(written)) failures.push("Aucune URL dans le texte : le lien de démo est posé par le code.");
  if (context.language === "en" && (written.match(FRENCH_MARKERS) ?? []).length > 3) failures.push("La proposition doit être entièrement en anglais (Upwork).");
  return { ok: failures.length === 0, failures };
}

// --- Rédacteur -----------------------------------------------------------------

export function buildProposalPrompt(input: Omit<ProposalInput, "ask" | "signature">, feedback: string | null): string {
  const fr = input.language === "fr";
  const budget = input.budget?.trim();
  return `Tu rédiges, à la place d'Axel Remillat (indépendant en IA et automatisation de tâches pour les PME), la réponse à une annonce publiée sur ${input.platform}.
Langue de la réponse : ${fr ? "FRANÇAIS, vouvoiement" : "ENGLISH, plain and direct"}.

LA RÉPONSE FINALE AURA EXACTEMENT CETTE FORME (le code ajoute le lien et la signature) :
<READING — 2 phrases>

1. <STEP 1>
2. <STEP 2>
3. <STEP 3>

${DEMO_LINE[input.language]} <lien vers la démo « ${DEMO_LINKS[input.demo].label} »>

<FRAMING — 1 ou 2 phrases>

<QUESTION — 1 phrase>

À ÉCRIRE :
- "reading" : la reformulation PRÉCISE du besoin, avec les éléments concrets de l'annonce (outil, volume, type de documents, résultat attendu). Montre qu'on a lu. Jamais « j'ai bien lu votre annonce ».
- "steps" : TROIS étapes concrètes et courtes (12 à 22 mots chacune) : ce qui sera fait, dans l'ordre, avec leurs outils.
- "framing" : ${budget ? `un délai réaliste et une fourchette de prix cohérente avec le budget annoncé (${budget}).` : "AUCUN PRIX (le budget n'est pas donné) : une question de cadrage (volume, outils, délai) pour pouvoir chiffrer, plus un délai indicatif."}
- "question" : UNE question pour qualifier le besoin (ce qui conditionne la solution), qui finit par « ? ».

INTERDITS : expérience, clients ou références inventés (« j'ai déjà aidé… », « mes clients »), chiffres de résultats non prouvés (« -50 % de temps »), flatterie (« super projet »), jargon (workflow, pipeline, leverage, seamless…), toute URL, toute signature.
La réponse complète (sans la signature) fait ${PROPOSAL_WORDS.min} à ${PROPOSAL_WORDS.max} mots.

EXEMPLES ATTENDUS (autres annonces — n'en reprends aucune phrase) :
${PROPOSAL_POSITIVES.filter((item) => item.language === input.language)
  .slice(0, 1)
  .map((item) => item.text)
  .join("\n\n")}${feedback ? `\n\nRÉÉCRITURE — la version précédente avait ces défauts, corrige-les tous :\n${feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"reading":"…","steps":["…","…","…"],"framing":"…","question":"…"}`;
}

export function parseProposalParts(raw: string): ProposalParts | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  const steps = Array.isArray(value.steps) ? value.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).map((step) => step.trim()) : [];
  const parts = { reading: text("reading"), steps, framing: text("framing"), question: text("question") };
  return parts.reading && steps.length && parts.question ? parts : null;
}

// --- Juge ----------------------------------------------------------------------

export const PROPOSAL_GRID = [
  { id: "lecture", points: 3, rule: "La reformulation reprend les éléments CONCRETS de l'annonce (outil, volume, documents, résultat attendu) : on voit qu'elle a été lue. 3 = précise. 1 = générique (« automatiser vos tâches »). 0 = hors sujet." },
  { id: "approche", points: 3, rule: "Trois étapes concrètes, dans l'ordre, liées au besoin (ce qui sera fait, avec quels outils). 3 = un client sait ce qu'il achète. 1 = vague. 0 = jargon ou liste creuse." },
  { id: "cadrage", points: 2, rule: "Délai et fourchette cohérents avec le budget annoncé, ou — sans budget — une question de cadrage utile ; et une question de qualification qui conditionne vraiment la solution. 2 = utiles. 1 = convenues. 0 = absentes ou prix sans budget." },
  { id: "ton", points: 2, rule: "Direct, poli, sans flatterie, sans jargon, sans expérience ni résultat inventés. 2 = on croirait un indépendant sérieux. 0 = flatterie, promesse chiffrée ou références inventées." },
] as const;

export interface ProposalVerdict {
  score: number;
  reasons: string[];
  fix: string | null;
}

export function buildProposalJudgePrompt(): string {
  const grid = PROPOSAL_GRID.map((criterion) => `- ${criterion.id} (${criterion.points} pt) : ${criterion.rule}`).join("\n");
  const positives = PROPOSAL_POSITIVES.slice(0, 2).map((item) => `[${item.platform}] ${item.title}\n${item.text}`).join("\n\n");
  const negatives = PROPOSAL_NEGATIVES.map((item) => `- ${item.why}`).join("\n");
  return `Tu relis la réponse qu'un indépendant (IA et automatisation pour PME) va poster sur une plateforme freelance.
La forme est vérifiée par un programme (longueur, lien de démo, signature) : ne la reproche pas. Note le FOND sur 10 :
${grid}

Seuil : 9/10 = à poster telle quelle. Une réponse correcte mais générique vaut 6 ou 7.

RÉFÉRENCES — 9 ou plus :
${positives}

DÉFAUTS À SANCTIONNER (sous 9) :
${negatives}

Réponds UNIQUEMENT en JSON : {"criteria":{"lecture":0-3,"approche":0-3,"cadrage":0-2,"ton":0-2},"reasons":["…"],"fix":"consigne précise, ou null si 9 ou plus"}`;
}

export function parseProposalVerdict(raw: string): ProposalVerdict | null {
  let value: { criteria?: Record<string, unknown>; reasons?: unknown; fix?: unknown };
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  let score = 0;
  for (const criterion of PROPOSAL_GRID) {
    const points = Number(value.criteria?.[criterion.id]);
    score += Number.isFinite(points) ? Math.max(0, Math.min(criterion.points, points)) : 0;
  }
  const reasons = Array.isArray(value.reasons) ? value.reasons.filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 5) : [];
  const fix = typeof value.fix === "string" && value.fix.trim() ? value.fix.trim() : null;
  return { score: Math.round(score * 10) / 10, reasons, fix };
}

export async function judgeProposal(ask: AskFn, input: { title: string; body: string; budget: string | null; text: string }, operation = "opportunites:juge"): Promise<ProposalVerdict | null> {
  const raw = await ask(
    "judge",
    buildProposalJudgePrompt(),
    `ANNONCE — ${input.title} (budget : ${input.budget || "non indiqué"})\n${input.body.slice(0, 4000)}\n\nRÉPONSE À NOTER :\n${input.text}`,
    0,
    operation,
  ).catch(() => "");
  return parseProposalVerdict(raw);
}

// --- Boucle ----------------------------------------------------------------------

interface Attempt {
  text: string;
  rules: ProposalRules;
  verdict: ProposalVerdict | null;
}

const rank = (attempt: Attempt) => (attempt.rules.ok ? 100 : 0) - attempt.rules.failures.length + (attempt.verdict?.score ?? 0);

export async function generateProposal(input: ProposalInput): Promise<ProposalOutcome | { error: string }> {
  const attempts: Attempt[] = [];
  let feedback: string | null = null;
  for (let round = 0; round <= PROPOSAL_REWRITES; round += 1) {
    const raw = await input.ask(
      "writer",
      buildProposalPrompt(input, feedback),
      `${feedback ? "Réécris" : "Écris"} la réponse à l'annonce « ${input.title} ».\n\nANNONCE :\n${input.body.slice(0, 6000)}\n\nBesoin reformulé par l'analyse : ${input.need}`,
      feedback ? 0.5 : 0.7,
      `opportunites:redaction${feedback ? ":rewrite" : ""}`,
    ).catch(() => "");
    const parts = parseProposalParts(raw);
    if (!parts) {
      feedback = 'La réponse n\'était pas le JSON demandé : {"reading","steps":[3],"framing","question"}.';
      continue;
    }
    const { core, text } = assembleProposal(parts, { language: input.language, demo: input.demo, platform: input.platform, signature: input.signature });
    const rules = checkProposal(parts, core, { language: input.language, budget: input.budget });
    // Le juge ne note qu'une proposition qui passe les règles.
    const verdict = rules.ok ? await judgeProposal(input.ask, { title: input.title, body: input.body, budget: input.budget, text: core }, `opportunites:juge:${round}`) : null;
    attempts.push({ text, rules, verdict });
    if (rules.ok && verdict && verdict.score >= PROPOSAL_PASS) break;
    feedback = rules.ok
      ? [`Note du relecteur : ${verdict?.score ?? "?"}/10.`, ...(verdict?.reasons ?? []).map((line) => `- ${line}`), verdict?.fix ? `Consigne : ${verdict.fix}` : ""].filter(Boolean).join("\n")
      : rules.failures.map((line) => `- ${line}`).join("\n");
  }
  if (!attempts.length) return { error: "Proposition inexploitable : le rédacteur n'a rendu aucun texte utilisable." };
  const best = [...attempts].sort((a, b) => rank(b) - rank(a))[0];
  const score = best.verdict?.score ?? null;
  const passed = best.rules.ok && score !== null && score >= PROPOSAL_PASS;
  return {
    text: best.text,
    score,
    needsReview: !passed,
    reason: passed ? null : !best.rules.ok ? best.rules.failures[0] : score === null ? "Relecture automatique indisponible : à relire." : `Note ${score}/10 : ${best.verdict?.reasons[0] ?? "sous le seuil de 9"}`,
    attempts: attempts.length,
  };
}

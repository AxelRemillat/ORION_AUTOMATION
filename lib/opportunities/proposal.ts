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
/**
 * Codeur, Malt, ComeUp : le champ « Message privé » de Codeur est limité à
 * 1 000 caractères (signature comprise) — la proposition y tient : 80 à 140 mots.
 */
export const PRIVATE_MESSAGE_MAX_CHARS = 1000;
export const SHORT_PROPOSAL_WORDS = { min: 80, max: 140 } as const;
const wordsFor = (platform: Platform | undefined) => (platform && ["codeur", "malt", "comeup"].includes(platform) ? SHORT_PROPOSAL_WORDS : PROPOSAL_WORDS);

export interface ProposalParts {
  /** Reformulation précise du besoin (montre qu'on a lu). */
  reading: string;
  /** Approche en trois étapes concrètes. */
  steps: string[];
  /** Délai et fourchette de prix — ou question de cadrage si le budget est absent. */
  framing: string;
  /** Une question pour qualifier. */
  question: string;
  /** Montant et délai à saisir dans le formulaire de la plateforme (Codeur les demande). */
  amountEur?: number | null;
  delayDays?: number | null;
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
}

export interface ProposalOutcome {
  text: string;
  score: number | null;
  needsReview: boolean;
  reason: string | null;
  attempts: number;
  /** Montant (€) et délai (jours) suggérés pour le formulaire de la plateforme. */
  amountEur: number | null;
  delayDays: number | null;
}

const DEMO_LINE: Record<Language, string> = {
  fr: "Une démo d'un cas proche, testable en une minute :",
  en: "A one-minute demo of a similar case:",
};

/**
 * CODEUR, MALT, COMEUP (Cowork, 05/10/2026) : ces plateformes interdisent tout
 * moyen de contact hors plateforme (Codeur : suppression du compte sans
 * recours). Aucune URL, aucun e-mail, aucun téléphone, aucun lien de
 * rendez-vous : la démo est désignée par le TITRE EXACT d'une réalisation du
 * portfolio, et la signature est le nom seul.
 */
export const NO_CONTACT_PLATFORMS: readonly Platform[] = ["codeur", "malt", "comeup"];
export const isNoContactPlatform = (platform: Platform) => NO_CONTACT_PLATFORMS.includes(platform);

/** Titres EXACTS des réalisations du portfolio (Codeur). */
export const PORTFOLIO_TITLES = [
  "Agent IA de devis par métier",
  "Tri automatique des e-mails entrants",
  "Extraction automatique de factures",
  "ORION : application de prospection B2B par IA",
] as const;
export type PortfolioTitle = (typeof PORTFOLIO_TITLES)[number];

const EMAIL_NEED = /e-?mails?|courriels?|gmail|outlook|bo[iî]te (de r[ée]ception|mail)|\bmails?\b/i;

/**
 * Réalisation à citer pour une démo, ou `null` : un fichier clients à
 * nettoyer n'est illustré par aucune réalisation — sauf le tri des e-mails
 * quand le besoin passe par l'e-mail. ORION n'illustre pas le nettoyage.
 */
export function portfolioTitle(demo: DemoLink["key"], context = ""): PortfolioTitle | null {
  switch (demo) {
    case "devis":
      return "Agent IA de devis par métier";
    case "factures":
      return "Extraction automatique de factures";
    case "fichier":
      return EMAIL_NEED.test(context) ? "Tri automatique des e-mails entrants" : null;
    default:
      return "Tri automatique des e-mails entrants";
  }
}

const PLATFORM_NAMES: Partial<Record<Platform, string>> = { codeur: "Codeur", malt: "Malt", comeup: "ComeUp" };

/**
 * Signature par plateforme : nom seul là où le contact hors plateforme est
 * interdit ; Upwork sans site (lien de contact avant contrat déconseillé),
 * en anglais ; jamais de téléphone ni d'e-mail.
 */
export function proposalSignature(platform: Platform, language: Language): string {
  if (isNoContactPlatform(platform)) return "Axel Remillat";
  if (platform === "upwork" || language === "en") return "Axel Remillat · AI & automation for small businesses";
  return "Axel Remillat · Automatisation & IA pour PME · axelremillat.com/pme";
}

/** La ligne de démo : titre du portfolio (plateformes sans contact), lien suivi ailleurs ; `null` = aucune démo citée. */
export function demoLine(platform: Platform, language: Language, demo: DemoLink["key"], context = ""): string | null {
  if (isNoContactPlatform(platform)) {
    const title = portfolioTitle(demo, context);
    return title ? `Une démo d'un cas proche est visible dans mon portfolio ${PLATFORM_NAMES[platform]} (${title}).` : null;
  }
  return `${DEMO_LINE[language]} ${opportunityDemoUrl(demo, platform)}`;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps de la proposition (sans signature), puis la signature de la plateforme. */
export function assembleProposal(
  parts: ProposalParts,
  frame: { language: Language; demo: DemoLink["key"]; platform: Platform; context?: string },
): { core: string; text: string } {
  const steps = parts.steps.map((step, index) => `${index + 1}. ${clean(step).replace(/^\d+[.)]\s*/, "")}`).join("\n");
  const demo = demoLine(frame.platform, frame.language, frame.demo, frame.context ?? parts.reading);
  const core = [clean(parts.reading), steps, demo, clean(parts.framing), clean(parts.question)].filter((block): block is string => Boolean(block)).join("\n\n");
  return { core, text: `${core}\n\n${proposalSignature(frame.platform, frame.language)}` };
}

// --- Coordonnées : interdites partout, toute URL interdite sur Codeur, Malt, ComeUp ---

export const CONTACT_EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
export const CONTACT_PHONE = /(\+\d{2,3}[\s.-]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
export const CALENDAR_LINK = /(calendly|cal\.com|zcal|savvycal|tidycal|youcanbook|prendre (un )?rendez-vous (sur|via)|book (a call|a meeting) (here|on|via))/i;
export const ANY_URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|io|net|org|app|dev|ai|eu|co|me|pro|biz)\b)/i;

/** Coordonnées dans le texte FINAL (signature comprise) : refus selon la plateforme. */
export function contactFailures(text: string, platform: Platform): string[] {
  const failures: string[] = [];
  const email = text.match(CONTACT_EMAIL);
  if (email) failures.push(`Adresse e-mail (« ${email[0]} ») : aucune coordonnée dans une proposition.`);
  const phone = text.match(CONTACT_PHONE);
  if (phone) failures.push(`Téléphone (« ${phone[0]} ») : aucune coordonnée dans une proposition.`);
  const calendar = text.match(CALENDAR_LINK);
  if (calendar) failures.push(`Lien de prise de rendez-vous (« ${calendar[0]} ») : interdit.`);
  if (isNoContactPlatform(platform)) {
    const url = text.match(ANY_URL);
    if (url) failures.push(`${PLATFORM_NAMES[platform]} : aucune URL (« ${url[0]} ») — la plateforme interdit tout moyen de contact hors plateforme ; la démo est citée par son titre de portfolio.`);
  }
  return failures;
}

/**
 * Repères de prix CODEUR (profil d'Axel) : 45 €/h ; prix de lancement 300–600 €
 * (tâche simple) et 600–1 200 € (workflow complet). Au-delà, seulement si la
 * complexité est dite dans la phrase.
 */
export const CODEUR_LAUNCH_MAX_EUR = 1200;
const COMPLEXITY = /(selon|complexit|plusieurs|vari[ée]t[ée]|nombre de|volume|int[ée]grations?|formats?)/i;
const euroAmounts = (text: string) =>
  [...text.matchAll(/(\d[\d\s.]*\d|\d)\s?(€|eur|euros?)/gi)].map((match) => Number(match[1].replace(/[\s.]/g, ""))).filter((value) => Number.isFinite(value));

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

export function checkProposal(
  parts: ProposalParts,
  core: string,
  context: { language: Language; budget: string | null; platform?: Platform },
  text: string = core,
): ProposalRules {
  const failures: string[] = [];
  const platform = context.platform ?? "autre";
  failures.push(...contactFailures(text, platform));
  if (platform === "codeur" && context.budget?.trim()) {
    const top = Math.max(0, ...euroAmounts(parts.framing));
    if (top > CODEUR_LAUNCH_MAX_EUR && !COMPLEXITY.test(parts.framing)) {
      failures.push(`Codeur : ${top} € dépasse les prix de lancement (300–600 € simple, 600–1 200 € workflow complet) sans dire pourquoi — vise la fourchette de lancement, ou justifie par la complexité.`);
    }
  }
  const written = [parts.reading, ...parts.steps, parts.framing, parts.question].join("\n");
  const words = countWords(core);
  const limits = wordsFor(context.platform);
  if (words < limits.min || words > limits.max) {
    failures.push(`${words} mots : la proposition fait ${limits.min} à ${limits.max} mots (signature non comprise).`);
  }
  if (isNoContactPlatform(platform) && text.length > PRIVATE_MESSAGE_MAX_CHARS) {
    failures.push(`${text.length} caractères : le message privé Codeur est limité à ${PRIVATE_MESSAGE_MAX_CHARS} (signature comprise). Retire environ ${text.length - PRIVATE_MESSAGE_MAX_CHARS + 40} caractères.`);
  }
  if (platform === "codeur" && parts.amountEur != null && parts.amountEur > CODEUR_LAUNCH_MAX_EUR && !COMPLEXITY.test(parts.framing)) {
    failures.push(`Montant suggéré ${parts.amountEur} € au-dessus des prix de lancement Codeur (≤ 1 200 €) sans raison dite dans la proposition.`);
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
  if (/mon portfolio|d[ée]mo d['’]un cas proche|one-minute demo/i.test(written)) failures.push("La ligne de démo est posée par le code : ne la répète pas dans le texte.");
  if (context.language === "en" && (written.match(FRENCH_MARKERS) ?? []).length > 3) failures.push("La proposition doit être entièrement en anglais (Upwork).");
  return { ok: failures.length === 0, failures };
}

// --- Rédacteur -----------------------------------------------------------------

export function buildProposalPrompt(input: Omit<ProposalInput, "ask" | "signature">, feedback: string | null): string {
  const fr = input.language === "fr";
  const budget = input.budget?.trim();
  return `Tu rédiges, à la place d'Axel Remillat (indépendant en IA et automatisation de tâches pour les PME), la réponse à une annonce publiée sur ${input.platform}.
Langue de la réponse : ${fr ? "FRANÇAIS, vouvoiement" : "ENGLISH, plain and direct"}.

LA RÉPONSE FINALE AURA EXACTEMENT CETTE FORME (le code ajoute la ligne de démo et la signature) :
<READING — 2 phrases>

1. <STEP 1>
2. <STEP 2>
3. <STEP 3>

${isNoContactPlatform(input.platform) ? "<LIGNE DE DÉMO — posée par le code : le titre d'une réalisation du portfolio. Ne l'écris pas, ne la répète pas.>" : `${DEMO_LINE[input.language]} <lien vers la démo « ${DEMO_LINKS[input.demo].label} »>`}

<FRAMING — 1 ou 2 phrases>

<QUESTION — 1 phrase>

À ÉCRIRE :
- "reading" : la reformulation PRÉCISE du besoin, avec les éléments concrets de l'annonce (outil, volume, type de documents, résultat attendu). Montre qu'on a lu. Jamais « j'ai bien lu votre annonce ».
- "steps" : TROIS étapes concrètes et courtes (12 à 22 mots chacune) : ce qui sera fait, dans l'ordre, avec leurs outils.
- "framing" : ${budget ? `un délai réaliste et une fourchette de prix cohérente avec le budget annoncé (${budget})${input.platform === "codeur" ? ` ET avec les repères du profil Codeur : 45 €/h, prix de lancement 300–600 € pour une tâche simple, 600–1 200 € pour un workflow complet. Au-delà de 1 200 €, seulement si la complexité le justifie, et dis pourquoi dans la phrase` : ""}.` : "AUCUN PRIX (le budget n'est pas donné) : une question de cadrage (volume, outils, délai) pour pouvoir chiffrer, plus un délai indicatif."}
- "question" : UNE question pour qualifier le besoin (ce qui conditionne la solution), qui finit par « ? ».

INTERDITS : expérience, clients ou références inventés (« j'ai déjà aidé… », « mes clients »), chiffres de résultats non prouvés (« -50 % de temps »), flatterie (« super projet »), jargon (workflow, pipeline, leverage, seamless…), toute URL, toute adresse e-mail, tout téléphone, tout lien de prise de rendez-vous, toute signature.${isNoContactPlatform(input.platform) ? " Sur cette plateforme, aucun moyen de contact hors plateforme : ni site, ni lien, ni coordonnée." : ""}
${isNoContactPlatform(input.platform)
  ? `La réponse complète fait ${SHORT_PROPOSAL_WORDS.min} à ${SHORT_PROPOSAL_WORDS.max} mots et MOINS DE 1 000 CARACTÈRES signature comprise (limite du message privé) — budget : "reading" 25 à 35 mots, chaque étape 10 à 15 mots, "framing" 12 à 20 mots, "question" 10 à 15 mots.`
  : `La réponse complète (sans la signature) fait ${PROPOSAL_WORDS.min} à ${PROPOSAL_WORDS.max} mots — budget : "reading" 40 à 55 mots, chaque étape 14 à 20 mots, "framing" 20 à 30 mots, "question" 12 à 20 mots.`}
- "amount_eur" et "delay_days" : le montant (nombre, en euros) et le délai (nombre de jours) à saisir dans le formulaire de la plateforme${input.platform === "codeur" ? " — repères Codeur : 300–600 € tâche simple, 600–1 200 € workflow complet, 45 €/h" : ""}${budget ? `, dans le budget annoncé (${budget})` : ", même sans budget annoncé (montant indicatif de lancement)"}.

EXEMPLES ATTENDUS (autres annonces — n'en reprends aucune phrase) :
${PROPOSAL_POSITIVES.filter((item) => item.language === input.language)
  .slice(0, 1)
  .map((item) => item.text)
  .join("\n\n")}${feedback ? `\n\nRÉÉCRITURE — la version précédente avait ces défauts, corrige-les tous :\n${feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"reading":"…","steps":["…","…","…"],"framing":"…","question":"…","amount_eur":0,"delay_days":0}`;
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
  const number = (key: string) => {
    const amount = Number(value[key]);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
  };
  const parts = { reading: text("reading"), steps, framing: text("framing"), question: text("question"), amountEur: number("amount_eur"), delayDays: number("delay_days") };
  return parts.reading && steps.length && parts.question ? parts : null;
}

// --- Juge ----------------------------------------------------------------------

export const PROPOSAL_GRID = [
  { id: "lecture", points: 3, rule: "La reformulation reprend les éléments CONCRETS de l'annonce (outil, volume, documents, résultat attendu) : on voit qu'elle a été lue. 3 = précise. 1 = générique (« automatiser vos tâches »). 0 = hors sujet." },
  { id: "approche", points: 3, rule: "Trois étapes concrètes, dans l'ordre, liées au besoin (ce qui sera fait, avec quels outils). 3 = un client sait ce qu'il achète. 1 = vague. 0 = jargon ou liste creuse." },
  { id: "cadrage", points: 2, rule: "Délai et fourchette cohérents avec le budget annoncé (sur Codeur, avec les repères du profil : 45 €/h, 300–600 € tâche simple, 600–1 200 € workflow complet ; au-delà seulement si la complexité est dite), ou — sans budget — une question de cadrage utile ; et une question de qualification qui conditionne vraiment la solution. 2 = utiles. 1 = convenues ou prix au-dessus des repères sans raison. 0 = absentes ou prix sans budget." },
  { id: "ton", points: 2, rule: "Direct, poli, sans flatterie, sans jargon, sans expérience ni résultat inventés, sans coordonnées. 2 = on croirait un indépendant sérieux. 0 = flatterie, promesse chiffrée, références inventées, ou — sur CODEUR, MALT ou COMEUP — la moindre URL, adresse e-mail ou téléphone (interdits par la plateforme)." },
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
La forme est vérifiée par un programme (longueur, ligne de démo — un titre de portfolio sur Codeur, Malt et ComeUp, où les liens sont interdits, éventuellement absente —, signature) : ne la reproche pas. Note le FOND sur 10 :
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

export async function judgeProposal(
  ask: AskFn,
  input: { title: string; body: string; budget: string | null; text: string; platform?: Platform },
  operation = "opportunites:juge",
): Promise<ProposalVerdict | null> {
  const raw = await ask(
    "judge",
    buildProposalJudgePrompt(),
    `PLATEFORME : ${input.platform ?? "non précisée"}\nANNONCE — ${input.title} (budget : ${input.budget || "non indiqué"})\n${input.body.slice(0, 4000)}\n\nRÉPONSE À NOTER :\n${input.text}`,
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
  parts: ProposalParts;
}

const rank = (attempt: Attempt) => (attempt.rules.ok ? 100 : 0) - attempt.rules.failures.length + (attempt.verdict?.score ?? 0);

export async function generateProposal(input: ProposalInput & { maxRewrites?: number }): Promise<ProposalOutcome | { error: string }> {
  const attempts: Attempt[] = [];
  let feedback: string | null = null;
  for (let round = 0; round <= (input.maxRewrites ?? PROPOSAL_REWRITES); round += 1) {
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
    const { core, text } = assembleProposal(parts, { language: input.language, demo: input.demo, platform: input.platform, context: `${input.need} ${input.body}` });
    const rules = checkProposal(parts, core, { language: input.language, budget: input.budget, platform: input.platform }, text);
    // Le juge ne note qu'une proposition qui passe les règles.
    const verdict = rules.ok ? await judgeProposal(input.ask, { title: input.title, body: input.body, budget: input.budget, text: core, platform: input.platform }, `opportunites:juge:${round}`) : null;
    attempts.push({ text, rules, verdict, parts });
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
    amountEur: best.parts.amountEur ?? null,
    delayDays: best.parts.delayDays ?? null,
  };
}

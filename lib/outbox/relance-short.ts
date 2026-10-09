import type { AskFn } from "@/lib/ai/chat";
import { isOpenAIQuotaError } from "@/lib/ai/quota";
import {
  DEMO_LINK,
  FORBIDDEN,
  IF_CONCERNS,
  introParts,
  NAMELESS_GREETING,
  questionKey,
  RECRUITMENT,
  relanceReason,
  relanceSubject,
  relanceVerdictOf,
  SUPERLATIVE,
  TRANSFER_SENTENCE,
  type RelanceCriterion,
  type RelanceCriterionId,
  type RelanceFiche,
  type RelanceLot,
  type RelanceOutcome,
  type SourcedFact,
} from "./relance-quality";

/**
 * DEUX MODES DE RELANCE (Cowork #16), choisis par le CODE :
 *
 *   A « relance enrichie » (grille R1–R10) : SEULEMENT si la fiche porte au moins un
 *     fait sourcé distinctif (distinctivité ≥ 2) sur le processus de l'intro — il
 *     devient l'ancre de la 1re phrase ;
 *   B « relance courte » sinon : elle n'invente rien et ne prétend rien. 25 à 40
 *     mots : « Je remonte mon message <quand> sur <sujet de l'intro, 5 à 10 mots>. »,
 *     le lien de l'intro, la phrase de transfert si l'adresse est générique, une
 *     question qui varie dans le lot. Grille : R1, R3, R4, R6 (25–40), R7, R9, R10.
 *
 * Le plafond venait de la 1re phrase quand la fiche n'a pas de matière : le modèle
 * inventait une situation floue (LIFTVRAC, BREYNER, ROBIN à 7,5).
 *
 * MODE A DÉSACTIVÉ PAR DÉFAUT (Cowork #17) : à l'étalonnage v5, le mode B atteint
 * 8,5–9 dès que son sujet est simple, le mode A reste fragile (TECHNAMM 7,5, DISTEL 7).
 * Toutes les relances partent donc en mode B. Réversible sans toucher au code :
 * variable d'environnement RELANCE_MODE_A=on (Vercel ou .env.local), ou option
 * `{ modeA: true }` de chooseRelanceMode. À rouvrir avec un vrai jeu d'essai.
 */

export type RelanceMode = "A" | "B";

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Mots trop généraux pour relier un fait au processus de l'intro. */
const GENERIC_WORDS = new Set(
  "suivi suivre traitement traiter gestion gerer demande demandes client clients entreprise service services produit produits controle donnees preparation preparer notamment chaque leurs votre notre votres notres avant apres entre depuis toutes tous rapide rapides rapidement interne internes equipe equipes activite activites informations information mise jour quotidien quotidienne".split(" "),
);

/** Mots de processus d'un texte : mots repliés de 5 lettres ou plus, hors mots généraux, sans « s » final. */
export function processWords(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(" ")
      .filter((word) => word.length >= 5 && !GENERIC_WORDS.has(word))
      .map((word) => word.replace(/s$/, "")),
  );
}

/** Réglage par défaut du mode A (Cowork #17) : coupé. */
export const RELANCE_MODE_A_DEFAULT = false;

/** Mode A autorisé ? RELANCE_MODE_A=on|1|true l'active, off|0|false le coupe, sinon le défaut. */
export function relanceModeAEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.RELANCE_MODE_A ?? "").trim().toLowerCase();
  if (["on", "1", "true", "oui"].includes(value)) return true;
  if (["off", "0", "false", "non"].includes(value)) return false;
  return RELANCE_MODE_A_DEFAULT;
}

export interface ModeChoice {
  mode: RelanceMode;
  /** Mode A : le fait sourcé qui ancre la 1re phrase. */
  anchor: SourcedFact | null;
  reason: string;
}

/**
 * Mode A si un fait sourcé (source_url), distinctif (≥ 2), sans rapport avec le
 * recrutement, partage au moins un mot de processus avec l'intro (objet + corps).
 */
export function chooseRelanceMode(
  fiche: Pick<RelanceFiche, "sourcedFacts">,
  introSubject: string | null,
  introBody: string,
  options: { modeA?: boolean } = {},
): ModeChoice {
  if (!(options.modeA ?? relanceModeAEnabled())) return { mode: "B", anchor: null, reason: "mode A désactivé (réglage RELANCE_MODE_A, Cowork #17) : relance courte pour toutes" };
  const intro = processWords(`${introSubject ?? ""} ${introBody}`);
  const candidates = (fiche.sourcedFacts ?? []).filter((fact) => fact.distinctiveness >= 2 && fact.source_url && !RECRUITMENT.test(`${fact.text} ${fact.process_hint ?? ""}`));
  for (const fact of [...candidates].sort((a, b) => b.distinctiveness - a.distinctiveness)) {
    const shared = [...processWords(`${fact.process_hint ?? ""} ${fact.text}`)].filter((word) => intro.has(word));
    if (shared.length) return { mode: "A", anchor: fact, reason: `fait sourcé (distinctivité ${fact.distinctiveness}) sur le processus de l'intro : ${shared.slice(0, 3).join(", ")}` };
  }
  return {
    mode: "B",
    anchor: null,
    reason: candidates.length ? "faits distinctifs, mais aucun sur le processus de l'intro" : "aucun fait sourcé distinctif (≥ 2) dans la fiche",
  };
}

// --- Mode B : assemblage ------------------------------------------------------------

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Lundi (00 h UTC) de la semaine d'une date. */
const mondayOf = (date: Date) => {
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
};

/** « de lundi » (même semaine), « de la semaine dernière », sinon « du 2 octobre ». */
export function whenSent(sentAt: string | null | undefined, now = new Date()): string {
  if (!sentAt || Number.isNaN(Date.parse(sentAt))) return "précédent";
  const sent = new Date(sentAt);
  const weeks = Math.round((mondayOf(now) - mondayOf(sent)) / (7 * 86_400_000));
  if (weeks === 0) return `de ${DAYS[sent.getUTCDay()]}`;
  if (weeks === 1) return "de la semaine dernière";
  return `du ${sent.getUTCDate() === 1 ? "1er" : sent.getUTCDate()} ${MONTHS[sent.getUTCMonth()]}`;
}

/** Questions de la relance courte, qui tournent dans un lot. */
export const SHORT_QUESTIONS = [
  "Est-ce un sujet chez vous en ce moment ?",
  "Est-ce que ce cas se présente chez vous ?",
  "Dites-moi simplement si c'est un sujet chez vous.",
  "Est-ce une question qui se pose chez vous ?",
  "Est-ce que la question se pose chez vous en ce moment ?",
  "Est-ce un point qui revient souvent chez vous ?",
  "Est-ce que ce sujet se pose aussi chez vous ?",
  "Dites-moi simplement si ce sujet vous parle.",
] as const;

/**
 * Lignes du lien de la relance courte : toujours 5 mots ou plus, sinon les 25 mots
 * minimum sont inatteignables avec un sujet court (AGM INFORMATIQUE, 24 mots, 09/10).
 */
export const SHORT_DEMO_LEADS = ["Exemple testable en une minute :", "À tester en une minute :", "Pour vous faire une idée en une minute :", "Un exemple concret, testable en une minute :"] as const;

function shortDemoLine(link: string, seed: string, longest = false): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${longest ? SHORT_DEMO_LEADS[SHORT_DEMO_LEADS.length - 1] : SHORT_DEMO_LEADS[hash % SHORT_DEMO_LEADS.length]} ${link}`;
}

/** Première question pas encore prise dans le lot (départ variable selon la fiche). */
export function shortQuestion(seed: string, lot?: RelanceLot): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  for (let index = 0; index < SHORT_QUESTIONS.length; index += 1) {
    const question = SHORT_QUESTIONS[(hash + index) % SHORT_QUESTIONS.length];
    if (!lot?.questions.includes(questionKey(question))) return question;
  }
  return SHORT_QUESTIONS[hash % SHORT_QUESTIONS.length];
}

export interface ShortContext {
  greeting: string;
  subject: string;
  demoLink: string | null;
  requireV?: boolean;
  generic: boolean;
  seed: string;
  when: string;
  question: string;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");

export function assembleShortRelance(topic: string, ctx: ShortContext): string {
  const build = (longest: boolean) =>
    [
      ctx.greeting,
      `Je remonte mon message ${ctx.when} sur ${clean(topic)}.`,
      ctx.demoLink ? shortDemoLine(ctx.demoLink, ctx.seed, longest) : null,
      ctx.generic ? TRANSFER_SENTENCE : null,
      ctx.question,
    ]
      .filter((block): block is string => Boolean(block))
      .join("\n\n");
  const body = build(false);
  // Sujet court (4 mots) + « de lundi » : la ligne du lien la plus longue garde les 25 mots minimum.
  return shortProseWords(body) < SHORT_WORDS.min ? build(true) : body;
}

// --- Mode B : grille --------------------------------------------------------------

export const SHORT_WORDS = { min: 25, max: 40 } as const;
/** Sujet : 4 à 8 mots, vocabulaire courant, une seule idée (Cowork #17). */
export const SHORT_TOPIC_WORDS = { min: 4, max: 8 } as const;
export const SHORT_IDS: readonly RelanceCriterionId[] = ["R1", "R3", "R4", "R6", "R7", "R9", "R10"];
const TRANSFER = /(transf[ée]r|faire suivre|bonne personne|suivi par quelqu)/i;
const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** Mots comptés par R6 : tout sauf la salutation, la phrase de transfert et l'URL. */
function shortProseWords(body: string): number {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return countWords(blocks.slice(1).filter((block) => block !== TRANSFER_SENTENCE).join(" ").replace(new RegExp(DEMO_LINK.source, "gi"), " "));
}

/** Sigles assez courants pour un sujet de relance ; tout autre sigle est refusé. */
const COMMON_ACRONYMS = new Set(["PDF", "SMS", "TVA", "SAV", "RH", "PME"]);

/**
 * Sujet lisible par tous (Cowork #17, DON FOSTER « acier 15CDV6 ») : ni code produit ou
 * référence (lettres et chiffres mêlés, chiffres), ni sigle peu courant, une seule idée
 * (pas de « et », « ainsi que », virgule, point-virgule). `null` si le sujet convient.
 */
export function plainTopicIssue(topic: string): string | null {
  const reference = topic.match(/\b(?=[\p{L}\p{N}-]*\p{N})[\p{L}\p{N}-]{2,}\b|\b\p{N}+\b/u)?.[0];
  if (reference) return `référence technique ou chiffre « ${reference} »`;
  const acronym = (topic.match(/\b\p{Lu}{2,}\b/gu) ?? []).find((word) => !COMMON_ACRONYMS.has(word));
  if (acronym) return `sigle peu courant « ${acronym} »`;
  const second = topic.match(/\s(et|ainsi que|ou)\s|[,;/+&]/i)?.[0];
  if (second) return `deux idées (« ${second.trim()} ») : n'en garder qu'une`;
  return null;
}

export function shortCodeChecks(subject: string, body: string, ctx: ShortContext & { introSubject: string }, topic: string): RelanceCriterion[] {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const expectedSubject = relanceSubject({ subject: ctx.introSubject });
  const r1 = subject === expectedSubject && blocks[0] === ctx.greeting;
  const link = ctx.demoLink;
  const needV = ctx.requireV !== false;
  const demoBlock = link ? blocks.find((block) => block.includes(link)) : undefined;
  const linkOk = Boolean(link && (!needV || /[?&]v=[^&\s]+/i.test(link)) && demoBlock && !demoBlock.includes("\n") && body.split(link).length === 2);
  const transfer = TRANSFER.test(body);
  // La phrase de transfert (adresse générique) ne compte pas dans les 25–40 mots : l'exemple de Cowork en fait déjà ~42 avec elle.
  const prose = blocks.slice(1).filter((block) => block !== TRANSFER_SENTENCE).join(" ").replace(new RegExp(DEMO_LINK.source, "gi"), " ");
  const words = shortProseWords(body);
  const topicWords = countWords(topic);
  const forbidden = body.match(FORBIDDEN)?.[0] ?? body.match(SUPERLATIVE)?.[0];
  const plain = plainTopicIssue(topic);
  const r6 = words >= SHORT_WORDS.min && words <= SHORT_WORDS.max && topicWords >= SHORT_TOPIC_WORDS.min && topicWords <= SHORT_TOPIC_WORDS.max && !forbidden && !plain;
  const recruitment = prose.match(RECRUITMENT)?.[0];
  const conditional = prose.match(IF_CONCERNS)?.[0];
  return [
    { id: "R1", ok: r1, citation: r1 ? `${expectedSubject} · ${ctx.greeting}` : `objet « ${subject} » (attendu « ${expectedSubject} »)` },
    { id: "R3", ok: linkOk, citation: link ? (linkOk ? link : `lien absent, mêlé au texte, ou sans &v alors que l'intro en avait un : ${link}`) : "pas de lien de démo dans l'intro" },
    { id: "R4", ok: ctx.generic ? transfer : !transfer, citation: ctx.generic ? (transfer ? "adresse générique : transfert demandé" : "adresse générique : phrase de transfert absente") : transfer ? "adresse nominative : transfert à retirer" : "adresse nominative : pas de transfert" },
    { id: "R6", ok: r6, citation: forbidden ? `formule interdite « ${forbidden} »` : plain ? `sujet : ${plain}` : `${words} mots (${SHORT_WORDS.min} à ${SHORT_WORDS.max}) · sujet en ${topicWords} mots (${SHORT_TOPIC_WORDS.min} à ${SHORT_TOPIC_WORDS.max})` },
    { id: "R9", ok: !NAMELESS_GREETING.test(blocks[0] ?? ""), citation: blocks[0] ?? "" },
    { id: "R10", ok: !recruitment && !conditional, citation: recruitment ? `recrutement : « ${recruitment} »` : conditional ? `conditionnelle : « ${conditional.trim()} »` : "aucun" },
  ];
}

export function buildShortTopicPrompt(feedback: string | null): string {
  return `Tu prépares la RELANCE COURTE d'un mail de prospection resté sans réponse. Le code l'écrit ainsi :
« Je remonte mon message de la semaine dernière sur <SUJET>. »
Tu n'écris QUE <SUJET> : le sujet de l'intro, repris en ${SHORT_TOPIC_WORDS.min} à ${SHORT_TOPIC_WORDS.max} mots, avec un article, sans point final.
Exemples : « le tri des demandes de devis », « la confirmation des délais de commande », « le tri de vos demandes reçues par e-mail ».
Règles :
- vocabulaire de tous les jours, compréhensible par n'importe quel dirigeant : AUCUNE référence technique, nuance de matériau, code produit, norme, chiffre ou sigle (pas « acier 15CDV6 », pas « mission civile ») ; nomme le PROCESSUS (devis, commandes, délais, planning, demandes…), pas le produit ;
- UNE seule idée : pas de « et », de « ainsi que » ni de virgule ;
- uniquement ce que dit l'intro — aucun fait, client, situation ou conséquence nouveaux ; pas de jugement (« fastidieux », « chronophage ») ; pas de mention de recrutement.${feedback ? `\n\nCORRECTION — la version précédente a échoué : ${feedback}` : ""}
Réponds UNIQUEMENT en JSON : {"topic":"…"}`;
}

export function buildShortJudgePrompt(): string {
  return `Tu relis une RELANCE COURTE de prospection, envoyée dans le même fil que l'intro. Réponds OUI (true) ou NON (false), avec une citation exacte.
La ligne du lien de démo, la phrase de transfert et la question finale sont FIXÉES par le programme : ne les juge pas. Juge seulement la phrase « Je remonte mon message … sur <sujet> ».
R7 — Fidélité : cette phrase n'affirme RIEN de nouveau sur l'entreprise ; le sujet qu'elle rappelle est bien celui de l'intro (même processus), sans fait, chiffre, client, situation ou conséquence ajoutés. NON au moindre ajout ou à un sujet qui ne correspond pas à l'intro.
Réponds UNIQUEMENT en JSON : {"R7":{"ok":true|false,"citation":"…"}}`;
}

const keepQuota = (error: unknown): string => {
  if (isOpenAIQuotaError(error)) throw error;
  return "";
};

function parseTopic(raw: string): string | null {
  try {
    const value = JSON.parse(raw) as { topic?: unknown };
    return typeof value.topic === "string" && value.topic.trim() ? clean(value.topic) : null;
  } catch {
    return null;
  }
}

function parseR7(raw: string): { ok: boolean; citation: string } | null {
  try {
    const value = JSON.parse(raw) as { R7?: { ok?: unknown; citation?: unknown } };
    return value.R7 && typeof value.R7.ok === "boolean" ? { ok: value.R7.ok, citation: String(value.R7.citation ?? "").trim() } : null;
  } catch {
    return null;
  }
}

/** R7 lu par le modèle (vote à 3, égalité → NON) ; `null` si aucune lecture lisible. */
export async function readShortFidelity(ask: AskFn, input: { body: string; introBody: string }, operation = "relance:courte:grille", samples = 3): Promise<RelanceCriterion | null> {
  const user = `INTRO ENVOYÉE\n${input.introBody.slice(0, 3000)}\n\nRELANCE COURTE\n${input.body}`;
  const raws = await Promise.all(Array.from({ length: samples }, (_, index) => ask("judge", buildShortJudgePrompt(), user, 0, index ? `${operation}:lecture-${index + 1}` : operation).catch(keepQuota)));
  const votes = raws.map(parseR7).filter((vote): vote is { ok: boolean; citation: string } => Boolean(vote));
  if (!votes.length) return null;
  const yes = votes.filter((vote) => vote.ok).length;
  const ok = yes > votes.length - yes;
  return { id: "R7", ok, citation: (votes.find((vote) => vote.ok === ok && vote.citation) ?? votes[0]).citation };
}

/**
 * Relance courte (mode B) : un essai, au plus une correction ciblée, sinon « À revoir ».
 * Le modèle n'écrit que le sujet ; la question est choisie par le code dans le lot.
 */
export async function writeShortRelance(
  ask: AskFn,
  input: { introSubject: string | null; introBody: string; generic: boolean; fiche: Pick<RelanceFiche, "companyName">; introFamily?: string | null; introSentAt?: string | null; now?: Date; lot?: RelanceLot },
): Promise<RelanceOutcome | { error: string }> {
  const intro = introParts(input.introSubject, input.introBody, input.introFamily);
  const subject = relanceSubject(intro);
  const question = shortQuestion(input.fiche.companyName, input.lot);
  const ctx: ShortContext & { introSubject: string } = {
    greeting: intro.greeting,
    subject,
    introSubject: intro.subject,
    demoLink: intro.demoLink,
    requireV: intro.requireV,
    generic: input.generic,
    seed: input.fiche.companyName,
    when: whenSent(input.introSentAt, input.now),
    question,
  };
  const user = `INTRO ENVOYÉE (objet : ${intro.subject})\n${input.introBody.slice(0, 3000)}`;
  let feedback: string | null = null;
  let best: RelanceOutcome | null = null;
  let rounds = 0;
  for (let round = 0; round < 2; round += 1) {
    rounds = round + 1;
    const topic = parseTopic(await ask("writer", buildShortTopicPrompt(feedback), user, round ? 0.3 : 0.5, `relance:courte:redaction${round ? ":rewrite" : ""}`).catch(keepQuota));
    if (!topic) {
      feedback = 'la réponse n\'était pas le JSON {"topic":"…"}.';
      continue;
    }
    const body = assembleShortRelance(topic, ctx);
    const code = shortCodeChecks(subject, body, ctx, topic);
    const fidelity = code.every((item) => item.ok) ? await readShortFidelity(ask, { body, introBody: input.introBody }, `relance:courte:grille:${round}`) : null;
    const verdict = relanceVerdictOf(fidelity ? [...code, fidelity] : code, SHORT_IDS);
    const outcome: RelanceOutcome = {
      subject,
      body,
      verdict,
      ready: verdict.ready,
      reason: verdict.ready ? null : relanceReason(verdict) || "Relecture automatique indisponible : à relire.",
      attempts: rounds,
      parts: { about: topic, outcome: "", cta: question },
    };
    if (!best || verdict.score > (best.verdict?.score ?? 0)) best = outcome;
    if (verdict.ready) break;
    feedback = verdict.items.filter((item) => !item.ok).map((item) => `${item.id} : ${item.citation}`).join(" ; ");
  }
  if (!best) return { error: "Relance courte inexploitable : aucun sujet utilisable." };
  input.lot?.questions.push(questionKey(question));
  return { ...best, attempts: rounds };
}

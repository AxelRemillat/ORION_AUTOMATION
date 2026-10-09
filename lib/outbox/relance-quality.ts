import type { AskFn } from "@/lib/ai/chat";
import { isOpenAIQuotaError } from "@/lib/ai/quota";

/**
 * RELANCE « PRÊTE » (Cowork #12, demande d'Axel : 9 ou 10/10) — grille R1–R7,
 * séparée de la check-list des mails d'intro (C1–C5, agent2).
 *
 *   Code : R1 fil (objet « Re: <objet exact> », salutation de l'intro),
 *          R3 preuve (même lien de démo, sur sa ligne),
 *          R4 destinataire (générique → phrase de transfert ; nominatif → aucune),
 *          R6 forme (40–70 mots hors signature et mention stop, formules interdites).
 *   LLM  : R2 nouveauté (un élément absent de l'intro, tiré de la fiche),
 *          R5 appel à l'action (différent de l'intro, plus léger),
 *          R7 fidélité (rien d'inventé) — un appel JSON rejoué 3 fois, majorité.
 *
 * « Prête » = les 7 à OUI. La relance est ASSEMBLÉE par le code (salutation,
 * ligne de démo, phrase de transfert) : R1, R3 et R4 tiennent par construction ;
 * le modèle n'écrit que la nouveauté et l'appel à l'action.
 */

export type RelanceCriterionId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export const RELANCE_CRITERIA: Record<RelanceCriterionId, string> = {
  R1: "Fil : « Re: <objet exact de l'intro> », salutation identique à l'intro",
  R2: "Nouveauté : un élément absent de l'intro, tiré de la fiche",
  R3: "Preuve : le lien de démo de l'intro, sur une ligne",
  R4: "Destinataire : transfert demandé seulement à une adresse générique",
  R5: "Appel à l'action différent de l'intro, plus léger",
  R6: "Forme : 40 à 70 mots, aucune formule interdite",
  R7: "Fidélité : aucun fait, chiffre ou client inventé",
};

export interface RelanceCriterion {
  id: RelanceCriterionId;
  ok: boolean;
  citation: string;
}

export interface RelanceVerdict {
  items: RelanceCriterion[];
  ready: boolean;
  /** Note /10 affichée : 10 si prête, sinon retirée de 1,5 par critère à NON. */
  score: number;
}

export const RELANCE_WORDS = { min: 40, max: 70 } as const;
export const RELANCE_JUDGE_SAMPLES = 3;

// --- L'intro envoyée --------------------------------------------------------------

export interface IntroParts {
  subject: string;
  /** Première ligne de l'intro (« Bonjour Monsieur Dupont, » ou « Bonjour, »). */
  greeting: string;
  /** Lien de démo de l'intro, tel quel (même démo, même &v / &f). */
  demoLink: string | null;
  /** Dernière question de l'intro (son appel à l'action). */
  cta: string | null;
}

const DEMO_LINK = /(?:https?:\/\/)?(?:www\.)?axelremillat\.com\/[^\s)>\]]+/i;

export function introParts(subject: string | null, body: string): IntroParts {
  const lines = body.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const greeting = lines.find((line) => line.length > 0) ?? "Bonjour,";
  const questions = body.replace(/\s+/g, " ").match(/[^.!?]*\?/g) ?? [];
  return {
    subject: (subject ?? "").replace(/^\s*(re|tr|fwd?)\s*:\s*/i, "").trim(),
    greeting: /^bonjour\b/i.test(greeting) ? greeting : "Bonjour,",
    demoLink: body.match(DEMO_LINK)?.[0].replace(/[.,;]+$/, "") ?? null,
    cta: questions.length ? questions[questions.length - 1].trim() : null,
  };
}

/** Objet de la relance : « Re: » + l'objet exact de l'intro. */
export const relanceSubject = (intro: Pick<IntroParts, "subject">) => `Re: ${intro.subject}`;

/** Adresse générique (info@, contact@, nom-société@…) : demander le transfert. */
export const TRANSFER_SENTENCE = "Si le sujet est suivi par quelqu'un d'autre chez vous, merci de lui transférer ce message.";
const TRANSFER = /(transf[ée]r|faire suivre|bonne personne|personne qui (suit|g[èe]re)|suivi par quelqu)/i;

/** Ligne de démo (preuve rappelée, sur sa ligne). */
export const demoLine = (link: string) => `La démo, pour mémoire : ${link}`;

// --- Assemblage -------------------------------------------------------------------

export interface RelanceParts {
  /** Une ou deux phrases : l'élément nouveau, tiré de la fiche, relié au besoin. */
  novelty: string;
  /** Appel à l'action léger, différent de l'intro. */
  cta: string;
}

export interface RelanceContext {
  intro: IntroParts;
  /** Adresse du destinataire générique (info@, contact@…). */
  generic: boolean;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps de la relance SANS signature ni mention stop (ajoutées par le code d'envoi). */
export function assembleRelance(parts: RelanceParts, ctx: RelanceContext): string {
  return [
    ctx.intro.greeting,
    clean(parts.novelty),
    ctx.intro.demoLink ? demoLine(ctx.intro.demoLink) : null,
    ctx.generic ? TRANSFER_SENTENCE : null,
    clean(parts.cta),
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// --- Contrôles du code : R1, R3, R4, R6 ----------------------------------------------

export const FORBIDDEN = /(je me permets|l['’]id[ée]e est simple|l['’]id[ée]e est de|cela peut|sans r[ée]ponse de votre part|je reviens vers vous|je n['’]ai pas eu de (retour|r[ée]ponse)|vous n['’]avez pas (r[ée]pondu|eu le temps)|toujours sans nouvelles|faute de r[ée]ponse|n['’]h[ée]sitez pas|je relance|petite relance|d[ée]sol[ée] de|pardon de|vous avez d[uû])/i;
export const SUPERLATIVE = /(\bmeilleure?s?\b|\ble plus\b|\bla plus\b|\bles plus\b|incroyable|exceptionnel|r[ée]volutionnaire|\bparfait|\bid[ée]al|\bunique\b|[ée]norme|extraordinaire|formidable|imbattable|in[ée]gal[ée])/i;

const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export function relanceCodeChecks(subject: string, body: string, ctx: RelanceContext): RelanceCriterion[] {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const expectedSubject = relanceSubject(ctx.intro);
  const r1 = subject === expectedSubject && blocks[0] === ctx.intro.greeting;
  const demoBlock = ctx.intro.demoLink ? blocks.find((block) => block.includes(ctx.intro.demoLink as string)) : undefined;
  const r3 = !ctx.intro.demoLink || Boolean(demoBlock && !demoBlock.includes("\n") && body.split(ctx.intro.demoLink).length === 2);
  const transfer = TRANSFER.test(body);
  const r4 = ctx.generic ? transfer : !transfer;
  // Le lien de démo ne compte pas comme des mots (« axelremillat », « com », « demo »…).
  const words = countWords(blocks.slice(1).join(" ").replace(new RegExp(DEMO_LINK.source, "gi"), " "));
  const forbidden = body.match(FORBIDDEN)?.[0] ?? body.match(SUPERLATIVE)?.[0];
  const r6 = words >= RELANCE_WORDS.min && words <= RELANCE_WORDS.max && !forbidden;
  return [
    { id: "R1", ok: r1, citation: r1 ? `${expectedSubject} · ${ctx.intro.greeting}` : `objet « ${subject} » (attendu « ${expectedSubject} ») · salutation « ${blocks[0] ?? ""} » (attendue « ${ctx.intro.greeting} »)` },
    { id: "R3", ok: r3, citation: ctx.intro.demoLink ? (r3 ? ctx.intro.demoLink : `lien de l'intro absent ou mêlé au texte : ${ctx.intro.demoLink}`) : "pas de démo dans l'intro" },
    { id: "R4", ok: r4, citation: ctx.generic ? (transfer ? "adresse générique : transfert demandé" : "adresse générique : phrase de transfert absente") : transfer ? "adresse nominative : phrase de transfert à retirer" : "adresse nominative : pas de transfert" },
    { id: "R6", ok: r6, citation: forbidden ? `formule interdite « ${forbidden} »` : `${words} mots (${RELANCE_WORDS.min} à ${RELANCE_WORDS.max})` },
  ];
}

// --- Lecture du modèle : R2, R5, R7 (vote à 3) ----------------------------------------

export interface RelanceFiche {
  companyName: string;
  /** Faits sourcés (key_figures.facts) et signaux datés de la fiche. */
  facts: readonly string[];
  signals: readonly string[];
  activity: string | null;
}

export function ficheBlock(fiche: RelanceFiche): string {
  return [
    `Entreprise : ${fiche.companyName}`,
    fiche.activity ? `Activité : ${fiche.activity}` : null,
    fiche.facts.length ? `Faits sourcés :\n${fiche.facts.map((fact) => `- ${fact}`).join("\n")}` : "Faits sourcés : aucun",
    fiche.signals.length ? `Signaux :\n${fiche.signals.map((signal) => `- ${signal}`).join("\n")}` : "Signaux : aucun",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRelanceJudgePrompt(): string {
  return `Tu relis la RELANCE d'un mail de prospection (même fil que l'intro). Tu ne donnes pas de note : OUI (true) ou NON (false) par critère, avec des CITATIONS EXACTES.
La forme (objet, salutation, lien, longueur, phrase de transfert) est vérifiée par un programme : ne la juge pas.

R2 — Nouveauté : la relance apporte UN élément ABSENT de l'intro, tiré de la fiche (fait sourcé, signal daté, situation concrète du métier). NON si elle reformule le pitch de l'intro ou redit la même chose autrement. Donne "citation_intro" (le passage de l'intro le plus proche) et "citation_relance" (l'élément nouveau).
R5 — Appel à l'action : différent de celui de l'intro ET plus léger — une question fermée (oui/non) ou « dites-moi simplement si c'est un sujet chez vous ». NON s'il redemande un rendez-vous ou 15 minutes comme l'intro, ou s'il est plus engageant.
R7 — Fidélité : tout ce que la relance affirme sur l'entreprise (activité, chiffres, clients, process, actualité) vient de la fiche ou de l'intro. NON au moindre fait, chiffre ou client inventé.

Réponds UNIQUEMENT en JSON : {"R2":{"ok":true|false,"citation_intro":"…","citation_relance":"…"},"R5":{"ok":true|false,"citation":"…"},"R7":{"ok":true|false,"citation":"…"}}`;
}

type Sample = Partial<Record<"R2" | "R5" | "R7", { ok: boolean; citation: string }>>;

export function parseRelanceJudge(raw: string): Sample | null {
  let value: Record<string, { ok?: unknown; citation?: unknown; citation_intro?: unknown; citation_relance?: unknown }>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const sample: Sample = {};
  for (const id of ["R2", "R5", "R7"] as const) {
    const entry = value[id];
    if (!entry || typeof entry.ok !== "boolean") return null;
    const citation = id === "R2" ? `intro : « ${String(entry.citation_intro ?? "").trim()} » · relance : « ${String(entry.citation_relance ?? "").trim()} »` : String(entry.citation ?? "").trim();
    sample[id] = { ok: entry.ok, citation };
  }
  return sample;
}

/** Majorité par critère ; égalité → NON ; `null` si aucune lecture lisible. */
export function relanceMajority(samples: readonly (Sample | null)[]): RelanceCriterion[] | null {
  const read = samples.filter((sample): sample is Sample => Boolean(sample));
  if (!read.length) return null;
  return (["R2", "R5", "R7"] as const).map((id) => {
    const votes = read.map((sample) => sample[id]!);
    const yes = votes.filter((vote) => vote.ok).length;
    const ok = yes > votes.length - yes;
    return { id, ok, citation: (votes.find((vote) => vote.ok === ok && vote.citation) ?? votes[0]).citation };
  });
}

const ORDER: RelanceCriterionId[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];

export function relanceVerdictOf(items: RelanceCriterion[]): RelanceVerdict {
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const misses = sorted.filter((item) => !item.ok).length;
  return { items: sorted, ready: sorted.length === ORDER.length && misses === 0, score: Math.max(0, Math.round((10 - misses * 1.5) * 10) / 10) };
}

/** Crédit OpenAI épuisé : on le fait suivre ; toute autre panne = lecture illisible. */
const keepQuota = (error: unknown): string => {
  if (isOpenAIQuotaError(error)) throw error;
  return "";
};

/** Grille complète : le code d'abord ; la lecture du modèle seulement si le code passe. `null` = relecture indisponible. */
export async function judgeRelance(
  ask: AskFn,
  input: { subject: string; body: string; ctx: RelanceContext; introBody: string; fiche: RelanceFiche },
  operation = "relance:grille",
  samples = RELANCE_JUDGE_SAMPLES,
): Promise<RelanceVerdict | null> {
  const code = relanceCodeChecks(input.subject, input.body, input.ctx);
  if (code.some((item) => !item.ok)) return relanceVerdictOf(code);
  const user = `FICHE\n${ficheBlock(input.fiche)}\n\nINTRO ENVOYÉE\n${input.introBody.slice(0, 3000)}\n\nRELANCE\n${input.body}`;
  const raws = await Promise.all(
    Array.from({ length: Math.max(1, samples) }, (_, index) => ask("judge", buildRelanceJudgePrompt(), user, 0, index ? `${operation}:lecture-${index + 1}` : operation).catch(keepQuota)),
  );
  const semantic = relanceMajority(raws.map(parseRelanceJudge));
  if (!semantic) return null;
  return relanceVerdictOf([...code, ...semantic]);
}

export function relanceFeedback(verdict: RelanceVerdict): string {
  return verdict.items
    .filter((item) => !item.ok)
    .map((item) => `- ${item.id} NON — ${RELANCE_CRITERIA[item.id]}${item.citation ? ` : ${item.citation}` : ""}`)
    .join("\n");
}

export function relanceReason(verdict: RelanceVerdict): string {
  const failed = verdict.items.filter((item) => !item.ok);
  return failed.length ? `${failed.length} critère(s) à NON — ${failed[0].id} ${RELANCE_CRITERIA[failed[0].id]}${failed[0].citation ? ` : ${failed[0].citation}` : ""}` : "";
}

// --- Rédacteur --------------------------------------------------------------------

export function buildRelanceWriterPrompt(input: { generic: boolean; type: "relance_1" | "relance_2"; feedback: string | null }): string {
  const last = input.type === "relance_2";
  return `Tu écris, pour Axel Remillat (freelance en IA et automatisation de tâches pour les PME), la ${last ? "DERNIÈRE relance (J+7)" : "relance (J+4)"} d'un mail de prospection resté sans réponse. Elle part dans le même fil que l'intro.

LE CODE ASSEMBLE LA RELANCE AINSI (tu n'écris QUE "novelty" et "cta") :
<salutation de l'intro, à l'identique>

<NOVELTY — 1 ou 2 phrases>

La démo, pour mémoire : <lien de l'intro>
${input.generic ? "\nSi le sujet est suivi par quelqu'un d'autre chez vous, merci de lui transférer ce message.\n" : ""}
<CTA — 1 phrase>

À ÉCRIRE :
- "novelty" : UN élément NOUVEAU, ABSENT de l'intro, pris dans la fiche — un fait sourcé, un signal daté, ou une situation concrète de leur métier. Phrase 1 : cet élément, tel que la fiche le dit (commence par lui, pas par « La démo »). Phrase 2 : ce que la DÉMO fait de précis avec ce cas (« la démo repère… », « la démo prépare… »). Choisis l'élément le plus concret qui n'apparaît pas dans l'intro. Ne reformule JAMAIS le pitch de l'intro.
- FIDÉLITÉ : n'affirme RIEN sur l'entreprise qui ne soit écrit dans la fiche ou l'intro — aucune conséquence supposée (« sont essentiels », « pourraient intervenir », « doivent sûrement »), aucun chiffre ni client ajouté. Le lien se dit sur la démo, jamais sur eux.
- "cta" : plus léger que l'intro et différent d'elle — une question fermée (oui / non) LIÉE à l'élément nouveau, dans leurs mots (« Ces demandes de recalibrage arrivent-elles aussi par e-mail ? », « Les commandes export passent-elles par la même boîte ? »), ou à défaut « Dites-moi simplement si c'est un sujet chez vous. »${last ? " Comme c'est le dernier message, tu peux le dire simplement, sans insister." : ""} Jamais un nouveau rendez-vous, jamais « 15 minutes », jamais une formule passe-partout comme « Est-ce un sujet chez vous en ce moment ? ».
- La relance complète (novelty + ligne de démo${input.generic ? " + phrase de transfert" : ""} + cta) fait ${RELANCE_WORDS.min} à ${RELANCE_WORDS.max} mots : "novelty" 25 à 40 mots, "cta" 6 à 14 mots.

INTERDITS : « Je me permets », « Je reviens vers vous », « L'idée est simple / de », « Cela peut », « sans réponse de votre part », « N'hésitez pas », toute culpabilisation (« vous n'avez pas répondu », « toujours sans nouvelles »), tout superlatif (meilleur, idéal, unique, incroyable…), tout fait, chiffre ou client absent de la fiche et de l'intro, toute salutation, toute signature, tout lien.${input.feedback ? `\n\nRÉÉCRITURE — la version précédente a échoué sur ces critères, corrige-les SANS toucher au reste :\n${input.feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"novelty":"…","cta":"…"}`;
}

export function parseRelanceParts(raw: string): RelanceParts | null {
  try {
    const value = JSON.parse(raw) as { novelty?: unknown; cta?: unknown };
    const novelty = typeof value.novelty === "string" ? value.novelty.trim() : "";
    const cta = typeof value.cta === "string" ? value.cta.trim() : "";
    return novelty && cta ? { novelty, cta } : null;
  } catch {
    return null;
  }
}

export interface RelanceOutcome {
  subject: string;
  /** Corps sans signature ni mention stop. */
  body: string;
  verdict: RelanceVerdict | null;
  ready: boolean;
  reason: string | null;
  attempts: number;
}

/**
 * Rédaction : un essai, puis AU PLUS une réécriture ciblée sur les critères en
 * échec ; sinon « À revoir » avec le critère en cause. Pas de stratège.
 */
export async function writeRelance(
  ask: AskFn,
  input: { introSubject: string | null; introBody: string; generic: boolean; fiche: RelanceFiche; type: "relance_1" | "relance_2" },
): Promise<RelanceOutcome | { error: string }> {
  const intro = introParts(input.introSubject, input.introBody);
  const ctx: RelanceContext = { intro, generic: input.generic };
  const subject = relanceSubject(intro);
  const user = `${ficheBlock(input.fiche)}\n\nINTRO ENVOYÉE (objet : ${intro.subject})\n${input.introBody.slice(0, 3000)}\n\nAppel à l'action de l'intro, à NE PAS reprendre : ${intro.cta ?? "—"}`;
  let feedback: string | null = null;
  let best: RelanceOutcome | null = null;
  for (let round = 0; round < 2; round += 1) {
    const raw = await ask("writer", buildRelanceWriterPrompt({ generic: input.generic, type: input.type, feedback }), user, round ? 0.4 : 0.6, `relance:redaction${round ? ":rewrite" : ""}`).catch(keepQuota);
    const parts = parseRelanceParts(raw);
    if (!parts) {
      feedback = '- La réponse n\'était pas le JSON demandé : {"novelty":"…","cta":"…"}.';
      continue;
    }
    const body = assembleRelance(parts, ctx);
    const verdict = await judgeRelance(ask, { subject, body, ctx, introBody: input.introBody, fiche: input.fiche }, `relance:grille:${round}`);
    const outcome: RelanceOutcome = {
      subject,
      body,
      verdict,
      ready: Boolean(verdict?.ready),
      reason: verdict ? (verdict.ready ? null : relanceReason(verdict)) : "Relecture automatique indisponible : à relire.",
      attempts: round + 1,
    };
    if (!best || (verdict?.score ?? 0) > (best.verdict?.score ?? 0)) best = outcome;
    if (outcome.ready || !verdict) break;
    feedback = relanceFeedback(verdict);
  }
  return best ?? { error: "Relance inexploitable : le rédacteur n'a rendu aucun texte utilisable." };
}

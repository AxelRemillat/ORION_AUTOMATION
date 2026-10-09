import type { AskFn } from "@/lib/ai/chat";
import { isOpenAIQuotaError } from "@/lib/ai/quota";

/**
 * RELANCE « PRÊTE » — grille v2 (Cowork #12 puis #13 ; Axel veut 9 ou 10/10),
 * séparée de la check-list des mails d'intro (C1–C5, agent2).
 *
 *   Code : R1 fil (objet « Re: <objet exact> », salutation de l'intro — R9 appliquée),
 *          R3 preuve (même lien de démo AVEC &v, et &f si l'intro l'avait, sur sa ligne),
 *          R4 destinataire (générique → phrase de transfert ; nominatif → aucune),
 *          R6 forme (35–60 mots hors signature et mention stop, formules interdites),
 *          R9 salutation (« Bonjour Madame, » sans nom → « Bonjour, »),
 *          R10 interdits (recrutement, offre d'emploi ; conditionnelle « Si … concerne … »),
 *          R8 (partie code) : « La démo repère… » en sujet de phrase, phrases méta.
 *   LLM  : R2 nouveauté sur le MÊME processus que l'intro (nouvel angle, pas nouveau sujet),
 *          R5 appel à l'action plus léger, R7 fidélité,
 *          R8 ton (phrase 1 sur eux, phrase 2 sur ce que ça change pour eux)
 *          — un appel JSON rejoué 3 fois, majorité.
 *
 * « Prête » = tous les critères à OUI. La relance est ASSEMBLÉE par le code
 * (salutation, ligne de démo variée, phrase de transfert) ; le modèle n'écrit
 * que les deux phrases sur eux et l'appel à l'action.
 */

export type RelanceCriterionId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10";

export const RELANCE_CRITERIA: Record<RelanceCriterionId, string> = {
  R1: "Fil : « Re: <objet exact de l'intro> », salutation de l'intro",
  R2: "Nouveauté : un angle nouveau sur le MÊME processus que l'intro, tiré de la fiche",
  R3: "Preuve : le lien de démo de l'intro avec son &v (et &f), sur une ligne",
  R4: "Destinataire : transfert demandé seulement à une adresse générique",
  R5: "Appel à l'action différent de l'intro, plus léger",
  R6: "Forme : 35 à 60 mots, aucune formule interdite",
  R7: "Fidélité : aucun fait, chiffre ou client inventé",
  R8: "Ton : phrase 1 sur eux, phrase 2 sur ce que ça change pour eux, jamais la mécanique de la démo",
  R9: "Salutation : jamais « Bonjour Madame, » ou « Bonjour Monsieur, » sans nom",
  R10: "Interdits : recrutement, offre d'emploi, conditionnelle « Si … concerne »",
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

export const RELANCE_WORDS = { min: 35, max: 60 } as const;
export const RELANCE_JUDGE_SAMPLES = 3;
const LLM_IDS = ["R2", "R5", "R7", "R8"] as const;
const ORDER: RelanceCriterionId[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"];

// --- L'intro envoyée --------------------------------------------------------------

export interface IntroParts {
  subject: string;
  /** Salutation de la relance : celle de l'intro, « Bonjour, » si elle n'a pas de nom (R9). */
  greeting: string;
  /** Lien de démo de l'intro, tel quel (même démo, même &v / &f). */
  demoLink: string | null;
  /** Dernière question de l'intro (son appel à l'action). */
  cta: string | null;
  /**
   * R3 (Cowork #14, option b) : &v exigé seulement si l'intro en avait un ou si sa famille
   * est connue. Sinon la relance reprend EXACTEMENT le lien de l'intro (pas de &v inventé).
   */
  requireV?: boolean;
}

const DEMO_LINK = /(?:https?:\/\/)?(?:www\.)?axelremillat\.com\/[^\s)>\]]+/i;
/** « Bonjour Madame, » / « Bonjour Monsieur, » sans nom (R9). */
const NAMELESS_GREETING = /^bonjour\s+(madame|monsieur|mme|m\.)\s*,?\s*$/i;

/**
 * Intro partie AVANT les familles (lien sans &v) : la famille enregistrée de l'intro
 * (message_variants.family) donne le marqueur, ajouté au MÊME lien. Sans famille connue,
 * le lien reste tel quel et R3 le signale (« À revoir »).
 */
export function withFamilyMark(link: string, family: string | null | undefined): string {
  const digit = family?.match(/^F([1-5])$/)?.[1];
  if (!digit || /[?&]v=[^&\s]+/i.test(link)) return link;
  return `${link}${link.includes("?") ? "&" : "?"}v=${digit}`;
}

export function introParts(subject: string | null, body: string, family?: string | null): IntroParts {
  const lines = body.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const first = lines.find((line) => line.length > 0) ?? "Bonjour,";
  const questions = body.replace(/\s+/g, " ").match(/[^.!?]*\?/g) ?? [];
  const greeting = !/^bonjour\b/i.test(first) || NAMELESS_GREETING.test(first) ? "Bonjour," : first;
  return {
    subject: (subject ?? "").replace(/^\s*(re|tr|fwd?)\s*:\s*/i, "").trim(),
    greeting,
    demoLink: (() => {
      const link = body.match(DEMO_LINK)?.[0].replace(/[.,;]+$/, "");
      return link ? withFamilyMark(link, family) : null;
    })(),
    cta: questions.length ? questions[questions.length - 1].trim() : null,
    requireV: (() => {
      const link = body.match(DEMO_LINK)?.[0] ?? "";
      return /[?&]v=[^&\s]+/i.test(link) || /^F[1-5]$/.test(family ?? "");
    })(),
  };
}

/** Objet de la relance : « Re: » + l'objet exact de l'intro. */
export const relanceSubject = (intro: Pick<IntroParts, "subject">) => `Re: ${intro.subject}`;

/** Adresse générique (info@, contact@, nom-société@…) : demander le transfert. */
export const TRANSFER_SENTENCE = "Si le sujet est suivi par quelqu'un d'autre chez vous, merci de lui transférer ce message.";
const TRANSFER = /(transf[ée]r|faire suivre|bonne personne|personne qui (suit|g[èe]re)|suivi par quelqu)/i;

/** Lignes du lien de démo, variées d'une relance à l'autre (une seule par relance). */
export const DEMO_LEADS = ["Pour vous faire une idée en une minute :", "Exemple testable :", "Un exemple concret, testable en une minute :", "À tester en une minute :"] as const;

/** Ligne choisie de façon STABLE pour une fiche (même relance → même ligne). */
export function demoLead(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DEMO_LEADS[hash % DEMO_LEADS.length];
}

export const demoLine = (link: string, seed = "") => `${demoLead(seed)} ${link}`;

// --- Assemblage -------------------------------------------------------------------

export interface RelanceParts {
  /** Phrase 1 : eux (leur activité, leur client, leur situation) — angle nouveau sur le processus de l'intro. */
  about: string;
  /** Phrase 2 : ce que ça change pour eux (résultat), jamais la mécanique de la démo. */
  outcome: string;
  /** Appel à l'action léger, différent de l'intro. */
  cta: string;
}

export interface RelanceContext {
  intro: IntroParts;
  /** Adresse du destinataire générique (info@, contact@…). */
  generic: boolean;
  /** Graine de la ligne de démo (nom de la société). */
  seed?: string;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps de la relance SANS signature ni mention stop (ajoutées par le code d'envoi). */
export function assembleRelance(parts: RelanceParts, ctx: RelanceContext): string {
  return [
    ctx.intro.greeting,
    `${clean(parts.about)} ${clean(parts.outcome)}`,
    ctx.intro.demoLink ? demoLine(ctx.intro.demoLink, ctx.seed ?? ctx.intro.subject) : null,
    ctx.generic ? TRANSFER_SENTENCE : null,
    clean(parts.cta),
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

// --- Contrôles du code : R1, R3, R4, R6, R8 (partie code), R9, R10 -------------------

export const FORBIDDEN = /(je me permets|l['’]id[ée]e est simple|l['’]id[ée]e est de|cela peut|sans r[ée]ponse de votre part|je reviens vers vous|je n['’]ai pas eu de (retour|r[ée]ponse)|vous n['’]avez pas (r[ée]pondu|eu le temps)|toujours sans nouvelles|faute de r[ée]ponse|n['’]h[ée]sitez pas|je relance|petite relance|d[ée]sol[ée] de|pardon de|vous avez d[uû]|la d[ée]mo,? pour m[ée]moire)/i;
export const SUPERLATIVE = /(\bmeilleure?s?\b|\ble plus\b|\bla plus\b|\bles plus\b|incroyable|exceptionnel|r[ée]volutionnaire|\bparfait|\bid[ée]al|\bunique\b|[ée]norme|extraordinaire|formidable|imbattable|in[ée]gal[ée])/i;
/** R8 (code) : la démo en sujet de phrase, phrases méta sur l'échange. */
export const DEMO_AS_SUBJECT = /\b(la|cette|une|notre) d[ée]mo (rep[èe]re|montre|montrerait|pr[ée]pare|signale|trie|lit|aide|aiderait|permet|permettrait|identifie|d[ée]tecte|rep[èe]rerait|fait)\b/i;
export const META = /(premier message|mon (pr[ée]c[ée]dent|dernier|premier) (message|mail|e-?mail|courriel)|cit[ée]e?s? dans mon|comme (je vous l['’]?(indiquais|[ée]crivais|disais)|indiqu[ée] pr[ée]c[ée]demment)|je vous (ai|avais) ([ée]crit|parl[ée]))/i;
/** R10 : recrutement, offre d'emploi ; conditionnelle « Si … concerne … ». */
export const RECRUITMENT = /(recrut|offre d['’]emploi|embauch|poste [àa] pourvoir|candidat|\bcdi\b|\bcdd\b|alternan)/i;
export const IF_CONCERNS = /\bsi\b[^.?!]{0,100}\bconcern/i;
/** Tics relevés par Cowork (#14) : 2e phrase passe-partout, question générique. */
export const TICS = /(vos clients recevraient|vous prend[- ]?(il|elle|ils|elles)?[- ]?(-t-)?(il|elle)? du temps|prend(-t)?-(il|elle) du temps)/i;

const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
const queryParam = (link: string, name: string) => new RegExp(`[?&]${name}=[^&\\s]+`, "i").test(link);

export function relanceCodeChecks(subject: string, body: string, ctx: RelanceContext): RelanceCriterion[] {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const expectedSubject = relanceSubject(ctx.intro);
  const r1 = subject === expectedSubject && blocks[0] === ctx.intro.greeting;
  // R3 : le même lien que l'intro, avec son &v (et &f si l'intro l'avait), sur sa propre ligne.
  const link = ctx.intro.demoLink;
  const demoBlock = link ? blocks.find((block) => block.includes(link)) : undefined;
  const needV = ctx.intro.requireV !== false;
  const linkOk = Boolean(link && (!needV || queryParam(link, "v")) && demoBlock && !demoBlock.includes("\n") && body.split(link).length === 2);
  const r3Citation = !link ? "pas de lien de démo dans l'intro" : needV && !queryParam(link, "v") ? `lien sans &v alors que l'intro en avait un : ${link}` : linkOk ? link : `lien absent ou mêlé au texte : ${link}`;
  const transfer = TRANSFER.test(body);
  const r4 = ctx.generic ? transfer : !transfer;
  const prose = blocks.slice(1).join(" ").replace(new RegExp(DEMO_LINK.source, "gi"), " ");
  const words = countWords(prose);
  const forbidden = body.match(FORBIDDEN)?.[0] ?? body.match(SUPERLATIVE)?.[0];
  const r6 = words >= RELANCE_WORDS.min && words <= RELANCE_WORDS.max && !forbidden;
  const r9 = !NAMELESS_GREETING.test(blocks[0] ?? "");
  const recruitment = prose.match(RECRUITMENT)?.[0];
  const conditional = prose.match(IF_CONCERNS)?.[0];
  const demoSubject = prose.match(DEMO_AS_SUBJECT)?.[0];
  const meta = prose.match(META)?.[0];
  const tic = prose.match(TICS)?.[0];
  return [
    { id: "R1", ok: r1, citation: r1 ? `${expectedSubject} · ${ctx.intro.greeting}` : `objet « ${subject} » (attendu « ${expectedSubject} ») · salutation « ${blocks[0] ?? ""} » (attendue « ${ctx.intro.greeting} »)` },
    { id: "R3", ok: linkOk, citation: r3Citation },
    { id: "R4", ok: r4, citation: ctx.generic ? (transfer ? "adresse générique : transfert demandé" : "adresse générique : phrase de transfert absente") : transfer ? "adresse nominative : phrase de transfert à retirer" : "adresse nominative : pas de transfert" },
    { id: "R6", ok: r6, citation: forbidden ? `formule interdite « ${forbidden} »` : `${words} mots (${RELANCE_WORDS.min} à ${RELANCE_WORDS.max})` },
    { id: "R8", ok: !demoSubject && !meta && !tic, citation: demoSubject ? `la démo en sujet de phrase : « ${demoSubject} »` : meta ? `phrase méta : « ${meta} »` : tic ? `tic : « ${tic} » — nomme le résultat propre à leur cas, ou l'élément manquant précis` : "ni démo en sujet, ni phrase méta, ni tic" },
    { id: "R9", ok: r9, citation: r9 ? blocks[0] ?? "" : `« ${blocks[0]} » sans nom : « Bonjour, »` },
    { id: "R10", ok: !recruitment && !conditional, citation: recruitment ? `recrutement : « ${recruitment} »` : conditional ? `conditionnelle : « ${conditional.trim()} »` : "aucun" },
  ];
}

// --- Lecture du modèle : R2, R5, R7, R8 (vote à 3) ------------------------------------

export interface RelanceFiche {
  companyName: string;
  /** Faits sourcés (key_figures.facts) et signaux datés de la fiche — sans recrutement. */
  facts: readonly string[];
  signals: readonly string[];
  activity: string | null;
}

/** Faits et signaux de recrutement ou d'offre d'emploi : jamais donnés au rédacteur (R10). */
export const withoutRecruitment = (items: readonly string[]) => items.filter((item) => !RECRUITMENT.test(item));

export function ficheBlock(fiche: RelanceFiche): string {
  const facts = withoutRecruitment(fiche.facts);
  const signals = withoutRecruitment(fiche.signals);
  return [
    `Entreprise : ${fiche.companyName}`,
    fiche.activity ? `Activité : ${fiche.activity}` : null,
    facts.length ? `Faits sourcés :\n${facts.map((fact) => `- ${fact}`).join("\n")}` : "Faits sourcés : aucun",
    signals.length ? `Signaux :\n${signals.map((signal) => `- ${signal}`).join("\n")}` : "Signaux : aucun",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRelanceJudgePrompt(): string {
  return `Tu relis la RELANCE d'un mail de prospection (même fil que l'intro), avec l'exigence d'Axel : 9 ou 10/10, sinon elle ne part pas. Tu ne donnes pas de note : OUI (true) ou NON (false) par critère, avec des CITATIONS EXACTES.
La forme (objet, salutation, lien, longueur, phrase de transfert, formules interdites) est vérifiée par un programme : ne la juge pas.

R2 — Nouveauté sur le MÊME sujet : la relance apporte UN élément absent de l'intro, tiré de la fiche, ET reste sur le même processus / la même douleur que l'intro (nouvel angle, pas nouveau sujet). NON si elle reformule l'intro, ou si elle change de sujet (intro sur les documents clients → relance sur les candidatures ; intro sur le rapprochement de factures → relance sur les demandes de pièces). Donne "citation_intro" (le processus de l'intro) et "citation_relance" (l'élément nouveau).
R5 — Appel à l'action : différent de celui de l'intro ET plus léger — une question fermée (oui/non) liée au sujet, ou « dites-moi simplement si c'est un sujet chez vous ». NON s'il redemande un rendez-vous ou 15 minutes, ou s'il est passe-partout.
R7 — Fidélité : tout ce que la relance affirme SUR L'ENTREPRISE (son activité, ses chiffres, ses clients, son organisation, son actualité) vient de la fiche ou de l'intro. NON au moindre fait, chiffre, client inventé, ou à une affirmation supposée sur eux (« sont essentiels pour vous », « de nouvelles personnes interviennent »). La phrase qui dit ce que la solution CHANGERAIT pour eux (au conditionnel : « votre client recevrait son devis plus vite ») est un résultat attendu, pas un fait sur l'entreprise : elle ne viole R7 que si elle y glisse un fait, un chiffre ou un client inventé.
R8 — Ton : la 1re phrase parle d'EUX (leur activité, leur client, leur situation), la 2e DÉCOULE de la 1re et nomme ce que ça CHANGERAIT pour eux dans ce cas précis (rendez-vous fixé, remise juste, devis complet). NON si la 2e phrase n'a pas de lien direct avec la 1re, si elle est passe-partout (« vos clients recevraient une réponse adaptée »), si une phrase décrit la mécanique de l'outil ou de la démo, si une phrase est alambiquée ou lourde (« Vous indiquez que l'on peut désormais… »), si un détail produit est trop pointu pour un premier échange, ou si une phrase parle de l'échange lui-même.

Réponds UNIQUEMENT en JSON : {"R2":{"ok":true|false,"citation_intro":"…","citation_relance":"…"},"R5":{"ok":true|false,"citation":"…"},"R7":{"ok":true|false,"citation":"…"},"R8":{"ok":true|false,"citation":"…"}}`;
}

type Sample = Partial<Record<(typeof LLM_IDS)[number], { ok: boolean; citation: string }>>;

export function parseRelanceJudge(raw: string): Sample | null {
  let value: Record<string, { ok?: unknown; citation?: unknown; citation_intro?: unknown; citation_relance?: unknown }>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const sample: Sample = {};
  for (const id of LLM_IDS) {
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
  return LLM_IDS.map((id) => {
    const votes = read.map((sample) => sample[id]!);
    const yes = votes.filter((vote) => vote.ok).length;
    const ok = yes > votes.length - yes;
    return { id, ok, citation: (votes.find((vote) => vote.ok === ok && vote.citation) ?? votes[0]).citation };
  });
}

/** R8 a une part de code (démo en sujet, méta) et une part de lecture : les deux doivent passer. */
export function relanceVerdictOf(items: RelanceCriterion[]): RelanceVerdict {
  const merged = new Map<RelanceCriterionId, RelanceCriterion>();
  for (const item of items) {
    const previous = merged.get(item.id);
    merged.set(item.id, previous ? { id: item.id, ok: previous.ok && item.ok, citation: previous.ok ? item.citation : previous.citation } : item);
  }
  const sorted = [...merged.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const misses = sorted.filter((item) => !item.ok).length;
  return { items: sorted, ready: sorted.length === ORDER.length && misses === 0, score: Math.max(0, Math.round((10 - misses * 1.5) * 10) / 10) };
}

/** Crédit OpenAI épuisé : on le fait suivre ; toute autre panne = lecture illisible. */
const keepQuota = (error: unknown): string => {
  if (isOpenAIQuotaError(error)) throw error;
  return "";
};

/**
 * Grille complète : le code d'abord ; la lecture du modèle seulement si le code passe
 * (sauf `alwaysRead`, pour mesurer l'accord du juge sur un jeu de référence).
 * `null` = relecture indisponible.
 */
export async function judgeRelance(
  ask: AskFn,
  input: { subject: string; body: string; ctx: RelanceContext; introBody: string; fiche: RelanceFiche },
  operation = "relance:grille",
  samples = RELANCE_JUDGE_SAMPLES,
  alwaysRead = false,
): Promise<RelanceVerdict | null> {
  const code = relanceCodeChecks(input.subject, input.body, input.ctx);
  if (!alwaysRead && code.some((item) => !item.ok)) return relanceVerdictOf(code);
  const semantic = await readRelance(ask, input, operation, samples);
  if (!semantic) return null;
  return relanceVerdictOf([...code, ...semantic]);
}

/** Lecture du modèle SEULE (R2, R5, R7, R8), vote à `samples` : `null` si aucune lecture lisible. */
export async function readRelance(
  ask: AskFn,
  input: { body: string; introBody: string; fiche: RelanceFiche },
  operation = "relance:grille",
  samples = RELANCE_JUDGE_SAMPLES,
): Promise<RelanceCriterion[] | null> {
  const user = `FICHE\n${ficheBlock(input.fiche)}\n\nINTRO ENVOYÉE\n${input.introBody.slice(0, 3000)}\n\nRELANCE\n${input.body}`;
  const raws = await Promise.all(
    Array.from({ length: Math.max(1, samples) }, (_, index) => ask("judge", buildRelanceJudgePrompt(), user, 0, index ? `${operation}:lecture-${index + 1}` : operation).catch(keepQuota)),
  );
  return relanceMajority(raws.map(parseRelanceJudge));
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
  return `Tu écris, pour Axel Remillat (freelance en IA et automatisation de tâches pour les PME), la ${last ? "DERNIÈRE relance (J+7)" : "relance (J+4)"} d'un mail de prospection resté sans réponse. Elle part dans le même fil que l'intro. Exigence d'Axel : 9 ou 10/10.

LE CODE ASSEMBLE LA RELANCE AINSI (tu n'écris QUE "about", "outcome" et "cta") :
<salutation de l'intro>

<ABOUT> <OUTCOME>

<ligne courte> <lien de démo de l'intro>
${input.generic ? "\nSi le sujet est suivi par quelqu'un d'autre chez vous, merci de lui transférer ce message.\n" : ""}
<CTA>

À ÉCRIRE :
- "about" — UNE phrase sur EUX : leur activité, leur client ou leur situation, avec un élément de la fiche ABSENT de l'intro, mais sur le MÊME processus que l'intro (si l'intro parlait des devis, tu restes sur les devis ; si elle parlait des factures, sur les factures). Nouvel angle, jamais nouveau sujet. Simple et naturelle : pas de « Vous indiquez que… », pas de détail produit pointu.
- "outcome" — UNE phrase, AU CONDITIONNEL, qui DÉCOULE de "about" : le résultat concret propre à CE cas (un rendez-vous fixé plus vite, la bonne remise appliquée, un devis complet du premier coup). Le sujet est eux, leur équipe ou l'objet concret (« le rendez-vous », « la remise », « le devis »), JAMAIS « la démo », « l'outil », « l'automatisation » ; JAMAIS « Vos clients recevraient… » ; aucun chiffre ni fait nouveau sur l'entreprise.
- "cta" — plus léger que l'intro et différent d'elle : une question fermée (oui / non) qui NOMME l'élément manquant ou le blocage précis de leur cas (« Les prescriptions manquantes ralentissent-elles votre accueil l'été ? »), ou « Dites-moi simplement si c'est un sujet chez vous. » JAMAIS « … vous prend-il / elle du temps ? ».${last ? " Dernier message : tu peux le dire simplement, sans insister." : ""} Jamais un rendez-vous, jamais « 15 minutes », jamais une formule passe-partout.
- Longueur : la relance complète fait ${RELANCE_WORDS.min} à ${RELANCE_WORDS.max} mots (ligne du lien${input.generic ? " et phrase de transfert" : ""} comprises) — ${input.generic ? '"about" 10 à 15 mots, "outcome" 8 à 12 mots, "cta" 5 à 9 mots' : '"about" 12 à 20 mots, "outcome" 10 à 16 mots, "cta" 6 à 10 mots'}.

EXEMPLE DE TON noté 9/10 par Axel (autre cas — n'en reprends AUCUN mot) :
« Pendant l'été, votre accueil en sous-effectif gère aussi les demandes de rendez-vous d'imagerie. Votre accueil pourrait fixer plus vite les rendez-vous dont la prescription est déjà jointe. » — question : « Les prescriptions manquantes ralentissent-elles votre accueil l'été ? »
Concret, daté, une situation précise, une 2e phrase qui en découle, une question qui nomme ce qui manque.

INTERDITS : toute mention de recrutement, d'offre d'emploi ou d'embauche ; toute conditionnelle « Si … concerne … » ; toute phrase sur l'échange lui-même (« mon premier message », « comme je vous l'écrivais ») ; « Je me permets », « Je reviens vers vous », « L'idée est », « Cela peut », « sans réponse de votre part », « N'hésitez pas » ; toute culpabilisation ; tout superlatif ; tout fait, chiffre, client ou conséquence absents de la fiche et de l'intro ; toute salutation, signature ou lien.${input.feedback ? `\n\nRÉÉCRITURE — la version précédente a échoué sur ces critères, corrige-les SANS toucher au reste :\n${input.feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"about":"…","outcome":"…","cta":"…"}`;
}

export function parseRelanceParts(raw: string): RelanceParts | null {
  try {
    const value = JSON.parse(raw) as { about?: unknown; outcome?: unknown; cta?: unknown };
    const text = (key: unknown) => (typeof key === "string" ? key.trim() : "");
    const parts = { about: text(value.about), outcome: text(value.outcome), cta: text(value.cta) };
    return parts.about && parts.outcome && parts.cta ? parts : null;
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
  input: { introSubject: string | null; introBody: string; generic: boolean; fiche: RelanceFiche; type: "relance_1" | "relance_2"; introFamily?: string | null },
): Promise<RelanceOutcome | { error: string }> {
  const intro = introParts(input.introSubject, input.introBody, input.introFamily);
  const ctx: RelanceContext = { intro, generic: input.generic, seed: input.fiche.companyName };
  const subject = relanceSubject(intro);
  const user = `${ficheBlock(input.fiche)}\n\nINTRO ENVOYÉE (objet : ${intro.subject})\n${input.introBody.slice(0, 3000)}\n\nAppel à l'action de l'intro, à NE PAS reprendre : ${intro.cta ?? "—"}`;
  let feedback: string | null = null;
  let best: RelanceOutcome | null = null;
  let rounds = 0;
  for (let round = 0; round < 2; round += 1) {
    rounds = round + 1;
    const raw = await ask("writer", buildRelanceWriterPrompt({ generic: input.generic, type: input.type, feedback }), user, round ? 0.4 : 0.6, `relance:redaction${round ? ":rewrite" : ""}`).catch(keepQuota);
    const parts = parseRelanceParts(raw);
    if (!parts) {
      feedback = '- La réponse n\'était pas le JSON demandé : {"about":"…","outcome":"…","cta":"…"}.';
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
      attempts: rounds,
    };
    if (!best || (verdict?.score ?? 0) > (best.verdict?.score ?? 0)) best = outcome;
    if (outcome.ready || !verdict) break;
    feedback = relanceFeedback(verdict);
  }
  return best ? { ...best, attempts: rounds } : { error: "Relance inexploitable : le rédacteur n'a rendu aucun texte utilisable." };
}

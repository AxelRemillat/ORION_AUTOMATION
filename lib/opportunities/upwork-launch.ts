/**
 * RÈGLES « LANCEMENT UPWORK » (Cowork #18).
 *
 * Axel vient d'ouvrir son compte : l'enjeu des premières semaines n'est pas de
 * gagner beaucoup, c'est de décrocher deux ou trois missions courtes dans son
 * métier et d'obtenir des avis. Ce module dit donc, pour une offre reçue par
 * e-mail d'alerte, laquelle mérite de réveiller son téléphone.
 *
 * Code PUR, testable sans base ni modèle. Il ne remplace ni le pré-filtre ni
 * le score (`prefilter.ts`, `analyze.ts`, le lot d'agent4) : il s'ajoute, avec
 * deux responsabilités précises — refuser ce qu'on ne fera jamais, et repérer
 * l'offre de lancement.
 */

/** Ce qu'Axel sait faire et vend : le cœur de son positionnement Upwork. */
const LAUNCH_TOPICS: readonly { label: string; pattern: RegExp }[] = [
  { label: "n8n", pattern: /\bn8n\b/i },
  { label: "automatisation", pattern: /\b(automation|automate|automating|workflow automation|zapier|make\.com|integromat)\b/i },
  { label: "agent IA", pattern: /\b(ai agent|agentic|llm agent|gpt agent|autonomous agent)\b/i },
  { label: "intégration d'API", pattern: /\b(api integration|integrate .{0,30}api|rest api|webhook|third[- ]party integration)\b/i },
  { label: "chatbot", pattern: /\b(chatbot|chat bot|conversational (ai|agent|bot)|rag\b|retrieval[- ]augmented)\b/i },
];

/**
 * REFUS FERMES. Le scraping d'un site contre ses conditions d'utilisation n'est
 * pas une question de prix : on ne le fait pas, et on ne veut pas que
 * l'alerte le propose. Même chose pour le contenu adulte et le « test non
 * rémunéré », qui est un travail gratuit déguisé.
 */
const REFUSALS: readonly { reason: string; pattern: RegExp }[] = [
  {
    reason: "scraping d'un site contre ses conditions d'utilisation",
    pattern:
      /\b(scrap(e|ing|er)|crawl(er|ing)?|data extraction|harvest(ing)?)\b[^.]{0,60}\b(linkedin|facebook|instagram|twitter|x\.com|tiktok|google maps|indeed|amazon|zillow)\b|\b(linkedin|facebook|instagram|tiktok)\b[^.]{0,40}\b(scrap(e|ing|er)|crawl(er|ing)?|bot to (collect|extract))\b/i,
  },
  { reason: "contenu adulte", pattern: /\b(adult (content|site|website|industry)|porn\w*|nsfw|escort|camgirl|onlyfans)\b/i },
  { reason: "test non rémunéré", pattern: /\b(unpaid (test|trial|task|work)|free (test|trial|sample)( task| project)?|test task .{0,20}(unpaid|free)|no pay for the test)\b/i },
];

export interface UpworkOffer {
  title: string;
  /** Extrait de l'annonce tel que l'e-mail le porte. */
  description?: string | null;
  /** Texte du budget : « $500 », « $25.00-$45.00 /hr », « Hourly »… */
  budgetText?: string | null;
  /** Date de publication, ou à défaut la date de l'e-mail. */
  publishedAt?: string | null;
}

const haystack = (offer: UpworkOffer) => `${offer.title}\n${offer.description ?? ""}`;

/** Motif de refus, ou `null`. Le budget trop bas en fait partie. */
export function upworkIgnoreReason(offer: UpworkOffer): string | null {
  const text = haystack(offer);
  for (const refusal of REFUSALS) if (refusal.pattern.test(text)) return refusal.reason;
  const budget = readUpworkBudget(offer.budgetText);
  // Moins de 30 $ : le temps de lire l'annonce coûte déjà plus que la mission.
  if (budget.kind === "fixed" && budget.usd !== null && budget.usd < 30) return `budget de ${budget.usd} $ : moins de 30 $`;
  // Horaire : plancher à 20 $/h (Cowork #68) — 25 $/h est justement le taux de lancement d'Axel.
  if (budget.kind === "hourly" && budget.usd !== null && budget.usd < 20) return `taux de ${budget.usd} $/h : moins de 20 $`;
  return null;
}

export type UpworkBudget =
  | { kind: "fixed"; usd: number | null }
  | { kind: "hourly"; usd: number | null }
  | { kind: "inconnu"; usd: null };

/**
 * Lecture du budget Upwork. Une fourchette horaire (« $25.00-$45.00 /hr »)
 * rend sa BORNE BASSE : c'est ce que le client a en tête comme plancher, et
 * c'est la seule valeur sur laquelle on peut décider sans se raconter
 * d'histoires.
 */
/**
 * Montants en dollars lus dans un texte Upwork.
 *
 * Le séparateur de MILLIERS est le piège, et il coûte cher : « $8,000 » se
 * lisait 8 dollars, donc une offre à 8 000 $ repartait en « moins de 30 $ ».
 * Trois chiffres après le séparateur = des milliers ; un ou deux = des
 * décimales (« $25.00 »).
 */
/**
 * C'est le DERNIER séparateur qui décide : trois chiffres après lui, ce sont
 * des milliers (« 8,000 », « 1,500.00 » → les deux séparateurs se lisent
 * ensemble) ; un ou deux, c'est une décimale (« 25.00 »).
 */
function normalizeAmount(token: string): string {
  const last = Math.max(token.lastIndexOf("."), token.lastIndexOf(","));
  if (last < 0) return token;
  const after = token.length - last - 1;
  const head = token.slice(0, last).replace(/[.,]/g, "");
  return after === 3 ? `${head}${token.slice(last + 1)}` : `${head}.${token.slice(last + 1)}`;
}

function readAmounts(raw: string): number[] {
  const values: number[] = [];
  for (const match of raw.matchAll(/\$\s?([\d][\d.,\s]*)|([\d][\d.,]*)\s?(?:usd|dollars?)\b/gi)) {
    const token = (match[1] ?? match[2] ?? "").trim().replace(/\s/g, "").replace(/[.,]+$/, "");
    const value = Number(normalizeAmount(token));
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return values;
}

export function readUpworkBudget(text: string | null | undefined): UpworkBudget {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "inconnu", usd: null };
  // « $25.00-$45.00 /hr » : `\b` avant « / » exige un caractère de mot juste avant ; l'espace faisait
  // lire l'offre comme un prix FIXE de 45 $ (Cowork #22). Chaque forme porte donc sa propre frontière.
  const hourly = /(\bhourly\b|\/\s?hr\b|\bper hour\b|\ban hour\b|\/\s?heure\b)/i.test(raw);
  const amounts = readAmounts(raw);
  if (hourly) return { kind: "hourly", usd: amounts.length ? Math.min(...amounts) : null };
  if (!amounts.length) return { kind: "inconnu", usd: null };
  // Prix fixe annoncé en fourchette : la borne HAUTE est le budget du client.
  return { kind: "fixed", usd: Math.max(...amounts) };
}

/** Les sujets reconnus dans l'offre (vide = hors métier). */
export function upworkTopics(offer: UpworkOffer): string[] {
  const text = haystack(offer);
  return LAUNCH_TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.label);
}

export const LAUNCH_FIXED_MAX_USD = 500;
export const LAUNCH_FRESH_HOURS = 24;

export interface LaunchVerdict {
  /** `true` = alerte + notification ; `false` = « À voir ». */
  alert: boolean;
  topics: string[];
  budget: UpworkBudget;
  /** Pourquoi ça n'alerte pas — à afficher, pas à deviner. */
  reason: string;
}

/**
 * OFFRE DE LANCEMENT : dans le métier, petite ou horaire, et fraîche.
 *
 * Les trois conditions comptent ensemble. Une offre n8n à 4 000 $ est bonne
 * mais ce n'est pas une mission de lancement ; une offre n8n d'il y a trois
 * jours a déjà vingt propositions. La fraîcheur est la condition qu'on oublie
 * le plus souvent, et c'est celle qui décide.
 */
export function upworkLaunchVerdict(offer: UpworkOffer, now = new Date()): LaunchVerdict {
  const topics = upworkTopics(offer);
  const budget = readUpworkBudget(offer.budgetText);
  const base = { topics, budget };

  const ignored = upworkIgnoreReason(offer);
  if (ignored) return { ...base, alert: false, reason: ignored };
  if (topics.length === 0) return { ...base, alert: false, reason: "hors du métier (ni n8n, ni automatisation, ni agent IA, ni intégration, ni chatbot)" };

  const fits = budget.kind === "hourly" || (budget.kind === "fixed" && budget.usd !== null && budget.usd <= LAUNCH_FIXED_MAX_USD);
  if (!fits) {
    const detail = budget.kind === "fixed" ? `budget fixe de ${budget.usd} $ : au-dessus de ${LAUNCH_FIXED_MAX_USD} $` : "budget inconnu";
    return { ...base, alert: false, reason: detail };
  }

  const published = offer.publishedAt ? Date.parse(offer.publishedAt) : NaN;
  const hours = Number.isNaN(published) ? null : (now.getTime() - published) / 3_600_000;
  if (hours === null) return { ...base, alert: false, reason: "date de publication inconnue" };
  if (hours >= LAUNCH_FRESH_HOURS) {
    return { ...base, alert: false, reason: `publiée il y a ${Math.floor(hours)} h : plus de ${LAUNCH_FRESH_HOURS} h` };
  }

  return { ...base, alert: true, reason: `offre de lancement : ${topics.join(", ")}` };
}

export const LAUNCH_FLOOR_USD = 100;
export const LAUNCH_HOURLY_USD = 25;
/** Remise appliquée au budget affiché pour entrer sur la plateforme. */
export const LAUNCH_DISCOUNT = { min: 0.15, max: 0.2 } as const;

export type LaunchPrice = { kind: "fixed"; usd: number } | { kind: "hourly"; usd: number } | { kind: "inconnu"; usd: null };

/**
 * PRIX DE LANCEMENT. Fixe : 15 à 20 % sous le budget affiché — on prend le
 * milieu, 17,5 %, arrondi aux 5 $ — avec un plancher de 100 $. Horaire :
 * 25 $/h, sous le positionnement habituel (40 $/h) le temps d'obtenir les
 * premiers avis.
 *
 * Le plancher n'est pas un détail : sous 100 $, la commission Upwork et le
 * temps de cadrage mangent la mission.
 */
export function upworkLaunchPrice(budgetText: string | null | undefined): LaunchPrice {
  const budget = readUpworkBudget(budgetText);
  if (budget.kind === "hourly") return { kind: "hourly", usd: LAUNCH_HOURLY_USD };
  if (budget.kind !== "fixed" || budget.usd === null) return { kind: "inconnu", usd: null };
  const middle = (LAUNCH_DISCOUNT.min + LAUNCH_DISCOUNT.max) / 2;
  const discounted = Math.round((budget.usd * (1 - middle)) / 5) * 5;
  return { kind: "fixed", usd: Math.max(LAUNCH_FLOOR_USD, discounted) };
}

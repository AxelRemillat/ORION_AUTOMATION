import type { Language, Platform } from "./types";

/**
 * RÈGLES PAR PLATEFORME (Cowork, plateformes #1, 07/10/2026) — la plateforme
 * est une vraie dimension : langue, coordonnées, longueur, ouverture, prix.
 *
 *   - Codeur, Malt, ComeUp : français, AUCUNE URL ni coordonnée (règle #87/#88),
 *     message privé de 1 000 caractères.
 *   - Upwork : anglais, signature sans le site (#88). La 1re phrase s'affiche
 *     en aperçu dans la liste du client : elle doit accrocher (pas de
 *     « Hello, », pas de « I am… »). 1 200 caractères au plus, UN prix (montant
 *     fixe OU taux horaire, en dollars) et UN délai — toujours, même sans
 *     budget affiché : le formulaire Upwork exige une enchère.
 *   - Autre : langue de l'annonce, pas de contrainte de plateforme.
 *
 * Code pur, partagé par le rédacteur, les règles déterministes et les tests.
 */

export interface PlatformRules {
  /** Langue imposée (`null` : celle de l'annonce). */
  language: Language | null;
  /** Aucune URL, aucun moyen de contact hors plateforme. */
  noContact: boolean;
  /** Longueur maximale du texte final, signature comprise (`null` : pas de limite propre). */
  maxChars: number | null;
  /** La 1re phrase est l'aperçu : pas de salutation, une accroche. */
  hookFirst: boolean;
  /** Devise de l'enchère. */
  currency: "EUR" | "USD";
  /** Prix et délai obligatoires, même sans budget affiché. */
  priceRequired: boolean;
}

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  codeur: { language: "fr", noContact: true, maxChars: 1000, hookFirst: false, currency: "EUR", priceRequired: false },
  malt: { language: "fr", noContact: true, maxChars: 1000, hookFirst: false, currency: "EUR", priceRequired: false },
  comeup: { language: "fr", noContact: true, maxChars: 1000, hookFirst: false, currency: "EUR", priceRequired: false },
  upwork: { language: "en", noContact: false, maxChars: 1200, hookFirst: true, currency: "USD", priceRequired: true },
  autre: { language: null, noContact: false, maxChars: null, hookFirst: false, currency: "EUR", priceRequired: false },
};

// --- Upwork ---------------------------------------------------------------------

export const UPWORK_MAX_CHARS = 1200;
/** Au-delà, réécriture de raccourcissement (comme le message privé Codeur). */
export const UPWORK_SHORTEN_ABOVE = 1170;
export const UPWORK_SHORTEN_TARGET = 1080;
/** Aperçu Upwork : la 1re phrase, lue avant d'ouvrir la proposition. */
export const UPWORK_HOOK_MAX_CHARS = 200;
export const UPWORK_WORDS = { min: 90, max: 170 } as const;
/**
 * Positionnement en dollars (profil récent, objectif premiers avis) : les
 * repères en euros d'Axel, arrondis en USD ; taux horaire 40 $/h.
 */
export const UPWORK_HOURLY_USD = 40;
export const UPWORK_HOURLY_CAP_USD = 60;
export const UPWORK_FIXED_CAP_USD = { automatisation: 3300, fullstack: 4400 } as const;

export function upworkPricingGuide(kind: "automatisation" | "fullstack"): string {
  return kind === "fullstack"
    ? `ONE price in US dollars: a fixed amount (MVP or simple internal tool $1,300 to $2,700, fuller web app $2,700 to $4,400 AT MOST) OR an hourly rate of $${UPWORK_HOURLY_USD}/hr if the job is hourly. Realistic timeline (2 to 6 weeks).`
    : `ONE price in US dollars: a fixed amount (simple task $300 to $650, complete automation $650 to $1,300, complex multi-system project $1,600 to $3,300 AT MOST) OR an hourly rate of $${UPWORK_HOURLY_USD}/hr if the job is hourly. Timeline: 1 to 2 weeks, 2 to 3 weeks for complex work.`;
}

/** Ouvertures qui gâchent l'aperçu : salutation, présentation de soi. */
export const WEAK_OPENING = /^(hi\b|hello\b|hey\b|dear\b|greetings\b|good (morning|afternoon|evening)\b|i am\b|i'm\b|i’m\b|my name\b|as an?\b|thank you for|thanks for|i have read|i read your|i came across)/i;

/** Première phrase (jusqu'au premier . ! ? suivi d'un espace ou d'un saut de ligne). */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : trimmed.split("\n")[0]).trim();
}

/** Montants en dollars (« $1,500 », « 1500 USD », « $40/hr »), avec leur nature. */
export function usdAmounts(text: string): { value: number; hourly: boolean }[] {
  const found: { value: number; hourly: boolean; at: number }[] = [];
  const hourlyAfter = (end: number) => /^\s?(\/\s?(hr|hour|h)\b|per hour|an hour|hourly)/i.test(text.slice(end, end + 12));
  for (const match of text.matchAll(/(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)(\s?k\b)?/gi)) {
    const value = Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
    if (Number.isFinite(value) && value > 0) found.push({ value, hourly: hourlyAfter((match.index ?? 0) + match[0].length), at: match.index ?? 0 });
  }
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(USD|dollars?)\b/gi)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0 && !found.some((item) => Math.abs(item.at - (match.index ?? 0)) < 3)) {
      found.push({ value, hourly: hourlyAfter((match.index ?? 0) + match[0].length), at: match.index ?? 0 });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ value, hourly }) => ({ value, hourly }));
}

/** Une fourchette en dollars (« $500–800 », « $30 to $45/hr », « between $1,000 and $1,500 »). */
export function usdRange(text: string): string | null {
  const match = text.match(/(between\s+)?\$\s?\d[\d,]*\s?(k\s?)?(-|–|to|and)\s?\$?\s?\d[\d,]*/i);
  return match ? match[0].trim() : null;
}

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|a|a couple of";
/** Délai cité (« 10 days », « three weeks », « 2-3 weeks »). */
export const DELAY_EN = new RegExp(`\\b(\\d+|${NUMBER_WORDS})(\\s?(-|–|to)\\s?\\d+)?\\s?(business |working )?(days?|weeks?|months?)\\b`, "i");

/**
 * Règles Upwork sur le texte FINAL (signature comprise) et le cadrage :
 * longueur, accroche, un prix, un délai.
 */
export function upworkFailures(text: string, framing: string): string[] {
  const failures: string[] = [];
  if (text.length > UPWORK_MAX_CHARS) failures.push(`${text.length} characters: an Upwork proposal is ${UPWORK_MAX_CHARS} characters at most (signature included). Remove about ${text.length - UPWORK_MAX_CHARS + 40} characters.`);
  const hook = firstSentence(text);
  if (WEAK_OPENING.test(hook)) failures.push(`Opening « ${hook.slice(0, 60)} » wastes the preview: start with the client's concrete problem or outcome — no greeting, no self-introduction.`);
  else if (hook.length > UPWORK_HOOK_MAX_CHARS) failures.push(`First sentence of ${hook.length} characters: the preview shows about ${UPWORK_HOOK_MAX_CHARS} — make the hook shorter.`);
  const range = usdRange(framing);
  if (range) failures.push(`Price range (« ${range} »): give ONE price — a fixed amount or an hourly rate.`);
  const prices = usdAmounts(framing);
  if (!prices.length) failures.push("Upwork: no price in US dollars — give ONE price (fixed amount or hourly rate), the bid needs one.");
  else if (!range && new Set(prices.map((item) => `${item.value}${item.hourly ? "h" : ""}`)).size > 1) failures.push(`${prices.length} different prices: give ONE price — a fixed amount or an hourly rate.`);
  if (!DELAY_EN.test(framing)) failures.push("Upwork: no timeline — give ONE delivery time (e.g. « 10 days »).");
  return failures;
}

/**
 * Délai le plus long cité en anglais, en jours (« 10 days », « 2-3 weeks »,
 * « 1 month »). Frontière de mot stricte : « 150 monthly leads » n'est pas un
 * délai (le parseur commun le lisait comme 4 500 jours — essai réel du 07/10).
 */
export function delayDaysEn(text: string): number | null {
  const values = [...text.matchAll(/\b(\d+)(?:\s?(?:-|–|to)\s?(\d+))?\s?(?:business |working )?(days?|weeks?|months?)\b/gi)].map((match) => {
    const value = Number(match[2] ?? match[1]);
    const unit = match[3].toLowerCase();
    return unit.startsWith("week") ? value * 7 : unit.startsWith("month") ? value * 30 : value;
  });
  return values.length ? Math.max(...values) : null;
}

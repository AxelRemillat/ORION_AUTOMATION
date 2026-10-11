import { classifyAd, CMS_NOTE, type PrefilterInput } from "./prefilter";
import type { Platform } from "./types";

/**
 * CATÉGORIES CODEUR (décision d'Axel, 11/10/2026) — code pur, importable côté client.
 *
 * MISSION DE LANCEMENT : une offre de DÉVELOPPEMENT WEB (site, landing, blog, affiliation,
 * application web, SaaS, MVP) sans CMS imposé, budget de 1 000 € au plus ou non indiqué,
 * publiée il y a 7 jours au plus → ALERTE quel que soit le score d'adéquation.
 * CMS IMPOSÉ → « À voir », sans alerte. Sans colonne : tout se déduit du titre, du texte,
 * des catégories, du budget et de la date de la fiche.
 */

export const LAUNCH_BADGE = "Lancement";
export const LAUNCH_MAX_BUDGET_EUR = 1000;
/** Prix fixes de lancement : 300 € sous 500 € de budget, 400 € au-delà. */
export const LAUNCH_PRICES = { small: 300, regular: 400 } as const;
/** « Urgent » : publiée il y a moins de 2 h (répondre parmi les premiers). */
export const URGENT_HOURS = 2;

export type Lane = "lancement" | "cms_impose";

export const plainText = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const plain = plainText;

/** Plus grand montant en euros d'un budget (« Moins de 500 € » → 500, « 500 € à 1 000 € » → 1 000), `null` si aucun. */
export function budgetMaxEur(budgetText: string | null | undefined): number | null {
  const amounts = [...plain(budgetText ?? "").matchAll(/(\d[\d\s.]*)\s*(€|eur)/g)].map((match) => Number(match[1].replace(/[\s.]/g, ""))).filter((value) => Number.isFinite(value) && value > 0);
  return amounts.length ? Math.max(...amounts) : null;
}

/** « Plus de 1 000 € » n'est jamais un petit budget. */
const OPEN_ABOVE = /(plus de|au-dessus de|a partir de|superieur a)/;

/**
 * Budget de mission de lancement : 1 000 € au plus, ou NON INDIQUÉ — les alertes e-mail
 * Codeur ne donnent que le titre (491048, 491062, 491078 : budget absent), et un petit
 * projet web sans budget affiché reste une mission à prendre parmi les premiers.
 */
export function launchBudget(budgetText: string | null | undefined): boolean {
  const max = budgetMaxEur(budgetText);
  if (max === null) return true;
  return max <= LAUNCH_MAX_BUDGET_EUR && !OPEN_ABOVE.test(plain(budgetText ?? ""));
}

/** Prix fixe de lancement : 300 € si le budget est sous 500 € (« Moins de 500 € » compris), sinon 400 €. */
export function launchPrice(budgetText: string | null | undefined): number {
  const max = budgetMaxEur(budgetText) ?? LAUNCH_MAX_BUDGET_EUR;
  const below = /moins de/.test(plain(budgetText ?? "")) ? max <= 500 : max < 500;
  return below ? LAUNCH_PRICES.small : LAUNCH_PRICES.regular;
}

/** Site (7 jours) ou application (3 semaines). */
export function launchKind(text: string): "site" | "app" {
  return /(application|appli\b|\bapp\b|saas|plate-?forme|\bmvp\b|outil|espace (membre|client)|logiciel)/.test(plain(text)) ? "app" : "site";
}

export const LAUNCH_DELAY = { site: { days: 7, label: "7 jours" }, app: { days: 21, label: "3 semaines" } } as const;

type LaneInput = {
  platform: Platform;
  title: string;
  body?: string | null;
  description?: string | null;
  categories?: readonly string[] | null;
  budget?: string | null;
  published_at?: string | null;
  created_at?: string | null;
};

/** Au-delà de 7 jours, une annonce n'est plus une mission à prendre parmi les premiers (cf. STALE_AFTER_DAYS). */
export const LAUNCH_FRESH_DAYS = 7;

/** Catégorie Codeur d'une annonce : « lancement », « cms_impose » ou `null` (y compris si elle est exclue). */
export function laneOf(row: LaneInput, now = new Date()): Lane | null {
  if (row.platform !== "codeur") return null;
  const ad: PrefilterInput = { title: row.title ?? "", description: row.description ?? row.body ?? "", categories: row.categories ?? [], budgetText: row.budget ?? null };
  const found = classifyAd(ad);
  if (found.reason) return null;
  if (found.cms) return "cms_impose";
  const at = row.published_at ?? row.created_at;
  const fresh = !at || Number.isNaN(Date.parse(at)) || now.getTime() - Date.parse(at) <= LAUNCH_FRESH_DAYS * 86_400_000;
  return found.webDev && launchBudget(row.budget) && fresh ? "lancement" : null;
}

export { CMS_NOTE };

/** Nombre d'offres déjà déposées, si le flux ou l'e-mail le donne (« 12 offres déposées », « Offres : 3 »), sinon `null`. */
export function offersCount(text: string | null | undefined): number | null {
  const value = plain(text ?? "");
  const match = value.match(/(\d{1,3})\s*(?:offres?|propositions?)\s*(?:deja\s*)?(?:deposees?|recues?|envoyees?)/) ?? value.match(/(?:nombre d'offres|offres? (?:deposees?|recues?))\s*:?\s*(\d{1,3})/);
  return match ? Number(match[1]) : null;
}

/** Publiée il y a moins de 2 h. */
export function isUrgent(publishedAt: string | null | undefined, now = new Date()): boolean {
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return false;
  const hours = (now.getTime() - Date.parse(publishedAt)) / 3_600_000;
  return hours >= 0 && hours < URGENT_HOURS;
}

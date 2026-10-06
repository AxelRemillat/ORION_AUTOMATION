/**
 * Ce que l'annonce DEMANDE explicitement, et le POSITIONNEMENT DE PRIX d'Axel
 * (Cowork, 06/10/2026 — relecture de la proposition Sage 100 : notée 9 par le
 * juge, ~7 en réalité : pas de « Bonjour », une fourchette de 4 000 à 6 000 €
 * en 4 à 6 semaines, maintenance « 100 à 250 €/mois », références ignorées).
 *
 * Code pur, partagé par le rédacteur (consignes), les règles et les tests.
 */

export type ProjectKind = "automatisation" | "fullstack";

export type RequestedItem = "approche" | "prix" | "couts_mensuels" | "delai" | "references";

export const REQUESTED_LABELS: Record<RequestedItem, string> = {
  approche: "approche technique",
  prix: "prix",
  couts_mensuels: "coûts mensuels",
  delai: "délai",
  references: "références",
};

const plain = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Le passage où l'annonce liste ce qu'il faut fournir (« Merci d'indiquer dans votre devis : … »). */
const REQUEST_BLOCK = /(merci (de nous |d')?(indiquer|preciser|fournir|joindre)|indiquez|precisez|veuillez (indiquer|preciser|fournir)|votre (devis|proposition|reponse) (doit|devra) (contenir|comprendre|preciser)|dans votre (devis|proposition|reponse)|please (include|provide|specify|indicate)|in your (proposal|quote|bid))/;

const ITEM_PATTERNS: { item: RequestedItem; pattern: RegExp }[] = [
  { item: "approche", pattern: /(approche (technique)?|methodologie|solution technique|architecture|technical approach|methodology|how you would)/ },
  { item: "prix", pattern: /(prix|tarif|cout du developpement|montant|chiffrage|\bprice\b|\bcost of\b|\bquote\b|fixed fee|rate)/ },
  { item: "couts_mensuels", pattern: /(couts? mensuels?|cout mensuel|abonnement|couts? recurrents?|frais (mensuels|recurrents)|monthly (cost|fee)|running costs?|hebergement)/ },
  { item: "delai", pattern: /(delai|planning|calendrier|duree|disponibilite|timeline|turnaround|how long|deadline)/ },
  { item: "references", pattern: /(references?|realisations?|portfolio|exemples? de projets|projets similaires|similar (projects|work)|examples? of)/ },
];

/** Éléments demandés explicitement, dans l'ordre où l'annonce les cite ([] s'il n'y a pas de liste). */
export function requestedItems(ad: string): RequestedItem[] {
  const text = plain(ad);
  const start = text.search(REQUEST_BLOCK);
  if (start < 0) return [];
  const block = text.slice(start, start + 700);
  return ITEM_PATTERNS.map(({ item, pattern }) => ({ item, at: block.search(pattern) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
}

/**
 * Positionnement (profil récent, objectif premiers avis) :
 *   automatisation — simple 300–600 €, workflow complet 600–1 200 €,
 *   multi-systèmes complexe (ERP/Sage, scraping avec connexion, installation)
 *   1 500–3 000 € au plus, 2 à 3 semaines ;
 *   full-stack — MVP / outil interne simple 1 200–2 500 €, appli plus complète
 *   2 500–4 000 € au plus, ou TJM 350 € si l'annonce raisonne en jours.
 * Référence réelle : Sage 100 (multi-systèmes), Axel a proposé 2 400 € / 15 j.
 */
export const PRICE_CAP_EUR: Record<ProjectKind, number> = { automatisation: 3000, fullstack: 4000 };
export const DELAY_CAP_DAYS: Record<ProjectKind, number> = { automatisation: 21, fullstack: 42 };
export const DAILY_RATE_EUR = 350;
export const MONTHLY_CAP_EUR = 150;

export function pricingGuide(kind: ProjectKind): string {
  return kind === "fullstack"
    ? `UN montant unique : MVP ou outil interne simple 1 200 à 2 500 €, application plus complète 2 500 à 4 000 € AU PLUS ; si l'annonce raisonne en jours, TJM ${DAILY_RATE_EUR} €. Délai réaliste (2 à 6 semaines).`
    : "UN montant unique : tâche simple 300 à 600 €, workflow complet 600 à 1 200 €, projet multi-systèmes complexe (ERP/Sage, lecture de sites avec connexion, installation) 1 500 à 3 000 € AU PLUS. Délai : 1 à 2 semaines, 2 à 3 semaines pour le complexe — jamais 4 à 6 semaines.";
}

export const MONTHLY_GUIDE = "Coûts mensuels réalistes et détaillés : hébergement environ 15 €/mois, API IA 10 à 30 €/mois selon le volume, maintenance en option 90 €/mois.";

/** Les montants du développement (hors montants « par mois »). */
export function developmentAmounts(text: string): number[] {
  const withoutMonthly = text.replace(/[^.;:\n]*(\/\s?mois|par mois|mensuel|per month|\/\s?month|monthly)[^.;\n]*/gi, " ");
  return [...withoutMonthly.matchAll(/(\d[\d\s.]*\d|\d)\s?(€|eur\b|euros?)/gi)].map((match) => Number(match[1].replace(/[\s.]/g, ""))).filter((value) => Number.isFinite(value) && value > 0);
}

/** Une fourchette de prix pour le développement (« 4 000 à 6 000 € », « 900–1 200 € »). */
export function priceRange(text: string): string | null {
  const withoutMonthly = text.replace(/[^.;:\n]*(\/\s?mois|par mois|mensuel|per month|\/\s?month|monthly)[^.;\n]*/gi, " ");
  const match = withoutMonthly.match(/(entre\s+)?\d[\d\s.]*\s?(€\s?)?(à|-|–|et|to)\s?\d[\d\s.]*\s?(€|eur|euros?)/i);
  return match ? match[0].trim() : null;
}

/** Montants mensuels (« 15 €/mois », « 90 € par mois »). */
export function monthlyAmounts(text: string): number[] {
  return [...text.matchAll(/(\d[\d\s.]*)\s?(€|eur|euros?)\s?(\/\s?mois|par mois|per month|\/\s?month)/gi)].map((match) => Number(match[1].replace(/[\s.]/g, ""))).filter((value) => Number.isFinite(value));
}

/** Délai le plus long cité, en jours (« 4 à 6 semaines » → 42). */
export function longestDelayDays(text: string): number | null {
  const values = [...plain(text).matchAll(/(\d+)\s*(jours?|j\b|semaines?|sem\b|days?|weeks?|mois|months?)/g)].map((match) => {
    const value = Number(match[1]);
    if (/^(semaine|sem|week)/.test(match[2])) return value * 7;
    if (/^(mois|month)/.test(match[2])) return value * 30;
    return value;
  });
  // « 4 à 6 semaines » : le premier nombre n'a pas d'unité.
  const ranges = [...plain(text).matchAll(/(\d+)\s*(a|-|–|to)\s*(\d+)\s*(semaines?|weeks?)/g)].map((match) => Number(match[3]) * 7);
  const all = [...values, ...ranges];
  return all.length ? Math.max(...all) : null;
}

const STACK_REFERENCE = /(pas encore|not yet|aucun projet|no .{0,20}project yet|portfolio|orion)/i;

/** Une réponse « références » honnête : ce qu'on n'a pas encore, puis ce qu'on peut montrer. */
export const honestReferences = (text: string | null | undefined) => STACK_REFERENCE.test(text ?? "");

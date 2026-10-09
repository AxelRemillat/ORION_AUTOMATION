import type { Opportunity } from "./types";

/**
 * Classement de la page Opportunités (code pur) :
 *   - Alertes   : score ≥ 8 ;
 *   - À voir    : score 5–7, analyse en cours ou à faire, saisie manuelle non notée ;
 *   - Ignorées  : écartées par le filtre, score < 5, ou marquées « Ignorée ».
 */

export type Bucket = "alertes" | "a_voir" | "ignorees";

export const BUCKET_LABELS: Record<Bucket | "toutes", string> = {
  alertes: "Alertes",
  a_voir: "À voir",
  ignorees: "Ignorées",
  toutes: "Toutes",
};

type Row = Pick<Opportunity, "fit_score" | "status"> & Partial<Pick<Opportunity, "filter_reason" | "analysis_state" | "seen_at" | "published_at" | "created_at">>;

export function bucketOf(row: Row): Bucket {
  if (row.filter_reason || row.status === "ignoree") return "ignorees";
  // Titre seul (alerte Codeur, plateformes #11) : « À voir » tant que l'annonce n'est pas collée,
  // même si une ancienne analyse sur le titre a laissé un score (il ne veut rien dire).
  if (row.analysis_state === "titre_seul") return "a_voir";
  if (row.fit_score == null) return "a_voir";
  if (row.fit_score >= 8) return "alertes";
  return row.fit_score >= 5 ? "a_voir" : "ignorees";
}

/** Alertes non vues (score ≥ 8), des plus récentes aux plus anciennes. */
export function unseenAlerts<T extends Row>(rows: readonly T[]): T[] {
  return rows
    .filter((row) => bucketOf(row) === "alertes" && !row.seen_at)
    .sort((a, b) => (b.published_at ?? b.created_at ?? "").localeCompare(a.published_at ?? a.created_at ?? ""));
}

/** Annonce de plus de 7 jours (publication sur la plateforme) : « Ancienne annonce (14 j) … », sinon `null`. */
export function staleLabel(publishedAt: string | null | undefined, now = new Date()): string | null {
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  const days = Math.floor((now.getTime() - Date.parse(publishedAt)) / 86_400_000);
  return days > 7 ? `Ancienne annonce (${days} j) : faible chance de réponse` : null;
}

/** « il y a 7 min », « il y a 2 h », « il y a 3 j ». */
export function ageLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/**
 * REPÈRE DE TAILLE (Cowork #9) : une mission trop grosse pour Axel seul —
 * budget de 10 000 € ou plus, ou besoin estimé au-delà de 30 jours — porte le
 * badge « Trop gros seul : lot IA ou sous-traitance ». Le score d'adéquation
 * ne change pas : c'est un repère, pas un filtre.
 *
 * Budget : le PLUS PETIT montant cité (« Plus de 10 000 € », « 10 000 à
 * 30 000 € », « $12,000 ») ; une tranche Codeur « 1 000 € à 10 000 € » ne
 * compte pas. Besoin : le délai estimé par la proposition (suggested_delay_days).
 */
export const SIZE_BADGE = "Trop gros seul : lot IA ou sous-traitance";
export const SIZE_BUDGET_MIN = 10_000;
export const SIZE_DAYS_MAX = 30;

/** Montants d'un budget : s'il cite une devise (€, $, EUR, USD), tous ses nombres comptent (« 1 000 à 30 000 € »). */
function amountsIn(text: string): number[] {
  const clean = text.replace(/\u00a0/g, " ");
  if (!/€|\$|\beur|\busd|\dk\b/i.test(clean)) return [];
  return [...clean.matchAll(/(\d[\d\s.,]*\d|\d)\s?(k\b)?/gi)]
    .map((match) => Number(match[1].replace(/[\s.,]/g, "")) * (match[2] ? 1000 : 1))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** Motif du badge de taille, ou `null`. */
export function sizeFlag(row: { budget?: string | null; suggested_delay_days?: number | null }): string | null {
  const amounts = amountsIn(row.budget ?? "");
  if (amounts.length && Math.min(...amounts) >= SIZE_BUDGET_MIN) return `budget de ${Math.min(...amounts).toLocaleString("fr-FR")} € ou plus`;
  if (row.suggested_delay_days != null && row.suggested_delay_days > SIZE_DAYS_MAX) return `besoin estimé à ${row.suggested_delay_days} jours`;
  return null;
}

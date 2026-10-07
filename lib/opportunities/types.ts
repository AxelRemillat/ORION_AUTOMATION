/**
 * OPPORTUNITÉS — annonces des plateformes freelance, saisies à la main (V1).
 *
 * Aucun envoi, aucune connexion aux plateformes, aucun scraping : l'app
 * analyse l'annonce collée, rédige une proposition, et Axel la copie lui-même.
 */

export const PLATFORMS = ["codeur", "upwork", "comeup", "malt", "autre"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  codeur: "Codeur",
  upwork: "Upwork",
  comeup: "ComeUp",
  malt: "Malt",
  autre: "Autre",
};

export const OPPORTUNITY_STATUSES = ["a_repondre", "envoyee", "reponse", "entretien", "gagnee", "perdue", "ignoree"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  a_repondre: "À répondre",
  envoyee: "Envoyée",
  reponse: "Réponse",
  entretien: "Entretien",
  gagnee: "Gagnée",
  perdue: "Perdue",
  ignoree: "Ignorée",
};

/** Le client a répondu : à partir de « Réponse » (une perdue après réponse garde `replied_at`). */
export const REPLIED_STATUSES: readonly OpportunityStatus[] = ["reponse", "entretien", "gagnee"];

export type Language = "fr" | "en";

export interface Opportunity {
  id: string;
  user_id: string;
  platform: Platform;
  url: string | null;
  title: string;
  body: string;
  budget: string | null;
  deadline: string | null;
  language: Language | null;
  fit_score: number | null;
  fit_reasons: string[] | null;
  need: string | null;
  demo: string | null;
  analyzed_at: string | null;
  proposal: string | null;
  proposal_score: number | null;
  proposal_reason: string | null;
  status: OpportunityStatus;
  notes: string | null;
  amount_eur: number | null;
  sent_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  /** Veille automatique (flux RSS Codeur) ou saisie manuelle. */
  source?: "manuel" | "rss" | string;
  external_id?: string | null;
  categories?: string[] | null;
  published_at?: string | null;
  /** Le flux ne donne qu'un extrait de l'annonce (~300 caractères). */
  description_truncated?: boolean;
  /** ok · pending (en cours) · a_analyser (plafond du jour) · non_analysee (crédit OpenAI épuisé) · filtre (écartée sans LLM). */
  analysis_state?: string | null;
  filter_reason?: string | null;
  /** Alerte vue (ouverte ou copiée). */
  seen_at?: string | null;
  /** Proposition rédigée sur l'extrait du flux : « Brouillon sur extrait ». */
  proposal_on_excerpt?: boolean;
  suggested_amount_eur?: number | null;
  suggested_delay_days?: number | null;
}

export const isPlatform = (value: unknown): value is Platform => typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
export const isOpportunityStatus = (value: unknown): value is OpportunityStatus =>
  typeof value === "string" && (OPPORTUNITY_STATUSES as readonly string[]).includes(value);

/** Langue de la proposition : FR pour les plateformes françaises, EN pour Upwork, sinon celle de l'annonce. */
export function proposalLanguage(platform: Platform, detected: Language | null): Language {
  if (platform === "upwork") return "en";
  if (platform === "autre") return detected ?? "fr";
  return "fr";
}

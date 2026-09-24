import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import type { DeepAnalysis } from "@/app/api/emails/generate/analysis";
import type { Critique } from "@/app/api/emails/generate/critic";

/**
 * Un fait REEL retenu par l'analyse, recopie des donnees collectees, avec sa
 * provenance. Ce ne sont jamais des estimations : le modele a l'interdiction
 * d'inventer un chiffre, et une entree sans source est ecartee cote serveur.
 */
export interface Evidence {
  label: string;
  value: string;
  source: string;
}

/** Réponse de POST /api/emails/generate. */
export interface GenerateResponse {
  /** Hypothèse de travail, à lire comme telle — pas un constat verifie. */
  pain_point: string;
  evidence: Evidence[];
  email: { subject: string; body: string };
  contact: DecisionMakerContact | null;
  warnings: EnrichmentWarning[];
  /**
   * Resultat de l'etape d'analyse metier. Affiche sous le brouillon pour que
   * l'utilisateur voie sur quoi le mail s'appuie — et puisse basculer sur une
   * autre piste sans relancer une recherche.
   */
  analysis: DeepAnalysis;
  /** Notes du juge, affichees telles quelles quand un critere est faible. */
  critique: Critique | null;
  /** `true` quand un garde-fou ou un critere n'a pas pu etre corrige. */
  needsReview: boolean;
  reviewReasons: string[];
  /** L'implication deduite qui sert d'indice de besoin. */
  needLead: { text: string; factIds: string[]; confidence: number } | null;
}

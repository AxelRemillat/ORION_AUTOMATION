import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";

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
}

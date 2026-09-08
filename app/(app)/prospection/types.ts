import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";

/** Un chiffre clé estimé par l'IA, avec l'hypothèse qui le sous-tend. */
export interface Lever {
  label: string;
  value: string;
  basis: string;
}

/** Réponse de POST /api/emails/generate. */
export interface GenerateResponse {
  pain_point: string;
  levers: Lever[];
  email: { subject: string; body: string };
  contact: DecisionMakerContact | null;
  warnings: EnrichmentWarning[];
}

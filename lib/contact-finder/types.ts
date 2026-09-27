/**
 * Contrat partagé du module contact (lib/contact-finder/index.ts).
 *
 * `ContactResult` ne change pas sans prévenir : les autres sessions s'y
 * branchent. Les types internes (candidats, trace) sont libres d'évoluer.
 */
export interface ContactResult {
  website?: string;
  email?: string;
  email_type?: "nominatif" | "generique";
  /** Page où l'adresse a été vue, ou source Hunter : affichée cliquable. */
  email_source_url?: string;
  /** 0 à 100. */
  confidence: number;
  /** Chemin qui a produit le résultat, lisible : « site:mentions-legales », « hunter:email-finder+verifier »… */
  found_by: string;
}

/** Ce que l'on sait de l'entreprise avant de chercher. */
export interface CompanyIdentity {
  prospectId: string | null;
  /** Raison sociale. */
  legalName: string;
  /** Noms commerciaux et enseignes (annuaire public, Pappers). */
  tradeNames: string[];
  siren: string | null;
  city: string | null;
  postalCode: string | null;
  /** Dirigeant personne physique, NOM D'USAGE (voir names.ts). */
  leader: { firstName: string; lastName: string } | null;
  /** Site déjà connu ou saisi à la main : candidat prioritaire. */
  knownWebsite: string | null;
  /** Site déclaré chez Pappers. */
  pappersWebsite: string | null;
  /** Adresse déjà connue : son domaine est un candidat gratuit. */
  knownEmail: string | null;
}

/** Plafond de coût par fiche. Chaque dépassement est refusé, pas seulement compté. */
export interface ContactBudget {
  linkup: number;
  pages: number;
  llm: number;
  hunterDomainSearch: number;
  hunterFinder: number;
  hunterVerifier: number;
}

export const DEFAULT_BUDGET: ContactBudget = {
  linkup: 3,
  pages: 8,
  llm: 1,
  hunterDomainSearch: 2,
  hunterFinder: 1,
  hunterVerifier: 3,
};

/** Journal d'une recherche : enregistré sur la fiche pour comprendre un résultat. */
export interface ContactTrace {
  spent: ContactBudget;
  candidates: { domain: string; by: string; confidence: number; validated: boolean; reason: string }[];
  emailDomains: string[];
  steps: string[];
}

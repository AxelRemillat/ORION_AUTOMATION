/**
 * Entonnoir « signaux d'abord » — contrat commun aux 4 étages.
 *
 *   1. moisson       (gratuit)  : HarvestedSignal, statut « brut »
 *   2. filtre        (gratuit)  : Identity + FilterVerdict → « filtré » / « rejeté »
 *   3. tri LLM       (bon marché) : Triage → « retenu » / « rejeté »
 *   4. creusage      (payant)   : fiche + contact + brief → « creusé »
 */

export const CANDIDATE_STATUSES = ["brut", "filtré", "rejeté", "retenu", "creusé"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export type FunnelSource = "bodacc" | "france-travail" | "linkup";
export type Strength = "fort" | "moyen" | "faible";

export interface Leader {
  firstName: string;
  surname: string;
  role: string;
}

/** Faits bruts de la source, sans interprétation. */
export interface SignalFacts {
  /** Libellé normalisé de l'événement (« Modification du capital »…). */
  label: string;
  /** direction | croissance | creation | presse | recrutement */
  signalType: string;
  strength: Strength;
  /** Capital déclaré APRÈS l'opération (BODACC). */
  capitalAfter?: number | null;
  /** Capital d'avant, quand un texte ou une annonce antérieure le donne. */
  capitalBefore?: number | null;
  /** Dirigeants ENTRANTS nommés par l'annonce. */
  newLeaders?: Leader[];
  jobTitle?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** Site de l'entreprise donné par l'offre France Travail : première piste de site. */
  employerUrl?: string | null;
}

export interface HarvestedSignal {
  source: FunnelSource;
  /** Jour du signal, ISO `AAAA-MM-JJ`. */
  date: string;
  /** Texte officiel ou intitulé, tel que publié. */
  text: string;
  url: string | null;
  siren: string | null;
  companyName: string;
  facts: SignalFacts;
  hash: string;
}

/** Identité gratuite (API Recherche d'entreprises), au moment du filtre. */
export interface Identity {
  siren: string;
  name: string;
  naf: string | null;
  /** Code INSEE de tranche d'effectif (`00`, `11`, `NN`…). */
  effectifCode: string | null;
  /** Statut de diffusion INSEE : `O` diffusible, `P` partiel (opposition). */
  diffusion: string | null;
  /** `A` active, `C` cessée. */
  adminState: string | null;
  createdOn: string | null;
  legalCode: string | null;
  /** Le signal porte sur un établissement secondaire. */
  isBranch: boolean;
  headOfficeCity: string | null;
  city: string | null;
  revenue: number | null;
  revenueYear: number | null;
  /** L'employeur d'une offre a été confirmé par l'annuaire (nom + zone). */
  employerConfirmed: boolean;
  /**
   * Catégorie INSEE de l'ENTREPRISE au sens économique (PME, ETI, GE) : pour
   * une filiale profilée, c'est celle du groupe entier.
   */
  category?: string | null;
  /** Tête de groupe : dirigeant personne morale (hors commissaire aux comptes). */
  parentName?: string | null;
  parentCategory?: string | null;
  parentEffectifCode?: string | null;
}

export interface FilterVerdict {
  status: "filtré" | "rejeté";
  reason: string | null;
  /** 0 à 1 : ordre de passage au tri et au creusage. */
  weight: number;
  badges: string[];
  /** Modification purement juridique : jamais « brûlante », score plafonné. */
  legalOnly: boolean;
}

/** Verdict du tri LLM, validé par zod puis corrigé par le code. */
export interface Triage {
  utilisable: boolean;
  sujet_est_l_entreprise: boolean;
  type: string;
  pain_probable: string;
  accroche_possible: string;
  score: number;
  raison: string;
}

/** Compteurs du bandeau de run. */
export interface FunnelCounts {
  bruts: number;
  filtres: number;
  retenus: number;
  creuses: number;
  contactables: number;
}

/** Coût d'un run : tokens LLM et appels payants. */
export interface FunnelCost {
  eur: number;
  tokens: number;
  pappers: number;
  hunter: number;
  linkup: number;
}

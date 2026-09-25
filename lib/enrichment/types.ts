import type { ProspectKeyFigures, ProspectSignal } from "@/types";

/**
 * Contrat interne de la couche d'enrichissement.
 * Les champs de `CompanyBase` sont alignés 1:1 sur les colonnes de `prospects`
 * pour qu'un résultat soit insérable sans transformation.
 */

/** Panne ou clé manquante sur une source : remontée à l'UI, jamais bloquante. */
export interface EnrichmentWarning {
  source: "gouv" | "pappers" | "linkup" | "hunter" | "openai";
  message: string;
}

/** Identité d'entreprise issue du référentiel public (recherche-entreprises). */
export interface CompanyBase {
  siren: string | null;
  company_name: string;
  website: string | null;
  /**
   * Adresse de contact, quand une source en fournit une. Le référentiel public
   * n'en expose pas : elle vient de Pappers, sinon de Hunter au moment de
   * l'analyse. Recopiée telle quelle dans `prospects.email`.
   */
  email: string | null;
  sector: string | null;
  /** Libellé lisible de la tranche d'effectif ("20 à 49 salariés"). */
  size_range: string | null;
  city: string | null;
  postal_code: string | null;
  naf_code: string | null;
  naf_section: string | null;
  founded_year: number | null;
  legal_form: string | null;
  /** Dirigeant principal, si le référentiel l'expose. */
  leader: string | null;
  /** Dirigeant personne physique, en casse naturelle : sert à la salutation. */
  leader_person: string | null;
  /** Société mère quand un dirigeant est une personne morale : indice de groupe. */
  parent_company: string | null;
  /**
   * Vrai quand le filtre géographique a matché un établissement secondaire :
   * `city` désigne alors ce site, pas le siège social.
   */
  matched_branch: boolean;
  /** Données hors colonnes `prospects`, agrégées ensuite dans key_figures. */
  figures: BaseFigures;
}

/**
 * Chiffres déjà disponibles dans l'annuaire public : ils rendent les cartes
 * exploitables même sans clé Pappers.
 */
export interface BaseFigures {
  /** Date de creation complete (AAAA-MM-JJ) : base du calcul d'age. */
  founded_on: string | null;
  /** Code INSEE brut de tranche d'effectif : sert aux estimations. */
  effectif_code: string | null;
  revenue_eur: number | null;
  revenue_year: number | null;
  net_income_eur: number | null;
  /** Catégorie INSEE : PME, ETI, GE. */
  company_category: string | null;
  /** Ville du siège, conservée quand `city` pointe vers un établissement. */
  head_office_city: string | null;
}

/** Entreprise après passage par Pappers + Linkup. */
export interface EnrichedCompany extends CompanyBase {
  key_figures: ProspectKeyFigures;
  signals: ProspectSignal[];
  warnings: EnrichmentWarning[];
}

/** Coordonnées du décideur trouvées via Hunter. */
export interface DecisionMakerContact {
  email: string;
  full_name: string | null;
  position: string | null;
  /** Score de confiance Hunter, 0-100. */
  confidence: number | null;
}

export interface SearchCriteria {
  /** Texte libre (nom, mot-clé métier). */
  q?: string;
  /** Section NAF (lettre A-U). */
  section?: string;
  /** Codes INSEE de tranche d'effectif. */
  tranches?: string[];
  /** Ville, code postal ou numéro de département. */
  zone?: string;
  /** Interroge Linkup (coûteux) — désactivable depuis le formulaire. */
  withSignals?: boolean;
  /**
   * Autorise le scan a depasser `scanWidth` pour atteindre l'objectif de
   * fiches, jusqu'au plafond de 3x. `false` = on s'arrete au nombre demande.
   */
  goFurther?: boolean;
  /**
   * PHASE 2 — nombre maximal d'entreprises enrichies en profondeur (Pappers).
   *
   * Ne s'applique QU'AUX entreprises porteuses d'un signal atteste : une
   * entreprise froide n'est jamais enrichie, quel que soit ce plafond.
   */
  limit?: number;
  /**
   * PHASE 1 — nombre de candidats passes au scan Linkup.
   *
   * C'est le filet : plus il est large, plus on a de chances de tomber sur une
   * entreprise reellement active. Le scan coute une recherche Linkup par
   * candidat, bien moins qu'une fiche Pappers.
   */
  scanWidth?: number;
}

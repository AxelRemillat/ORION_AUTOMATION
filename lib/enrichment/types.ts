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
   * Nombre maximal d'entreprises REELLEMENT enrichies.
   *
   * L'annuaire public est gratuit, mais chaque enrichissement declenche un
   * appel Pappers et un appel Linkup — facturés. Ce plafond est donc le
   * principal levier de cout de l'app : on n'analyse que ce qu'on va lire.
   */
  limit?: number;
}

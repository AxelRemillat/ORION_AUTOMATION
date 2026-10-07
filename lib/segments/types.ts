/**
 * SEGMENTS — un marché, ses critères, sa famille de mail.
 *
 * ORION ciblait jusqu'ici un seul marché (PME avec un signal d'actualité), et
 * ses règles étaient dispersées dans l'entonnoir. Un segment rassemble au même
 * endroit ce qui change d'un marché à l'autre : les codes NAF candidats, la
 * taille visée, ce qui qualifie sur le site, ce qui disqualifie, le plafond
 * d'envoi quotidien et la famille de mail à employer.
 *
 * Trois règles de conception :
 *   1. CODE PUR. Un segment ne fait aucun appel réseau : il juge ce qu'on lui
 *      donne. C'est ce qui le rend testable et réutilisable côté serveur comme
 *      côté client.
 *   2. LE NAF NE SUFFIT JAMAIS. Il ne fait que délimiter un vivier : c'est la
 *      lecture du site qui qualifie. 62.01Z « Programmation informatique »
 *      contient autant d'agences que de développeurs indépendants.
 *   3. UN DOUTE N'EST PAS UN OUI. Sans texte de site, le verdict est
 *      `indécidable`, pas `hors segment` : la fiche attend sa lecture plutôt
 *      que d'être écartée pour une donnée manquante.
 */

export const SEGMENT_KEYS = ["agences"] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export function isSegmentKey(value: unknown): value is SegmentKey {
  return typeof value === "string" && (SEGMENT_KEYS as readonly string[]).includes(value);
}

/** Motif reconnaissable dans un texte de site, avec ce qu'il prouve. */
export interface SegmentPattern {
  /** Libellé affiché et journalisé — jamais l'expression régulière brute. */
  label: string;
  pattern: RegExp;
}

export type SegmentFit = "dedans" | "dehors" | "indécidable";

/** Verdict d'appartenance, toujours motivé. */
export interface SegmentVerdict {
  segment: SegmentKey;
  fit: SegmentFit;
  /** Ce qui a qualifié : signaux trouvés sur le site. */
  signals: string[];
  /**
   * Non nul quand l'entreprise vend déjà la prestation : elle n'est pas une
   * cible mais un partenaire possible. Aucun mail n'est préparé.
   */
  competitor: string | null;
  /** Pourquoi `dehors` ou `indécidable`, en une phrase lisible. */
  reason: string | null;
}

/** Ce qu'un segment a besoin de savoir pour juger. Tout est optionnel : on juge ce qu'on a. */
export interface SegmentInput {
  /** Code NAF complet (« 73.11Z »). */
  naf?: string | null;
  /** Code INSEE de tranche d'effectif (« 02 », « 12 », « NN »…). */
  effectifCode?: string | null;
  /** Effectif réel quand une source le donne : il l'emporte sur la tranche. */
  headcount?: number | null;
  /** Texte du site officiel, déjà nettoyé. Absent = verdict indécidable. */
  siteText?: string | null;
  companyName?: string | null;
  website?: string | null;
}

export interface Segment {
  key: SegmentKey;
  label: string;
  /** Une phrase : à qui on écrit, et pourquoi eux. */
  pitch: string;
  /** Codes NAF candidats, avec leur libellé officiel (NAF rév. 2). */
  naf: Readonly<Record<string, string>>;
  /** Codes INSEE de tranche d'effectif acceptés. */
  effectifCodes: readonly string[];
  /** Bornes d'effectif réel, quand il est connu. */
  headcount: { min: number; max: number };
  /** Plafond d'envoi par jour pour ce segment, DANS le plafond commun. */
  dailyCap: number;
  /** Famille de mail employée pour ce segment. */
  family: string;
  classify(input: SegmentInput): SegmentVerdict;
}

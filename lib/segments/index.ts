import type { ProspectKeyFigures } from "@/types";
import { AGENCES_SEGMENT } from "./agences";
import { isSegmentKey, type Segment, type SegmentKey, type SegmentVerdict } from "./types";

/**
 * Registre des segments, et lecture/écriture du segment sur une fiche.
 *
 * Le segment vit dans `key_figures` plutôt que dans une colonne : c'est une
 * qualification, elle se recalcule à chaque ré-enrichissement, et aucune
 * migration n'est nécessaire pour en ajouter un deuxième. Trois clés, toutes
 * optionnelles :
 *
 *   segment             — la clé du segment (« agences »), absente si hors segment ;
 *   segment_signals     — ce qui a qualifié, pour pouvoir le relire et le discuter ;
 *   segment_competitor  — l'entreprise vend déjà la prestation : partenaire
 *                         possible, jamais de mail.
 */

/**
 * Ce que les lecteurs exigent : un porteur de `key_figures`, et rien de plus.
 * Volontairement plus large que `Pick<Prospect, …>` — ces champs sont lus aussi
 * bien sur une fiche complète que sur la ligne partielle d'un pré-vol d'envoi.
 */
type WithFigures = { key_figures?: Record<string, unknown> | ProspectKeyFigures | null };

export const SEGMENTS: Readonly<Record<SegmentKey, Segment>> = {
  agences: AGENCES_SEGMENT,
};

export const ALL_SEGMENTS: readonly Segment[] = Object.values(SEGMENTS);

export { isSegmentKey };
export type { Segment, SegmentInput, SegmentKey, SegmentVerdict, SegmentFit } from "./types";

/** Segment d'une fiche, `null` si elle n'en porte aucun. */
export function segmentOf(
  prospect: WithFigures | null | undefined,
): SegmentKey | null {
  const value = prospect?.key_figures?.segment;
  return isSegmentKey(value) ? value : null;
}

/** Libellé du segment d'une fiche, pour un badge ou un filtre. */
export function segmentLabel(key: SegmentKey | null): string | null {
  return key ? SEGMENTS[key].label : null;
}

/**
 * `true` quand la fiche est un concurrent ou un partenaire possible.
 * Aucun mail ne doit être préparé pour elle — cf. `lib/funnel/off-target.ts`.
 */
export function isSegmentCompetitor(
  prospect: WithFigures | null | undefined,
): boolean {
  return typeof prospect?.key_figures?.segment_competitor === "string";
}

/** Motif de concurrence lu sur la fiche, pour l'afficher tel quel. */
export function competitorReason(
  prospect: WithFigures | null | undefined,
): string | null {
  const value = prospect?.key_figures?.segment_competitor;
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Champs `key_figures` à fusionner après un classement.
 *
 * Un verdict `indécidable` n'écrit RIEN : la fiche n'est pas dite hors segment
 * parce que son site n'a pas encore été lu. Un concurrent est enregistré comme
 * tel sans être marqué dans le segment : il n'est pas une cible.
 */
export function segmentMarks(verdict: SegmentVerdict): Partial<ProspectKeyFigures> {
  if (verdict.competitor) {
    return { segment_competitor: verdict.competitor, segment_signals: verdict.signals };
  }
  if (verdict.fit === "dedans") {
    return { segment: verdict.segment, segment_signals: verdict.signals };
  }
  return {};
}

/**
 * Premier segment dont la fiche relève, parmi tous les segments déclarés.
 * Rend aussi les verdicts écartés : c'est ce qui permet d'expliquer un
 * « hors cible » sans relancer le calcul.
 */
export function classifyAll(input: Parameters<Segment["classify"]>[0]): {
  matched: SegmentVerdict | null;
  verdicts: SegmentVerdict[];
} {
  const verdicts = ALL_SEGMENTS.map((segment) => segment.classify(input));
  return { matched: verdicts.find((verdict) => verdict.fit === "dedans") ?? null, verdicts };
}

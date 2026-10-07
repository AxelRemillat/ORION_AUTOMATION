import { AGENCES_DAILY_CAP } from "./agences";
import { SEGMENTS, type SegmentKey } from "./index";

/**
 * QUOTA PAR SEGMENT — pris DANS le plafond commun, jamais en plus.
 *
 * Le plafond d'envoi quotidien protège la réputation de l'adresse : il est
 * global (lib/outbox/deliverability.ts, 15 par jour aujourd'hui, 20 à la
 * prochaine marche). Un segment ne l'augmente pas, il s'y réserve une part.
 *
 * Conséquence voulue : si le plafond commun est atteint, le quota du segment ne
 * sert à rien — il ne « débloque » rien. Et si le quota du segment est atteint
 * alors qu'il reste de la place commune, cette place va aux autres segments.
 * C'est l'inverse d'un budget garanti : c'est une limite de concentration, pour
 * qu'une journée ne devienne pas un envoi de masse sur un seul marché.
 */

export interface SegmentAllowance {
  segment: SegmentKey;
  /** Plafond du segment pour la journée. */
  cap: number;
  /** Mails de ce segment déjà partis aujourd'hui. */
  sent: number;
  /** Place restante dans le plafond COMMUN. */
  commonRemaining: number;
  /** Ce qu'on peut encore envoyer pour ce segment : le minimum des deux. */
  remaining: number;
  /** Qui limite : le segment, le plafond commun, ou rien. */
  limitedBy: "segment" | "commun" | null;
}

/** Plafonds par défaut, déclarés par chaque segment. */
export const DEFAULT_SEGMENT_CAPS: Readonly<Record<SegmentKey, number>> = {
  agences: AGENCES_DAILY_CAP,
};

/** Normalise une surcharge venue des réglages : un entier positif, sinon le défaut. */
export function resolveCap(segment: SegmentKey, override?: unknown): number {
  const value = typeof override === "number" ? override : Number(override);
  if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  return DEFAULT_SEGMENT_CAPS[segment] ?? SEGMENTS[segment].dailyCap;
}

/**
 * Ce qu'il reste à envoyer aujourd'hui pour un segment.
 *
 * `commonRemaining` vient de `buildDeliverability().remaining` : on ne le
 * recalcule pas ici, pour qu'il n'existe qu'une seule source de vérité sur la
 * montée en charge.
 */
export function segmentAllowance(input: {
  segment: SegmentKey;
  /** Envois du jour pour CE segment. */
  sent: number;
  /** Place restante dans le plafond commun. */
  commonRemaining: number;
  /** Surcharge de plafond venue des réglages. */
  capOverride?: unknown;
}): SegmentAllowance {
  const cap = resolveCap(input.segment, input.capOverride);
  const sent = Math.max(0, Math.floor(input.sent));
  const commonRemaining = Math.max(0, Math.floor(input.commonRemaining));

  const bySegment = Math.max(cap - sent, 0);
  const remaining = Math.min(bySegment, commonRemaining);

  const limitedBy =
    remaining > 0 ? null : bySegment === 0 && commonRemaining > 0 ? "segment" : commonRemaining === 0 ? "commun" : "segment";

  return { segment: input.segment, cap, sent, commonRemaining, remaining, limitedBy };
}

/** Phrase affichable : « 2 sur 5 aujourd'hui », ou ce qui bloque. */
export function allowanceLabel(allowance: SegmentAllowance): string {
  const name = SEGMENTS[allowance.segment].label;
  if (allowance.remaining > 0) {
    return `${name} : ${allowance.sent} sur ${allowance.cap} aujourd'hui, ${allowance.remaining} encore possible(s)`;
  }
  if (allowance.limitedBy === "commun") {
    return `${name} : plafond commun d'envoi atteint pour aujourd'hui`;
  }
  return `${name} : quota du segment atteint (${allowance.cap} par jour)`;
}

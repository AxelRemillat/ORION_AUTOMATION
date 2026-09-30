import { formatParisDay, formatScheduled, offWeekend } from "@/lib/outbox/paris-time";
import type { MessageType, ProspectStatus } from "@/types";

/**
 * « Prochaine action » — ce qu'il reste à faire sur un prospect, déduit de
 * l'état réel (envoi programmé, relance, brouillon en attente, statut). Aucune
 * invention : quand il n'y a rien à faire, on l'écrit.
 */

export type ActionUrgency = "due" | "soon" | "idle" | "done";

export interface NextAction {
  label: string;
  urgency: ActionUrgency;
  /** Échéance ISO quand l'action est due aujourd'hui (relance). */
  dueAt?: string;
}

/** Pourquoi on n'écrit plus à ce prospect. */
export type Opposition = "refuses_prospecting" | "do_not_contact";

const BY_STATUS: Record<ProspectStatus, NextAction> = {
  nouveau: { label: "Préparer l'email d'approche", urgency: "idle" },
  a_contacter: { label: "Préparer l'email d'approche", urgency: "idle" },
  contacte: { label: "Programmer une relance", urgency: "idle" },
  relance_1: { label: "Programmer la relance suivante", urgency: "idle" },
  relance_2: { label: "Clore ou laisser reposer", urgency: "idle" },
  repondu: { label: "Répondre et caler un échange", urgency: "soon" },
  en_discussion: { label: "Envoyer la proposition chiffrée", urgency: "soon" },
  gagne: { label: "Contrat signé", urgency: "done" },
  perdu: { label: "Sans suite", urgency: "done" },
};

/** Le prospect a répondu ou l'affaire est close : plus de relance à proposer. */
const NO_FOLLOW_UP: ReadonlySet<ProspectStatus> = new Set(["repondu", "en_discussion", "gagne", "perdu"]);

/** Délai de la relance qui suit un envoi — le même que `lib/outbox/send.ts`. */
const FOLLOW_UP_DAYS: Partial<Record<MessageType, number>> = { intro: 4, relance_1: 7 };

export interface NextActionInput {
  status: ProspectStatus;
  /** Brouillons à envoyer (hors programmés, hors doublons d'une étape déjà partie). */
  draftsCount: number;
  /** Échéance de la prochaine relance ouverte, si elle existe. */
  nextDueAt: string | null;
  /** Prochain envoi programmé (ISO). */
  scheduledAt?: string | null;
  /** Type du dernier message parti : le prospect a déjà été contacté. */
  lastSentType?: MessageType | null;
  /** Opposition à la prospection ou « ne plus contacter ». */
  opposition?: Opposition | null;
  /** Date de référence, injectable pour les tests. */
  now?: Date;
}

export function nextAction(input: NextActionInput): NextAction {
  const now = input.now ?? new Date();
  if (input.status === "gagne" || input.status === "perdu") return BY_STATUS[input.status];

  const contacted = Boolean(input.lastSentType);
  const followsUp = !NO_FOLLOW_UP.has(input.status);

  if (input.opposition && followsUp) {
    const why = input.opposition === "do_not_contact" ? "ne plus contacter" : "opposé à la prospection";
    return contacted
      ? { label: `Aucune relance : ${why}`, urgency: "done" }
      : { label: `Aucun envoi : ${why}`, urgency: "done" };
  }

  if (input.scheduledAt) {
    return { label: `Envoi programmé ${formatScheduled(input.scheduledAt, now)}`, urgency: "soon" };
  }

  if (input.draftsCount > 0) return { label: "Envoyer le brouillon prêt", urgency: "due" };

  if (input.nextDueAt && followsUp) {
    const due = offWeekend(new Date(input.nextDueAt));
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    if (due <= endOfDay) return { label: "Relancer aujourd'hui", urgency: "due", dueAt: due.toISOString() };
    const days = input.lastSentType ? FOLLOW_UP_DAYS[input.lastSentType] : undefined;
    const step = days ? `Relance J+${days}` : "Relance programmée";
    return { label: `${step} le ${formatParisDay(due.toISOString())}`, urgency: "soon" };
  }

  return BY_STATUS[input.status];
}

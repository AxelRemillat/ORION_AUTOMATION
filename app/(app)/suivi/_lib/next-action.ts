import type { ProspectStatus } from "@/types";

/**
 * « Prochaine action » — ce qu'il reste à faire sur un prospect, déduit de
 * l'état réel (brouillon en attente, relance programmée, statut). Aucune
 * invention : quand il n'y a rien à faire, on l'écrit.
 */

export type ActionUrgency = "due" | "soon" | "idle" | "done";

export interface NextAction {
  label: string;
  urgency: ActionUrgency;
  /** Échéance ISO quand l'action est portée par une relance. */
  dueAt?: string;
}

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

export function nextAction(input: {
  status: ProspectStatus;
  /** Brouillons non envoyés. */
  draftsCount: number;
  /** Échéance de la prochaine relance ouverte, si elle existe. */
  nextDueAt: string | null;
  /** Date de référence, injectable pour les tests. */
  now?: Date;
}): NextAction {
  const now = input.now ?? new Date();

  if (input.status !== "gagne" && input.status !== "perdu" && input.draftsCount > 0) {
    return { label: "Envoyer le brouillon prêt", urgency: "due" };
  }

  if (input.nextDueAt) {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const due = new Date(input.nextDueAt);
    return due <= endOfDay
      ? { label: "Relancer aujourd'hui", urgency: "due", dueAt: input.nextDueAt }
      : { label: "Relance programmée", urgency: "soon", dueAt: input.nextDueAt };
  }

  return BY_STATUS[input.status];
}

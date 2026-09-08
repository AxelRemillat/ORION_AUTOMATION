import type { DealStatus, MessageType, ProspectStatus } from "@/types";

/**
 * Libellés et couleurs des énumérations métier.
 * Utilisés par <Badge variant="status" /> et par les filtres des écrans.
 */

type StatusMeta = { label: string; className: string };

export const PROSPECT_STATUS_META: Record<ProspectStatus, StatusMeta> = {
  nouveau: { label: "Nouveau", className: "bg-muted/15 text-muted border-muted/25" },
  a_contacter: { label: "À contacter", className: "bg-accent/15 text-accent border-accent/30" },
  contacte: { label: "Contacté", className: "bg-info/15 text-info border-info/30" },
  relance_1: { label: "Relance 1", className: "bg-warning/15 text-warning border-warning/30" },
  relance_2: { label: "Relance 2", className: "bg-violet/15 text-violet border-violet/30" },
  repondu: { label: "Répondu", className: "bg-teal/15 text-teal border-teal/30" },
  en_discussion: {
    label: "En discussion",
    className: "bg-accent text-accent-fg border-transparent",
  },
  gagne: { label: "Gagné", className: "bg-success text-white border-transparent" },
  perdu: { label: "Perdu", className: "bg-danger/15 text-danger border-danger/30" },
};

export const DEAL_STATUS_META: Record<DealStatus, StatusMeta> = {
  ouvert: { label: "Ouvert", className: "bg-info/15 text-info border-info/30" },
  gagne: { label: "Gagné", className: "bg-success text-white border-transparent" },
  perdu: { label: "Perdu", className: "bg-danger/15 text-danger border-danger/30" },
};

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  intro: "Introduction",
  relance_1: "Relance 1",
  relance_2: "Relance 2",
  note: "Note",
};

/** Ordre du pipeline, du premier contact au closing. Sert aux vues kanban/stats. */
export const PIPELINE_ORDER: ProspectStatus[] = [
  "nouveau",
  "a_contacter",
  "contacte",
  "relance_1",
  "relance_2",
  "repondu",
  "en_discussion",
  "gagne",
  "perdu",
];

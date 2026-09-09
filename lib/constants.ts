import type { DealStatus, MessageType, ProspectStatus } from "@/types";

/**
 * Libelles et couleurs des enumerations metier.
 * Utilises par <ProspectStatusBadge> / <DealStatusBadge> et par les filtres.
 *
 * Regle de la palette Ciel & Lagon : la couleur SEMANTIQUE (vert = gagne,
 * ambre = chaud, rose = perdu) est distincte de la couleur de MARQUE
 * (bleu-cyan), pour qu'un statut ne se lise jamais comme une action.
 * Le texte utilise les encres `*-ink` afin de rester lisible (AA) sur l'aplat
 * teinte, en clair comme en sombre.
 */

type StatusMeta = { label: string; className: string };

export const PROSPECT_STATUS_META: Record<ProspectStatus, StatusMeta> = {
  nouveau: { label: "Nouveau", className: "bg-surface-2 text-muted border-line" },
  a_contacter: {
    label: "À contacter",
    className: "bg-primary/10 text-primary-ink border-primary/25",
  },
  contacte: { label: "Contacté", className: "bg-cyan/10 text-cyan-ink border-cyan/25" },
  relance_1: { label: "Relance 1", className: "bg-warn/10 text-warn-ink border-warn/25" },
  relance_2: { label: "Relance 2", className: "bg-violet/10 text-violet-ink border-violet/25" },
  repondu: { label: "Répondu", className: "bg-teal/10 text-teal-ink border-teal/25" },
  // Le dossier le plus « chaud » du pipeline : ambre soutenu.
  en_discussion: {
    label: "En discussion",
    className: "bg-warn/20 text-warn-ink border-warn/45",
  },
  gagne: { label: "Gagné", className: "bg-good/20 text-good-ink border-good/45 font-semibold" },
  perdu: { label: "Perdu", className: "bg-lost/10 text-lost-ink border-lost/25" },
};

export const DEAL_STATUS_META: Record<DealStatus, StatusMeta> = {
  ouvert: { label: "Ouvert", className: "bg-primary/10 text-primary-ink border-primary/25" },
  gagne: { label: "Gagné", className: "bg-good/20 text-good-ink border-good/45 font-semibold" },
  perdu: { label: "Perdu", className: "bg-lost/10 text-lost-ink border-lost/25" },
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

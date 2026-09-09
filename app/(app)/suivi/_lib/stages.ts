import type { ProspectStatus } from "@/types";

/**
 * Colonnes du Kanban.
 *
 * L'enum Postgres `prospect_status` n'est PAS modifié (backend intact) : les
 * colonnes demandées à la maquette sont donc projetées sur les statuts réels.
 * Deux écarts assumés, faute de donnée en base :
 *  - « Ouvert » (ouverture d'email) n'est pas traçable sans pixel de suivi :
 *    la colonne est remplacée par « Relancé », qui existe réellement ;
 *  - « RDV » et « Proposition » partagent le statut `en_discussion` et sont
 *    donc réunis dans une seule colonne.
 */

export type StageTone = "neutral" | "brand" | "warn" | "good" | "lost";

export interface Stage {
  key: string;
  label: string;
  hint: string;
  /** Statuts regroupés dans la colonne. */
  statuses: ProspectStatus[];
  /** Statut appliqué à une carte déposée ici. */
  target: ProspectStatus;
  tone: StageTone;
}

export const STAGES: Stage[] = [
  {
    key: "a_contacter",
    label: "À contacter",
    hint: "Brouillon prêt ou prospect qualifié",
    statuses: ["nouveau", "a_contacter"],
    target: "a_contacter",
    tone: "neutral",
  },
  {
    key: "contacte",
    label: "Contacté",
    hint: "Message d'intro envoyé",
    statuses: ["contacte"],
    target: "contacte",
    tone: "brand",
  },
  {
    key: "relance",
    label: "Relancé",
    hint: "Une ou deux relances parties",
    statuses: ["relance_1", "relance_2"],
    target: "relance_1",
    tone: "warn",
  },
  {
    key: "repondu",
    label: "Répondu",
    hint: "Le prospect a donné signe de vie",
    statuses: ["repondu"],
    target: "repondu",
    tone: "brand",
  },
  {
    key: "en_discussion",
    label: "RDV / Proposition",
    hint: "Échange engagé, chiffrage en cours",
    statuses: ["en_discussion"],
    target: "en_discussion",
    tone: "warn",
  },
  {
    key: "gagne",
    label: "Gagné",
    hint: "Contrat signé",
    statuses: ["gagne"],
    target: "gagne",
    tone: "good",
  },
  {
    key: "perdu",
    label: "Perdu",
    hint: "Sans suite",
    statuses: ["perdu"],
    target: "perdu",
    tone: "lost",
  },
];

/** Colonne d'accueil d'un statut donné. */
export function stageOf(status: ProspectStatus): Stage {
  return STAGES.find((stage) => stage.statuses.includes(status)) ?? STAGES[0];
}

/**
 * Statut à écrire quand une carte arrive dans une colonne.
 * `null` si la carte y est déjà (on évite d'écraser `relance_2` par
 * `relance_1` en la reposant dans la même colonne).
 */
export function statusForDrop(stage: Stage, current: ProspectStatus): ProspectStatus | null {
  if (stage.statuses.includes(current)) return null;
  return stage.target;
}

/** Couleurs de colonne, exprimées uniquement en tokens du design system. */
export const STAGE_TONE_VARS: Record<StageTone, { accent: string; soft: string }> = {
  neutral: { accent: "var(--faint)", soft: "var(--surface-2)" },
  brand: { accent: "var(--primary)", soft: "var(--primary-soft)" },
  warn: { accent: "var(--warn)", soft: "var(--warn-soft)" },
  good: { accent: "var(--good)", soft: "var(--good-soft)" },
  lost: { accent: "var(--lost)", soft: "var(--lost-soft)" },
};

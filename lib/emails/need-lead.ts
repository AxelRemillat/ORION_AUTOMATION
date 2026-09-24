import type { DerivedFact } from "./derived-facts";

/**
 * « Indice de besoin » — une friction opérationnelle probable, et sa confiance.
 *
 * Deux corrections par rapport à la version précédente :
 *
 * 1. Ce n'est PAS un indicateur de santé financière. « Forte rentabilité » ou
 *    « gestion efficace » décrivent une entreprise qui va bien, ce qui est
 *    exactement le contraire d'un besoin. L'indice doit nommer un volume, une
 *    dispersion, une saisie manuelle ou un délai.
 *
 * 2. La confiance n'est plus une constante à 80 %. Elle se calcule sur ce qu'on
 *    a réellement, et le détail est affiché au survol : un indice tiré du seul
 *    code NAF ne vaut pas un indice adossé à une offre d'emploi.
 */

export interface ConfidenceStep {
  label: string;
  weight: number;
  applied: boolean;
}

export interface NeedConfidence {
  value: number;
  steps: ConfidenceStep[];
  /** Détail lisible, destiné à l'info-bulle. */
  explanation: string;
}

/** Formulations refusées : elles décrivent une santé, pas un besoin. */
const NOT_A_NEED = [
  "forte rentabilite",
  "bonne sante",
  "gestion efficace",
  "solide",
  "performance financiere",
  "croissance rentable",
];

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * `true` si le texte décrit une friction exploitable.
 *
 * On exige un marqueur de friction : sans lui, « processus chargés » reste une
 * formule creuse qu'on ne peut pas transformer en accroche.
 */
export function describesNeed(text: string): boolean {
  const haystack = normalize(text);
  if (NOT_A_NEED.some((term) => haystack.includes(normalize(term)))) return false;

  return /volume|saisie|manuel|ressaisi|dispers|delai|attente|relance|contrat|releve|intervention|commande|dossier|document|planification|coordination|dupliqu/.test(
    haystack,
  );
}

/**
 * Confiance calibrée par des règles, pas par une constante.
 *
 * Les poids sont volontairement grossiers : l'important est qu'un indice fondé
 * sur une offre d'emploi datée se distingue d'un indice tiré d'un code NAF.
 */
export function needConfidence(input: {
  facts: DerivedFact[];
  hasSiteContent: boolean;
  /** Le vocabulaire du métier a-t-il été retrouvé sur le site ? */
  vocabularyConfirmed: boolean;
}): NeedConfidence {
  const hasDirectSignal = input.facts.some(
    (fact) => fact.source === "Signal web" && fact.hookTier <= 3,
  );

  const steps: ConfidenceStep[] = [
    { label: "Base : code NAF et données financières", weight: 0.4, applied: true },
    { label: "Modèle économique lu sur le site", weight: 0.2, applied: input.hasSiteContent },
    { label: "Signal direct (offre d'emploi, actualité)", weight: 0.2, applied: hasDirectSignal },
    { label: "Vocabulaire métier confirmé sur le site", weight: 0.1, applied: input.vocabularyConfirmed },
  ];

  const value = Number(
    steps.reduce((total, step) => total + (step.applied ? step.weight : 0), 0).toFixed(2),
  );

  const explanation = steps
    .map((step) => `${step.applied ? "+" : "—"} ${step.label} (${step.applied ? `+${step.weight}` : "0"})`)
    .join("\n");

  return { value, steps, explanation };
}

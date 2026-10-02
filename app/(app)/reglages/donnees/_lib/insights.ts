import type { Breakdown, FunnelStage, ResponseDelay } from "./metrics";

/**
 * « Ce qui marche » — constats tirés UNIQUEMENT des données réelles.
 *
 * Chaque constat exige un effectif minimal : sur trois prospects, un taux de
 * réponse ne veut rien dire. Quand rien n'atteint le seuil, on le dit au lieu
 * d'inventer une tendance.
 */

/** En dessous, un pourcentage n'est pas exploitable. */
const MIN_SAMPLE = 3;

export interface Insight {
  key: string;
  text: string;
  tone: "good" | "warn" | "neutral";
}

const percent = (value: number) => `${Math.round(value * 100)} %`;

export function buildInsights(input: {
  funnel: FunnelStage[];
  bySector: Breakdown[];
  bySequence: Breakdown[];
  bySignal: Breakdown[];
  delay: ResponseDelay;
}): Insight[] {
  const insights: Insight[] = [];

  const bestSector = input.bySector.find((row) => row.contacted >= MIN_SAMPLE);
  if (bestSector) {
    insights.push({
      key: "sector",
      tone: "good",
      text: `Meilleur secteur : ${bestSector.label} — ${percent(bestSector.rate)} de réponses (${bestSector.replied}/${bestSector.contacted}).`,
    });
  }

  const intro = input.bySequence.find((row) => row.key === "step-1");
  const relanced = input.bySequence.filter((row) => row.key !== "step-1");
  const relancedTotal = relanced.reduce(
    (totals, row) => ({
      contacted: totals.contacted + row.contacted,
      replied: totals.replied + row.replied,
    }),
    { contacted: 0, replied: 0 },
  );
  if (intro && intro.contacted >= MIN_SAMPLE && relancedTotal.contacted >= MIN_SAMPLE) {
    const relancedRate = relancedTotal.replied / relancedTotal.contacted;
    const better = relancedRate > intro.rate;
    insights.push({
      key: "sequence",
      tone: better ? "good" : "warn",
      text: better
        ? `Les relances paient : ${percent(intro.rate)} avec l'intro seule, ${percent(relancedRate)} en séquence.`
        : `Les relances n'apportent rien pour l'instant : ${percent(relancedRate)} contre ${percent(intro.rate)} sur l'intro seule.`,
    });
  }

  const withSignal = input.bySignal.find((row) => row.key === "with");
  const withoutSignal = input.bySignal.find((row) => row.key === "without");
  if (
    withSignal &&
    withoutSignal &&
    withSignal.contacted >= MIN_SAMPLE &&
    withoutSignal.contacted >= MIN_SAMPLE
  ) {
    const better = withSignal.rate > withoutSignal.rate;
    insights.push({
      key: "signal",
      tone: better ? "good" : "warn",
      text: better
        ? `Accrocher un signal d'actualité double la mise : ${percent(withSignal.rate)} contre ${percent(withoutSignal.rate)}.`
        : `Les signaux d'actualité ne changent rien à ce stade : ${percent(withSignal.rate)} contre ${percent(withoutSignal.rate)}.`,
    });
  }

  if (input.delay.medianDays !== null && input.delay.sample >= MIN_SAMPLE) {
    insights.push({
      key: "delay",
      tone: "neutral",
      text: `Les réponses arrivent en médiane sous ${input.delay.medianDays} jour(s) — au-delà, la relance a du sens.`,
    });
  }

  // Étape où l'on perd le plus de monde (hors première ligne de l'entonnoir).
  const worst = input.funnel
    .filter((stage) => stage.conversion !== null && stage.count > 0)
    .sort((a, b) => (a.conversion ?? 1) - (b.conversion ?? 1))[0];
  const previous = worst ? input.funnel[input.funnel.indexOf(worst) - 1] : null;
  if (worst && previous && previous.count >= MIN_SAMPLE) {
    insights.push({
      key: "funnel",
      tone: "warn",
      text: `Principale déperdition : ${previous.label} → ${worst.label} (${percent(worst.conversion ?? 0)} passent).`,
    });
  }

  return insights;
}

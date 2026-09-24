import type { Deal, InboundMessage, Message, Prospect } from "@/types";

/**
 * Séries du graphique KPI du Cockpit — fonctions PURES.
 *
 * Tout vient des tables réelles. Aucune valeur n'est inventée : un jour sans
 * activité vaut zéro, jamais une interpolation ou un exemple.
 */

export const SERIES_KEYS = ["envoyes", "reponses", "relances", "prospects", "pipeline"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];

export interface SeriesMeta {
  key: SeriesKey;
  label: string;
  /** Token de couleur ; le graphique le lit via `var(--token)`. */
  token: string;
  /** Les volumes se lisent à gauche, les euros à droite. */
  axis: "left" | "right";
  unit: "count" | "eur";
}

export const SERIES: SeriesMeta[] = [
  { key: "envoyes", label: "Emails envoyés", token: "--primary", axis: "left", unit: "count" },
  { key: "reponses", label: "Réponses reçues", token: "--warn", axis: "left", unit: "count" },
  { key: "relances", label: "Relances envoyées", token: "--violet", axis: "left", unit: "count" },
  { key: "prospects", label: "Prospects ajoutés", token: "--teal", axis: "left", unit: "count" },
  { key: "pipeline", label: "Valeur pipeline", token: "--good", axis: "right", unit: "eur" },
];

/** Séries cochées à l'ouverture : la paire qui raconte l'essentiel. */
export const DEFAULT_SERIES: SeriesKey[] = ["envoyes", "reponses"];

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface ChartData {
  /** Jours de la période, du plus ancien au plus récent (AAAA-MM-JJ). */
  days: string[];
  labels: string[];
  values: Record<SeriesKey, number[]>;
  /** Part des emails envoyés sur la période qui ont reçu une réponse (0–1). */
  responseRate: number;
  sent: number;
  replies: number;
  /** Faux quand rien ne s'est passé : l'écran affiche alors des axes à zéro. */
  hasData: boolean;
}

const DAY_MS = 86_400_000;
const dayKey = (iso: string) => iso.slice(0, 10);

const LABEL_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** Les `days` derniers jours, aujourd'hui inclus. */
function buildDays(days: number, now: number): string[] {
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(new Date(now - offset * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

export function buildChartData(
  input: {
    messages: Message[];
    inbound: InboundMessage[];
    prospects: Prospect[];
    deals: Deal[];
  },
  period: number,
  now = Date.now(),
): ChartData {
  const days = buildDays(period, now);
  const index = new Map(days.map((day, position) => [day, position]));
  const zeros = () => new Array<number>(days.length).fill(0);

  const values: Record<SeriesKey, number[]> = {
    envoyes: zeros(),
    reponses: zeros(),
    relances: zeros(),
    prospects: zeros(),
    pipeline: zeros(),
  };

  const bump = (key: SeriesKey, iso: string | null) => {
    if (!iso) return;
    const position = index.get(dayKey(iso));
    if (position !== undefined) values[key][position] += 1;
  };

  for (const message of input.messages) {
    if (message.status !== "sent") continue;
    bump("envoyes", message.sent_at);
    if (message.type === "relance_1" || message.type === "relance_2") {
      bump("relances", message.sent_at);
    }
  }
  for (const message of input.inbound) bump("reponses", message.received_at);
  for (const prospect of input.prospects) bump("prospects", prospect.created_at);

  // La valeur du pipeline est un ETAT, pas un flux : à chaque jour on somme les
  // deals ouverts déjà créés à cette date. La courbe monte donc en escalier.
  const openDeals = input.deals.filter((deal) => deal.status === "ouvert");
  days.forEach((day, position) => {
    const end = Date.parse(`${day}T23:59:59.999Z`);
    values.pipeline[position] = openDeals
      .filter((deal) => Date.parse(deal.created_at) <= end)
      .reduce((total, deal) => total + (deal.amount_eur ?? 0), 0);
  });

  const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);
  const sent = sum(values.envoyes);
  const replies = sum(values.reponses);

  return {
    days,
    labels: days.map((day) => LABEL_FORMAT.format(new Date(`${day}T12:00:00Z`))),
    values,
    responseRate: sent > 0 ? replies / sent : 0,
    sent,
    replies,
    hasData: SERIES_KEYS.some((key) => values[key].some((value) => value > 0)),
  };
}

/**
 * Les trois périodes, calculées côté SERVEUR.
 *
 * Le sélecteur est côté client, mais lui passer les tables brutes enverrait
 * aussi les corps d'emails dans le HTML. On n'expose donc que les agrégats :
 * 3 x 5 séries de nombres, quelques kilo-octets.
 */
export function buildAllPeriods(
  input: {
    messages: Message[];
    inbound: InboundMessage[];
    prospects: Prospect[];
    deals: Deal[];
  },
  now = Date.now(),
): Record<Period, ChartData> {
  return {
    7: buildChartData(input, 7, now),
    30: buildChartData(input, 30, now),
    90: buildChartData(input, 90, now),
  };
}

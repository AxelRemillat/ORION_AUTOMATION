import { isProspectReply } from "@/lib/inbound/auto-reply";
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
  /**
   * Nom du token RVB.
   *
   * On passe par `--rgb-*` et non par le token nommé : `--violet` n'existe pas
   * dans le thème (seul `--rgb-violet` est défini), si bien que
   * `stroke: var(--violet)` était invalide et la courbe « Relances envoyées »
   * héritait du `stroke: none` par défaut du SVG — invisible. Le namespace
   * `--rgb-*` est le seul complet, et il permet en prime les opacités.
   */
  rgb: string;
  /** Les volumes se lisent à gauche, les euros à droite. */
  axis: "left" | "right";
  unit: "count" | "eur";
  /** Singulier / pluriel, pour les libellés du bandeau. */
  noun: [string, string];
}

export const SERIES: SeriesMeta[] = [
  { key: "envoyes", label: "Emails envoyés", rgb: "--rgb-primary", axis: "left", unit: "count", noun: ["email", "emails"] },
  { key: "reponses", label: "Réponses reçues", rgb: "--rgb-warn", axis: "left", unit: "count", noun: ["réponse", "réponses"] },
  { key: "relances", label: "Relances envoyées", rgb: "--rgb-violet", axis: "left", unit: "count", noun: ["relance", "relances"] },
  { key: "prospects", label: "Prospects ajoutés", rgb: "--rgb-teal", axis: "left", unit: "count", noun: ["prospect", "prospects"] },
  { key: "pipeline", label: "Valeur pipeline", rgb: "--rgb-good", axis: "right", unit: "eur", noun: ["euro", "euros"] },
];

export const SERIES_BY_KEY = new Map(SERIES.map((meta) => [meta.key, meta]));

/** Couleur d'une série, opacité comprise. */
export const seriesColor = (meta: SeriesMeta, alpha = 1) =>
  alpha >= 1 ? `rgb(var(${meta.rgb}))` : `rgb(var(${meta.rgb}) / ${alpha})`;

/** Séries cochées à l'ouverture. */
export const DEFAULT_SERIES: SeriesKey[] = ["envoyes", "reponses", "prospects"];

/** Lit `?kpi=envoyes,reponses`. Une valeur inconnue est ignorée, jamais fatale. */
export function parseSeriesParam(raw: string | undefined): SeriesKey[] {
  const wanted = (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is SeriesKey => SERIES_KEYS.includes(part as SeriesKey));
  return wanted.length ? [...new Set(wanted)] : DEFAULT_SERIES;
}

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
  /** Somme de la période — sauf le pipeline, qui est un état : sa dernière valeur. */
  totals: Record<SeriesKey, number>;
  /** Mêmes totaux sur la période PRÉCÉDENTE, pour la variation. */
  previous: Record<SeriesKey, number>;
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
  // Rebonds et réponses automatiques (anti-spam, absence) ne sont pas des réponses.
  for (const message of input.inbound) if (isProspectReply(message)) bump("reponses", message.received_at);
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
    totals: totalsOf(values),
    // Renseigné par buildAllPeriods, qui rejoue la fenêtre d'avant.
    previous: totalsOf(values),
  };
}

/** Un flux se somme ; un état (le pipeline) se lit à sa dernière valeur. */
function totalsOf(values: Record<SeriesKey, number[]>): Record<SeriesKey, number> {
  const out = {} as Record<SeriesKey, number>;
  for (const meta of SERIES) {
    const list = values[meta.key];
    out[meta.key] =
      meta.unit === "eur"
        ? (list[list.length - 1] ?? 0)
        : list.reduce((total, value) => total + value, 0);
  }
  return out;
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
  // La variation se lit contre la fenêtre juste avant : on rejoue le même
  // calcul décalé d'une période, et on n'en garde que les totaux.
  const withPrevious = (period: Period): ChartData => ({
    ...buildChartData(input, period, now),
    previous: buildChartData(input, period, now - period * DAY_MS).totals,
  });

  return { 7: withPrevious(7), 30: withPrevious(30), 90: withPrevious(90) };
}

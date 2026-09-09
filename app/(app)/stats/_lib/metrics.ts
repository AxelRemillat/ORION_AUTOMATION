import type { Deal, Message, Prospect, ProspectStatus } from "@/types";

/**
 * Agrégats du dashboard — fonctions PURES, exécutées côté serveur à partir des
 * lignes Supabase. Aucune couleur, aucun composant ici : uniquement du calcul.
 *
 * Convention : ce que le schéma actuel ne permet pas de mesurer passe par
 * `_lib/estimates.ts` et s'affiche comme « exemple », jamais mélangé au réel.
 */

/** Statuts qui prouvent qu'un premier message est parti. */
const CONTACTED: ProspectStatus[] = [
  "contacte",
  "relance_1",
  "relance_2",
  "repondu",
  "en_discussion",
  "gagne",
  "perdu",
];
/** Statuts qui prouvent une réponse du prospect. */
const REPLIED: ProspectStatus[] = ["repondu", "en_discussion", "gagne"];
/** Statuts « discussion engagée » (RDV pris, proposition en cours). */
const ENGAGED: ProspectStatus[] = ["en_discussion", "gagne"];

const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);
const DAY_MS = 86_400_000;

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Part du total de prospects (0–1). */
  share: number;
  /** Conversion depuis l'étape précédente (0–1), `null` pour la première. */
  conversion: number | null;
}

/** Entonnoir : base -> contactés -> réponses -> en discussion -> gagnés. */
export function buildFunnel(prospects: Prospect[], messages: Message[]): FunnelStage[] {
  const contactedIds = new Set<string>();
  for (const message of messages) {
    if (message.status === "sent") contactedIds.add(message.prospect_id);
  }
  for (const prospect of prospects) {
    if (CONTACTED.includes(prospect.status)) contactedIds.add(prospect.id);
  }

  const total = prospects.length;
  const counts = [
    { key: "base", label: "Prospects", count: total },
    { key: "contacte", label: "Contactés", count: contactedIds.size },
    {
      key: "repondu",
      label: "Réponses",
      count: prospects.filter((item) => REPLIED.includes(item.status)).length,
    },
    {
      key: "discussion",
      label: "En discussion",
      count: prospects.filter((item) => ENGAGED.includes(item.status)).length,
    },
    {
      key: "gagne",
      label: "Gagnés",
      count: prospects.filter((item) => item.status === "gagne").length,
    },
  ];

  return counts.map((stage, index) => ({
    ...stage,
    share: ratio(stage.count, total),
    conversion: index === 0 ? null : ratio(stage.count, counts[index - 1].count),
  }));
}

export interface SeriesPoint {
  date: string;
  label: string;
  value: number;
}

/** Premiers contacts par jour sur `days` jours (un prospect compté une seule fois). */
export function contactedSeries(messages: Message[], days = 30): SeriesPoint[] {
  const firstSent = new Map<string, string>();
  for (const message of messages) {
    if (message.status !== "sent" || !message.sent_at) continue;
    const current = firstSent.get(message.prospect_id);
    if (!current || message.sent_at < current) firstSent.set(message.prospect_id, message.sent_at);
  }

  const perDay = new Map<string, number>();
  for (const sentAt of firstSent.values()) {
    const key = sentAt.slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const format = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const points: SeriesPoint[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));

  for (let index = 0; index < days; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({ date: key, label: format.format(cursor), value: perDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

/**
 * Réponses par jour, approximées par la date de mise à jour du prospect au
 * moment où il est passé en « répondu » (le schéma ne date pas les réponses).
 */
export function repliedSeries(prospects: Prospect[], days = 30): SeriesPoint[] {
  const perDay = new Map<string, number>();
  for (const prospect of prospects) {
    if (!REPLIED.includes(prospect.status)) continue;
    const key = prospect.updated_at.slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const format = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const points: SeriesPoint[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));

  for (let index = 0; index < days; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({ date: key, label: format.format(cursor), value: perDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export interface Breakdown {
  key: string;
  label: string;
  /** Prospects contactés dans ce segment. */
  contacted: number;
  replied: number;
  rate: number;
}

/** Taux de réponse agrégé par une clé libre (secteur, séquence, signal…). */
function breakdownBy(
  prospects: Prospect[],
  keyOf: (prospect: Prospect) => { key: string; label: string } | null,
): Breakdown[] {
  const buckets = new Map<string, Breakdown>();

  for (const prospect of prospects) {
    if (!CONTACTED.includes(prospect.status)) continue;
    const segment = keyOf(prospect);
    if (!segment) continue;

    const bucket = buckets.get(segment.key) ?? {
      key: segment.key,
      label: segment.label,
      contacted: 0,
      replied: 0,
      rate: 0,
    };
    bucket.contacted += 1;
    if (REPLIED.includes(prospect.status)) bucket.replied += 1;
    buckets.set(segment.key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, rate: ratio(bucket.replied, bucket.contacted) }))
    .sort((a, b) => b.rate - a.rate || b.contacted - a.contacted);
}

/** Taux de réponse par secteur d'activité. */
export function responseBySector(prospects: Prospect[]): Breakdown[] {
  return breakdownBy(prospects, (prospect) =>
    prospect.sector ? { key: prospect.sector, label: prospect.sector } : null,
  );
}

/** Taux de réponse selon la profondeur de séquence atteinte. */
export function responseBySequence(prospects: Prospect[], messages: Message[]): Breakdown[] {
  const depth = new Map<string, number>();
  for (const message of messages) {
    if (message.status !== "sent") continue;
    const step = message.type === "relance_2" ? 3 : message.type === "relance_1" ? 2 : 1;
    depth.set(message.prospect_id, Math.max(depth.get(message.prospect_id) ?? 0, step));
  }

  const labels = ["Intro seule", "Intro + relance J+4", "Séquence complète"];
  return breakdownBy(prospects, (prospect) => {
    const step = depth.get(prospect.id) ?? 1;
    return { key: `step-${step}`, label: labels[step - 1] ?? labels[0] };
  });
}

/** Taux de réponse avec ou sans signal d'actualité exploitable. */
export function responseBySignal(prospects: Prospect[]): Breakdown[] {
  return breakdownBy(prospects, (prospect) =>
    prospect.signals?.length
      ? { key: "with", label: "Avec signal d'actualité" }
      : { key: "without", label: "Sans signal" },
  );
}

export interface ResponseDelay {
  /** Médiane en jours, `null` si aucune réponse mesurable. */
  medianDays: number | null;
  sample: number;
}

/**
 * Délai de réponse estimé : écart entre le dernier envoi et la mise à jour du
 * prospect qui l'a fait passer en « répondu ». Le schéma ne stocke pas de date
 * de réponse : c'est une approximation, signalée comme telle dans l'UI.
 */
export function responseDelay(prospects: Prospect[], messages: Message[]): ResponseDelay {
  const lastSent = new Map<string, string>();
  for (const message of messages) {
    if (message.status !== "sent" || !message.sent_at) continue;
    const current = lastSent.get(message.prospect_id);
    if (!current || message.sent_at > current) lastSent.set(message.prospect_id, message.sent_at);
  }

  const delays: number[] = [];
  for (const prospect of prospects) {
    if (!REPLIED.includes(prospect.status)) continue;
    const sentAt = lastSent.get(prospect.id);
    if (!sentAt) continue;
    const days = (Date.parse(prospect.updated_at) - Date.parse(sentAt)) / DAY_MS;
    if (Number.isFinite(days) && days >= 0) delays.push(days);
  }

  if (delays.length === 0) return { medianDays: null, sample: 0 };
  delays.sort((a, b) => a - b);
  const middle = Math.floor(delays.length / 2);
  const median =
    delays.length % 2 === 0 ? (delays[middle - 1] + delays[middle]) / 2 : delays[middle];
  return { medianDays: Math.round(median * 10) / 10, sample: delays.length };
}

/** Chiffre d'affaires réellement signé (deals gagnés). */
export function signedRevenue(deals: Deal[]): { amount: number; count: number } {
  const won = deals.filter((deal) => deal.status === "gagne");
  return {
    amount: won.reduce((sum, deal) => sum + Number(deal.amount_eur ?? 0), 0),
    count: won.length,
  };
}

export interface MonthPoint {
  month: string;
  label: string;
  amount: number;
  deals: number;
}

/** CA signé mois par mois, sur `months` mois glissants. */
export function revenueByMonth(deals: Deal[], months = 6): MonthPoint[] {
  const perMonth = new Map<string, { amount: number; deals: number }>();
  for (const deal of deals) {
    if (deal.status !== "gagne") continue;
    const key = (deal.signed_at ?? deal.created_at).slice(0, 7);
    const bucket = perMonth.get(key) ?? { amount: 0, deals: 0 };
    bucket.amount += Number(deal.amount_eur ?? 0);
    bucket.deals += 1;
    perMonth.set(key, bucket);
  }

  const format = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" });
  const points: MonthPoint[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(12, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (months - 1));

  for (let index = 0; index < months; index += 1) {
    const key = cursor.toISOString().slice(0, 7);
    const bucket = perMonth.get(key) ?? { amount: 0, deals: 0 };
    points.push({ month: key, label: format.format(cursor), ...bucket });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}

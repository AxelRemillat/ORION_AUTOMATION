import type { Deal, Message, Prospect, ProspectStatus } from "@/types";

/**
 * Agrégats du dashboard — fonctions PURES, calculées côté serveur à partir des
 * lignes Supabase brutes. Aucun accès réseau ici : les pages passent les
 * tableaux, ces fonctions renvoient de quoi alimenter les graphes.
 */

export interface TimePoint {
  /** Jour au format ISO court (YYYY-MM-DD), utilisé comme clé de série. */
  date: string;
  /** Libellé court affiché en axe X ("12 mars"). */
  label: string;
  /** Prospects contactés ce jour-là. */
  count: number;
  /** Total depuis le début de la fenêtre. */
  cumulative: number;
}

export interface FunnelStats {
  contacted: number;
  relanced: number;
  replied: number;
  inDiscussion: number;
  won: number;
  lost: number;
  /** Part des contactés qui ont reçu au moins une relance (0–1). */
  relanceRate: number;
  /** Part des contactés qui ont répondu (0–1). */
  replyRate: number;
  /** Part des répondus qui ont signé (0–1). */
  successRate: number;
}

export interface RevenuePoint {
  /** Mois au format YYYY-MM. */
  month: string;
  label: string;
  amount: number;
  deals: number;
}

/** Une réponse du prospect est ce qui l'amène à l'un de ces statuts. */
const REPLIED_STATUSES: ProspectStatus[] = ["repondu", "en_discussion", "gagne"];
/** Statuts qui impliquent qu'un premier message est bien parti. */
const CONTACTED_STATUSES: ProspectStatus[] = [
  "contacte",
  "relance_1",
  "relance_2",
  "repondu",
  "en_discussion",
  "gagne",
  "perdu",
];
const RELANCED_STATUSES: ProspectStatus[] = ["relance_1", "relance_2"];

const dayKey = (iso: string) => iso.slice(0, 10);
const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);

const formatDay = (date: Date) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(date);

const formatMonth = (date: Date) =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(date);

/**
 * Prospects contactés dans le temps, sur les `days` derniers jours.
 * Un prospect n'est compté qu'une fois, au jour de son premier message envoyé.
 */
export function contactedOverTime(messages: Message[], days = 30): TimePoint[] {
  const firstSentByProspect = new Map<string, string>();
  for (const message of messages) {
    if (message.status !== "sent" || !message.sent_at) continue;
    const current = firstSentByProspect.get(message.prospect_id);
    if (!current || message.sent_at < current) {
      firstSentByProspect.set(message.prospect_id, message.sent_at);
    }
  }

  const perDay = new Map<string, number>();
  for (const sentAt of firstSentByProspect.values()) {
    const key = dayKey(sentAt);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const points: TimePoint[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));

  let cumulative = 0;
  for (let index = 0; index < days; index += 1) {
    const key = dayKey(cursor.toISOString());
    cumulative += perDay.get(key) ?? 0;
    points.push({ date: key, label: formatDay(cursor), count: perDay.get(key) ?? 0, cumulative });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

/**
 * Taux de relance / réponse / succès.
 * On croise les statuts (source de vérité métier) et les messages réellement
 * envoyés, pour rester juste même si un statut a été posé à la main.
 */
export function funnelStats(prospects: Prospect[], messages: Message[]): FunnelStats {
  const contactedIds = new Set<string>();
  const relancedIds = new Set<string>();

  for (const message of messages) {
    if (message.status !== "sent") continue;
    contactedIds.add(message.prospect_id);
    if (message.type === "relance_1" || message.type === "relance_2") {
      relancedIds.add(message.prospect_id);
    }
  }

  let replied = 0;
  let inDiscussion = 0;
  let won = 0;
  let lost = 0;

  for (const prospect of prospects) {
    if (CONTACTED_STATUSES.includes(prospect.status)) contactedIds.add(prospect.id);
    if (RELANCED_STATUSES.includes(prospect.status)) relancedIds.add(prospect.id);
    if (REPLIED_STATUSES.includes(prospect.status)) replied += 1;
    if (prospect.status === "en_discussion") inDiscussion += 1;
    if (prospect.status === "gagne") won += 1;
    if (prospect.status === "perdu") lost += 1;
  }

  const contacted = contactedIds.size;
  const relanced = relancedIds.size;

  return {
    contacted,
    relanced,
    replied,
    inDiscussion,
    won,
    lost,
    relanceRate: ratio(relanced, contacted),
    replyRate: ratio(replied, contacted),
    successRate: ratio(won, replied),
  };
}

/** Contrats signés et chiffre d'affaires, mois par mois (sur `months` mois). */
export function revenueByMonth(deals: Deal[], months = 6): RevenuePoint[] {
  const perMonth = new Map<string, { amount: number; deals: number }>();

  for (const deal of deals) {
    if (deal.status !== "gagne") continue;
    const reference = deal.signed_at ?? deal.created_at;
    const key = reference.slice(0, 7);
    const bucket = perMonth.get(key) ?? { amount: 0, deals: 0 };
    bucket.amount += Number(deal.amount_eur ?? 0);
    bucket.deals += 1;
    perMonth.set(key, bucket);
  }

  const points: RevenuePoint[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(12, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (months - 1));

  for (let index = 0; index < months; index += 1) {
    const key = cursor.toISOString().slice(0, 7);
    const bucket = perMonth.get(key) ?? { amount: 0, deals: 0 };
    points.push({ month: key, label: formatMonth(cursor), ...bucket });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}

/** Total encaissable : somme des montants des deals gagnés. */
export function totalRevenue(deals: Deal[]): number {
  return deals
    .filter((deal) => deal.status === "gagne")
    .reduce((sum, deal) => sum + Number(deal.amount_eur ?? 0), 0);
}

/** Répartition des prospects par statut, dans l'ordre du pipeline fourni. */
export function countByStatus(
  prospects: Prospect[],
  order: ProspectStatus[],
): { status: ProspectStatus; count: number }[] {
  const counts = new Map<ProspectStatus, number>();
  for (const prospect of prospects) {
    counts.set(prospect.status, (counts.get(prospect.status) ?? 0) + 1);
  }
  return order.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

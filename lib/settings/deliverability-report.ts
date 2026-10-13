import { isBounce } from "@/lib/inbound/bounce";
import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { isGenericAddress } from "@/lib/contact-finder/upgrade";
import { utcToParis } from "@/lib/outbox/paris-time";

/**
 * POINT DÉLIVRABILITÉ (Cowork #26) — code pur, lecture seule.
 *
 * Depuis le premier envoi (28/09/2026) : envois (intros / relances), rebonds durs et
 * mous par type d'adresse (nominative / générique), réponses (réelles, refus, absences,
 * anti-spams), « stop », taux par semaine, et le vrai goulot : les mails prêts (≥ 9/10)
 * produits par jour ouvré.
 */

export const REPORT_SINCE = "2026-09-28";

export interface ReportSent { id: string; type: string | null; sent_at: string; prospect_id: string | null }
export interface ReportInbound { from_email: string; subject?: string | null; body?: string | null; category?: string | null; received_at: string; prospect_id?: string | null }
export interface ReportProspect { id: string; email: string | null; email_type?: "nominatif" | "generique" | null }
export interface ReportDraft { type: string | null; created_at: string; quality_score: number | null }

export type AddressKind = "nominative" | "generique";
export interface WeekRow {
  week: string;
  intros: number;
  relances: number;
  hardBounces: number;
  softBounces: number;
  replies: number;
  refusals: number;
  absences: number;
  antispam: number;
  stops: number;
}

export interface DeliverabilityReport {
  since: string;
  weeks: WeekRow[];
  totals: WeekRow;
  bouncesByKind: Record<AddressKind, { hard: number; soft: number; sent: number }>;
  /** Rebonds dont le destinataire n'a pas pu être retrouvé dans les envois. */
  unmatchedBounces: number;
  readyPerBusinessDay: number;
  readyDays: { day: string; ready: number }[];
}

const HARD = /\b5\.\d\.\d+\b|\b55[0-4]\b|does not exist|doesn't exist|user unknown|unknown user|no such user|address not found|adresse introuvable|n'existe pas|introuvable|mailbox unavailable|recipient rejected|invalid recipient/i;
const SOFT = /\b4\.\d\.\d+\b|\b4[25]\d\b|mailbox (is )?full|quota|over quota|temporar|try again|réessa|greylist|délai dépassé|deferred/i;

/** Rebond dur (adresse qui n'existe pas) ou mou (boîte pleine, refus temporaire). Dur par défaut. */
export function bounceKind(message: Pick<ReportInbound, "subject" | "body">): "hard" | "soft" {
  const text = `${message.subject ?? ""}\n${message.body ?? ""}`;
  if (HARD.test(text)) return "hard";
  return SOFT.test(text) ? "soft" : "hard";
}

const isStop = (message: ReportInbound) => message.category === "refus" || /^\s*stop\b/i.test(message.body ?? "") || /^\s*stop\b/i.test(message.subject ?? "");

/** Lundi (Paris) de la semaine d'une date ISO : « 2026-09-28 ». */
export function weekOf(iso: string): string {
  const day = utcToParis(new Date(iso)).date;
  const date = new Date(`${day}T12:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - shift * 86_400_000).toISOString().slice(0, 10);
}

const emptyWeek = (week: string): WeekRow => ({ week, intros: 0, relances: 0, hardBounces: 0, softBounces: 0, replies: 0, refusals: 0, absences: 0, antispam: 0, stops: 0 });

export function buildDeliverabilityReport(input: {
  sent: readonly ReportSent[];
  inbound: readonly ReportInbound[];
  prospects: readonly ReportProspect[];
  drafts: readonly ReportDraft[];
  since?: string;
  now?: Date;
}): DeliverabilityReport {
  const since = input.since ?? REPORT_SINCE;
  const prospects = new Map(input.prospects.map((prospect) => [prospect.id, prospect]));
  const weeks = new Map<string, WeekRow>();
  const row = (iso: string) => {
    const key = weekOf(iso);
    if (!weeks.has(key)) weeks.set(key, emptyWeek(key));
    return weeks.get(key) as WeekRow;
  };
  const kindOf = (prospectId: string | null | undefined): AddressKind => {
    const prospect = prospectId ? prospects.get(prospectId) : undefined;
    return prospect && isGenericAddress({ email: prospect.email, email_type: prospect.email_type ?? null }) ? "generique" : "nominative";
  };
  const bouncesByKind: Record<AddressKind, { hard: number; soft: number; sent: number }> = { nominative: { hard: 0, soft: 0, sent: 0 }, generique: { hard: 0, soft: 0, sent: 0 } };
  // Adresse → prospect, pour retrouver le destinataire d'un rebond (cité dans le texte du rebond).
  const byEmail = new Map<string, string>();
  const sent = input.sent.filter((message) => utcToParis(new Date(message.sent_at)).date >= since && /^(intro|relance_1|relance_2)$/.test(String(message.type)));
  for (const message of sent) {
    const week = row(message.sent_at);
    if (message.type === "intro") week.intros += 1;
    else week.relances += 1;
    bouncesByKind[kindOf(message.prospect_id)].sent += 1;
    const email = message.prospect_id ? prospects.get(message.prospect_id)?.email?.toLowerCase() : null;
    if (email && message.prospect_id) byEmail.set(email, message.prospect_id);
  }
  let unmatchedBounces = 0;
  for (const message of input.inbound.filter((item) => utcToParis(new Date(item.received_at)).date >= since)) {
    const week = row(message.received_at);
    if (isBounce(message)) {
      const kind = bounceKind(message);
      if (kind === "hard") week.hardBounces += 1;
      else week.softBounces += 1;
      const text = `${message.subject ?? ""} ${message.body ?? ""}`.toLowerCase();
      const recipient = [...byEmail.keys()].find((email) => text.includes(email));
      if (recipient) bouncesByKind[kindOf(byEmail.get(recipient))][kind] += 1;
      else unmatchedBounces += 1;
      continue;
    }
    const auto = autoReplyKind({ from_email: message.from_email, subject: message.subject ?? "", body: message.body ?? "" } as never);
    if (auto === "absence") week.absences += 1;
    else if (auto === "antispam") week.antispam += 1;
    else if (isStop(message)) {
      week.stops += 1;
      week.refusals += 1;
    } else if (message.prospect_id) week.replies += 1;
  }
  const ordered = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  const totals = ordered.reduce((sum, week) => {
    for (const key of Object.keys(sum) as (keyof WeekRow)[]) if (key !== "week") (sum[key] as number) += week[key] as number;
    return sum;
  }, emptyWeek("total"));
  // Le vrai goulot : mails prêts (≥ 9/10) créés par jour ouvré.
  const perDay = new Map<string, number>();
  for (const draft of input.drafts) {
    const day = utcToParis(new Date(draft.created_at)).date;
    if (day < since || (draft.quality_score ?? 0) < 9 || draft.type !== "intro") continue;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const today = utcToParis(input.now ?? new Date()).date;
  const businessDays: string[] = [];
  for (let cursor = new Date(`${since}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= today; cursor = new Date(cursor.getTime() + 86_400_000)) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) businessDays.push(cursor.toISOString().slice(0, 10));
  }
  const readyDays = businessDays.map((day) => ({ day, ready: perDay.get(day) ?? 0 }));
  const readyTotal = readyDays.reduce((sum, day) => sum + day.ready, 0);
  return { since, weeks: ordered, totals, bouncesByKind, unmatchedBounces, readyPerBusinessDay: businessDays.length ? readyTotal / businessDays.length : 0, readyDays };
}

/** Taux en % (1 décimale), « — » sans envoi. */
export const rate = (count: number, sent: number) => (sent ? `${((count / sent) * 100).toFixed(1).replace(".", ",")} %` : "—");

/**
 * RECOMMANDATION pour le palier suivant, chiffrée : on monte seulement si la réputation
 * tient (rebonds durs < 2 %, stop < 1 %) ET si la production de mails prêts suit — sinon
 * monter le plafond ne fait rien partir de plus.
 */
export function recommendation(report: DeliverabilityReport, next: number): { go: boolean; text: string } {
  const sent = report.totals.intros + report.totals.relances;
  const hardRate = sent ? report.totals.hardBounces / sent : 0;
  const stopRate = sent ? report.totals.stops / sent : 0;
  const reputation = sent >= 50 && hardRate < 0.02 && stopRate < 0.01;
  const production = report.readyPerBusinessDay;
  const parts = [
    `${sent} envois depuis le ${report.since.split("-").reverse().join("/")}`,
    `rebonds durs ${rate(report.totals.hardBounces, sent)} (seuil 2 %)`,
    `« stop » ${rate(report.totals.stops, sent)} (seuil 1 %)`,
    `${production.toFixed(1).replace(".", ",")} mails prêts ≥ 9/10 par jour ouvré`,
  ];
  if (!reputation) return { go: false, text: `Ne pas monter à ${next} : ${parts.join(" · ")}. La réputation n'est pas encore prouvée.` };
  return {
    go: true,
    text: `Monter à ${next} : la réputation tient (${parts.slice(0, 3).join(" · ")}). Goulot : ${parts[3]}${production < next ? ` — les relances comblent le reste ; le plafond ne fera partir de plus que si la production suit.` : "."}`,
  };
}

import { PROSPECT_STATUS_META } from "@/lib/constants";
import { followUpBlock } from "@/lib/outbox/follow-up-policy";
import { offWeekend, utcToParis } from "@/lib/outbox/paris-time";
import { isBounce } from "@/lib/settings/volumes";
import { autoReplyKind, isProspectReply } from "@/lib/inbound/auto-reply";
import type { ProspectStatus } from "@/types";

/**
 * Historique d'une fiche prospect — code pur. Une chronologie unique, du plus
 * récent au plus ancien, construite à partir de ce que la base contient DÉJÀ :
 * mails envoyés et reçus, programmations, relances (prévues, soldées,
 * bloquées), événements ORION (statut, « ne plus contacter », opposition,
 * notes), signaux d'origine, affaires.
 *
 * Générique : chaque événement porte un `channel` (email, orion, signal…) et un
 * `kind` — LinkedIn ou Malt s'ajouteront comme de nouveaux canaux.
 */

export type HistoryTone = "brand" | "good" | "warn" | "lost" | "info" | "neutral";

export interface HistoryEvent {
  id: string;
  at: string;
  /** Jour (Paris) AAAA-MM-JJ, pour le regroupement. */
  day: string;
  channel: string;
  kind: string;
  title: string;
  detail?: string | null;
  subject?: string | null;
  excerpt?: string | null;
  body?: string | null;
  badge?: { label: string; tone: HistoryTone } | null;
  tone: HistoryTone;
  /** Échéance à venir (relance prévue, envoi programmé). */
  upcoming?: boolean;
}

export interface HistorySummary {
  sent: number;
  received: number;
  lastContactAt: string | null;
  lastContactDays: number | null;
}

export interface HistoryRow {
  id: string;
  company_name: string;
  status: ProspectStatus;
  do_not_contact?: boolean | null;
  key_figures?: Record<string, unknown> | null;
  signals?: { type?: string; label?: string; date?: string | null; source?: string; url?: string }[] | null;
  created_at: string;
  updated_at?: string | null;
  messages?: { id: string; type: string; status: string; send_status?: string | null; subject?: string | null; body?: string | null; sent_at?: string | null; scheduled_at?: string | null; created_at: string; send_error?: string | null; deleted_at?: string | null; origin?: string | null }[];
  inbound_messages?: { id: string; from_email: string; subject?: string | null; body?: string | null; category?: string | null; received_at: string; deleted_at?: string | null }[];
  reminders?: { id: string; due_at: string; done: boolean }[];
  deals?: { id: string; status: string; amount_eur?: number | null; signed_at?: string | null; created_at: string }[];
  signal_candidates?: { id: string; source: string; date_signal?: string | null; facts?: { label?: string; jobTitle?: string } | null; created_at: string }[];
  prospect_events?: { id: string; channel: string; kind: string; at: string; data?: Record<string, unknown> | null }[];
}

const TYPE_LABEL: Record<string, string> = { intro: "Intro", relance_1: "Relance J+4", relance_2: "Relance J+7", reponse: "Réponse", note: "Note" };
const statusLabel = (status: unknown) => PROSPECT_STATUS_META[status as ProspectStatus]?.label ?? String(status ?? "—");
const dayOf = (iso: string) => utcToParis(new Date(iso)).date;
const clock = (iso: string) => utcToParis(new Date(iso)).time.replace(":", " h ");

/** Extrait lisible : sans la formule d'appel, une ligne, ~180 caractères. */
export function excerptOf(body: string | null | undefined, max = 180): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = /^(bonjour|madame|monsieur|hello)\b/i.test(lines[0] ?? "") ? 1 : 0;
  const text = lines.slice(start).join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || null;
}

function inboundBadge(message: { from_email: string; subject?: string | null; body?: string | null; category?: string | null }): { label: string; tone: HistoryTone } {
  if (isBounce(message)) return { label: "rebond", tone: "lost" };
  const auto = autoReplyKind(message);
  if (auto === "antispam") return { label: "validation anti-spam", tone: "warn" };
  if (auto === "absence") return { label: "réponse auto", tone: "neutral" };
  if (message.category === "refus" || /^\s*stop\b/i.test(message.body ?? "")) return { label: "refus", tone: "lost" };
  return { label: "réponse", tone: "good" };
}

export function buildHistory(row: HistoryRow, now = new Date()): { events: HistoryEvent[]; summary: HistorySummary } {
  const events: HistoryEvent[] = [];
  const push = (event: Omit<HistoryEvent, "day">) => events.push({ ...event, day: dayOf(event.at) });

  push({ id: `created-${row.id}`, at: row.created_at, channel: "orion", kind: "created", title: "Fiche créée", tone: "neutral" });

  // Mails de l'application (jamais les brouillons d'éval ou de script).
  const messages = (row.messages ?? []).filter((message) => !message.deleted_at && !message.origin);
  for (const message of messages) {
    const label = TYPE_LABEL[message.type] ?? message.type;
    if (message.type === "note") {
      push({ id: `note-msg-${message.id}`, at: message.created_at, channel: "orion", kind: "note", title: "Note", body: message.body, excerpt: excerptOf(message.body), tone: "neutral" });
    } else if (message.status === "sent") {
      const at = message.sent_at ?? message.created_at;
      push({ id: `sent-${message.id}`, at, channel: "email", kind: "sent", title: `${label} envoyée · ${clock(at)}`, subject: message.subject, excerpt: excerptOf(message.body), body: message.body, tone: "brand" });
    } else if (message.send_status === "scheduled" && message.scheduled_at) {
      push({ id: `sched-${message.id}`, at: message.scheduled_at, channel: "email", kind: "scheduled", title: `${label} programmée · ${clock(message.scheduled_at)}`, subject: message.subject, excerpt: excerptOf(message.body), body: message.body, tone: "warn", upcoming: true });
    } else if (message.send_status === "cancelled" || (message.send_error && message.send_status === "draft")) {
      push({ id: `cancel-${message.id}`, at: message.created_at, channel: "email", kind: "cancelled", title: `${label} : envoi annulé`, detail: message.send_error ?? null, subject: message.subject, tone: "neutral" });
    } else if (message.send_status === "failed") {
      push({ id: `failed-${message.id}`, at: message.created_at, channel: "email", kind: "failed", title: `${label} : échec d'envoi`, detail: message.send_error ?? null, subject: message.subject, tone: "lost" });
    }
  }

  const inbound = (row.inbound_messages ?? []).filter((message) => !message.deleted_at);
  for (const message of inbound) {
    const badge = inboundBadge(message);
    push({ id: `in-${message.id}`, at: message.received_at, channel: "email", kind: "received", title: `Mail reçu · ${clock(message.received_at)}`, subject: message.subject, excerpt: excerptOf(message.body), body: message.body, badge, tone: badge.tone });
  }

  // Relances : prévues, soldées, ou BLOQUÉES (même règle que l'envoi).
  const lastSent = messages.filter((message) => message.status === "sent").map((message) => message.sent_at ?? message.created_at).sort().at(-1) ?? "";
  const replied = inbound.some((message) => isProspectReply(message) && message.received_at > lastSent);
  const blocked = followUpBlock(row, { replied });
  for (const reminder of row.reminders ?? []) {
    const due = offWeekend(new Date(reminder.due_at)).toISOString();
    if (reminder.done) push({ id: `rem-${reminder.id}`, at: due, channel: "orion", kind: "reminder-done", title: "Relance soldée", tone: "neutral" });
    else if (blocked) push({ id: `rem-${reminder.id}`, at: due, channel: "orion", kind: "reminder-blocked", title: "Relance bloquée", detail: blocked, tone: "lost" });
    else push({ id: `rem-${reminder.id}`, at: due, channel: "orion", kind: "reminder", title: "Relance prévue", tone: "warn", upcoming: Date.parse(due) > now.getTime() });
  }

  // Événements ORION enregistrés (statut, ne plus contacter, opposition, notes) — et canaux futurs.
  const recorded = row.prospect_events ?? [];
  for (const event of recorded) {
    const data = event.data ?? {};
    const base = { id: `ev-${event.id}`, at: event.at, channel: event.channel, kind: event.kind };
    if (event.kind === "status") push({ ...base, title: `Statut : ${statusLabel(data.from)} → ${statusLabel(data.to)}`, tone: "info" });
    else if (event.kind === "dnc") push({ ...base, title: data.on === false ? "Retiré de « ne plus contacter »" : "Ajouté à « ne plus contacter »", tone: data.on === false ? "neutral" : "lost" });
    else if (event.kind === "opposition") push({ ...base, title: `Opposition vérifiée (${data.source === "inpi" ? "INPI" : data.source === "pappers" ? "Pappers" : "à la main"}) : ${data.refuses ? "opposée" : "non opposée"}`, tone: data.refuses ? "lost" : "good" });
    else if (event.kind === "send_failed") push({ ...base, title: String(data.title ?? "Envoi en échec"), detail: data.detail ? String(data.detail) : null, tone: "lost" });
    else if (event.kind === "antispam") push({ ...base, title: String(data.title ?? "Validation anti-spam"), tone: /annulée/.test(String(data.title ?? "")) ? "neutral" : "good" });
    // Cowork #51 : refus détecté dans une réponse (ou son annulation), nouveau correspondant rattaché.
    else if (event.kind === "refus" || event.kind === "contact") push({ ...base, title: String(data.title ?? "Réponse"), tone: event.kind === "refus" && data.undone !== true ? "lost" : "neutral" });
    else if (event.kind === "note") push({ ...base, title: "Note", body: String(data.text ?? ""), excerpt: excerptOf(String(data.text ?? "")), tone: "neutral" });
    else push({ ...base, title: String(data.title ?? `${event.channel} · ${event.kind}`), detail: data.detail ? String(data.detail) : null, tone: "info" });
  }

  // Ce que la fiche sait sans événement daté (fiches antérieures à l'historique).
  const figures = row.key_figures ?? {};
  if (!recorded.some((event) => event.kind === "opposition") && (figures.refuses_prospecting === true || figures.opposition_checked === true || figures.pappers_read === true)) {
    const source = figures.opposition_source === "inpi" ? "INPI" : figures.opposition_source === "manuel" ? "à la main" : "Pappers";
    const at = typeof figures.opposition_checked_at === "string" ? figures.opposition_checked_at : row.created_at;
    push({ id: `opp-${row.id}`, at, channel: "orion", kind: "opposition", title: `Opposition (registre, ${source}) : ${figures.refuses_prospecting === true ? "opposée" : "non opposée"}`, tone: figures.refuses_prospecting === true ? "lost" : "good" });
  }
  if (row.do_not_contact && !recorded.some((event) => event.kind === "dnc")) {
    push({ id: `dnc-${row.id}`, at: row.updated_at ?? row.created_at, channel: "orion", kind: "dnc", title: "Marqué « ne plus contacter »", tone: "lost" });
  }

  // Signaux à l'origine de la fiche.
  for (const candidate of row.signal_candidates ?? []) {
    const source = candidate.source === "bodacc" ? "BODACC" : candidate.source === "france-travail" ? "France Travail" : candidate.source;
    const label = candidate.facts?.jobTitle ? `offre « ${candidate.facts.jobTitle} »` : candidate.facts?.label ?? "signal";
    const at = candidate.date_signal ? `${candidate.date_signal}T12:00:00Z` : candidate.created_at;
    push({ id: `sig-${candidate.id}`, at, channel: "signal", kind: candidate.source, title: `Signal ${source} : ${label}`, tone: "info" });
  }
  if (!(row.signal_candidates ?? []).length) {
    (row.signals ?? []).slice(0, 3).forEach((signal, index) => {
      if (!signal.date) return;
      push({ id: `psig-${row.id}-${index}`, at: `${signal.date.slice(0, 10)}T12:00:00Z`, channel: "signal", kind: signal.type ?? "signal", title: `Signal ${signal.source ?? ""} : ${signal.label ?? ""}`.replace(/\s+/g, " ").trim(), tone: "info" });
    });
  }

  for (const deal of row.deals ?? []) {
    push({ id: `deal-${deal.id}`, at: deal.signed_at ?? deal.created_at, channel: "orion", kind: "deal", title: deal.status === "gagne" ? "Contrat signé" : `Affaire ${deal.status}`, tone: deal.status === "gagne" ? "good" : "neutral" });
  }

  // À heure égale, « Fiche créée » reste la première chose qui s'est passée (en bas).
  const rank = (event: HistoryEvent) => (event.kind === "created" ? 1 : 0);
  events.sort((a, b) => b.at.localeCompare(a.at) || rank(a) - rank(b) || a.id.localeCompare(b.id));

  const sent = messages.filter((message) => message.status === "sent" && message.type !== "note").length;
  const received = inbound.filter(isProspectReply).length;
  const contacts = [...messages.filter((m) => m.status === "sent").map((m) => m.sent_at ?? m.created_at), ...inbound.map((m) => m.received_at)].sort();
  const lastContactAt = contacts.at(-1) ?? null;
  const lastContactDays = lastContactAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastContactAt)) / 86_400_000)) : null;
  return { events, summary: { sent, received, lastContactAt, lastContactDays } };
}

/** Regroupement par jour (Paris), dans l'ordre de la chronologie. */
export function groupByDay(events: readonly HistoryEvent[]): { day: string; events: HistoryEvent[] }[] {
  const groups: { day: string; events: HistoryEvent[] }[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (last && last.day === event.day) last.events.push(event);
    else groups.push({ day: event.day, events: [event] });
  }
  return groups;
}

import { PROSPECT_STATUS_META } from "@/lib/constants";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";

/**
 * Réglages › Données — les volumes, en code pur.
 *
 * Rebonds : ORION ne reçoit pas de notification de non-distribution dédiée.
 * Un rebond se reconnaît dans la boîte de réception (mailer-daemon, postmaster,
 * « Delivery Status Notification », « Undeliverable »…). Les plaintes (signalé
 * comme spam) ne sont pas mesurables sans Google Postmaster Tools : l'écran le
 * dit au lieu d'afficher un faux zéro.
 */

export interface VolumeInput {
  prospects: { status: ProspectStatus; do_not_contact?: boolean | null }[];
  messages: { status: string; type?: string | null; gmail_message_id?: string | null; send_status?: string | null }[];
  inbound: { from_email: string; subject?: string | null }[];
  /** Étiquettes des fiches de « Aujourd'hui » (lib/today). */
  tags: string[];
}

export interface Volumes {
  prospects: number;
  byStatus: { status: ProspectStatus; label: string; count: number }[];
  byTag: { tag: string; count: number }[];
  doNotContact: number;
  /** Mails réellement partis (intro, relances, réponses). */
  sent: number;
  /** Envois en échec (non partis). */
  failed: number;
  replies: number;
  bounces: number;
  /** Rebonds ÷ envois, `null` sans envoi. */
  bounceRate: number | null;
}

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|noreply-dmarc)@/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|non remis|échec de (la )?remise|returned mail/i;

export function isBounce(message: { from_email: string; subject?: string | null }): boolean {
  return BOUNCE_SENDER.test(message.from_email.trim()) || BOUNCE_SUBJECT.test(message.subject ?? "");
}

export function buildVolumes(input: VolumeInput): Volumes {
  const sent = input.messages.filter((message) => message.status === "sent").length;
  const bounces = input.inbound.filter(isBounce).length;
  const tagCounts = new Map<string, number>();
  for (const tag of input.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  return {
    prospects: input.prospects.length,
    byStatus: PROSPECT_STATUSES.map((status) => ({
      status,
      label: PROSPECT_STATUS_META[status]?.label ?? status,
      count: input.prospects.filter((prospect) => prospect.status === status).length,
    })).filter((entry) => entry.count > 0),
    byTag: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    doNotContact: input.prospects.filter((prospect) => prospect.do_not_contact).length,
    sent,
    failed: input.messages.filter((message) => message.send_status === "failed").length,
    replies: input.inbound.filter((message) => !isBounce(message)).length,
    bounces,
    bounceRate: sent > 0 ? bounces / sent : null,
  };
}

/** Une cellule CSV : guillemets doublés, et pas de formule interprétée par le tableur. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const PROSPECT_CSV_COLUMNS = [
  "company_name",
  "siren",
  "status",
  "email",
  "website",
  "city",
  "sector",
  "size_range",
  "do_not_contact",
  "created_at",
] as const;

/** Export des prospects, séparateur « ; » (Excel français), BOM UTF-8 pour les accents. */
export function prospectsCsv(rows: readonly Record<string, unknown>[]): string {
  const lines = [PROSPECT_CSV_COLUMNS.join(";"), ...rows.map((row) => PROSPECT_CSV_COLUMNS.map((column) => csvCell(row[column])).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

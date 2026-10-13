import { readAll } from "@/lib/supabase/read-all";
import { buildDeliverabilityReport, REPORT_SINCE, type DeliverabilityReport, type ReportDraft, type ReportInbound, type ReportProspect, type ReportSent } from "./deliverability-report";

type Reader = { from: (table: string) => any };

/** Lectures du point délivrabilité (lecture seule, toutes les pages). */
export async function loadDeliverabilityReport(db: unknown, userId: string, now = new Date()): Promise<DeliverabilityReport> {
  const reader = db as Reader;
  const since = `${REPORT_SINCE}T00:00:00Z`;
  const [sent, inbound, prospects, drafts] = await Promise.all([
    readAll<ReportSent>(() => reader.from("messages").select("id, type, sent_at, prospect_id").eq("user_id", userId).eq("status", "sent").gte("sent_at", since).order("id")),
    readAll<ReportInbound>(() => reader.from("inbound_messages").select("from_email, subject, body, category, received_at, prospect_id").eq("user_id", userId).gte("received_at", since).order("id")),
    // Corbeille comprise : un rebond peut viser une fiche écartée depuis.
    readAll<ReportProspect>(() => reader.from("prospects").select("id, email, email_type").eq("user_id", userId).order("id")),
    readAll<ReportDraft>(() => reader.from("messages").select("type, created_at, quality_score").eq("user_id", userId).eq("type", "intro").gte("created_at", since).order("id")),
  ]);
  return buildDeliverabilityReport({ sent, inbound, prospects, drafts, now });
}

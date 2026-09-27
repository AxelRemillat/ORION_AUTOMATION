import type { Db } from "@/lib/trash/scope";
import type { Message, SendStatus } from "@/types";

/**
 * Lectures de l'écran sur les envois programmés : la liste du Cockpit, et les
 * résultats (parti / échoué) pas encore montrés, pour le badge de la barre de
 * navigation. Mails à la corbeille et prospects à la corbeille exclus.
 */

export interface OutboxItem {
  id: string;
  prospectId: string;
  companyName: string;
  subject: string | null;
  sendStatus: SendStatus;
  scheduledAt: string | null;
  scheduledTo: string | null;
  sendError: string | null;
}

type Row = Pick<
  Message,
  "id" | "prospect_id" | "subject" | "send_status" | "scheduled_at" | "scheduled_to" | "send_error"
>;

async function withCompanies(db: Db, rows: Row[]): Promise<OutboxItem[]> {
  const ids = [...new Set(rows.map((row) => row.prospect_id))];
  if (!ids.length) return [];
  const { data } = await db.from("prospects").select("id, company_name").in("id", ids).is("deleted_at", null);
  const names = new Map(((data ?? []) as { id: string; company_name: string }[]).map((row) => [row.id, row.company_name]));
  return rows
    .filter((row) => names.has(row.prospect_id))
    .map((row) => ({
      id: row.id,
      prospectId: row.prospect_id,
      companyName: names.get(row.prospect_id) as string,
      subject: row.subject,
      sendStatus: row.send_status ?? "draft",
      scheduledAt: row.scheduled_at ?? null,
      scheduledTo: row.scheduled_to ?? null,
      sendError: row.send_error ?? null,
    }));
}

const COLUMNS = "id, prospect_id, subject, send_status, scheduled_at, scheduled_to, send_error";

/** Envois à venir (programmés, en cours) et échecs à reprendre, par date. */
export async function upcomingSends(db: Db): Promise<OutboxItem[]> {
  const { data } = await db
    .from("messages")
    .select(COLUMNS)
    .in("send_status", ["scheduled", "sending", "failed"])
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  return withCompanies(db, (data ?? []) as Row[]);
}

/** Envois programmés partis ou échoués, pas encore annoncés à l'écran. */
export async function unseenResults(db: Db): Promise<OutboxItem[]> {
  const { data } = await db
    .from("messages")
    .select(COLUMNS)
    .in("send_status", ["sent", "failed"])
    .not("scheduled_at", "is", null)
    .is("send_seen_at", null)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(20);
  return withCompanies(db, (data ?? []) as Row[]);
}

export async function markResultsSeen(db: Db, ids: string[], now = new Date()): Promise<void> {
  if (!ids.length) return;
  await db.from("messages").update({ send_seen_at: now.toISOString() }).in("id", ids);
}

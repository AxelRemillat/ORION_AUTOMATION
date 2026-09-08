import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Message, Prospect, Reminder } from "@/types";
import { DueReminders } from "./_components/due-reminders";
import { PipelineBoard } from "./_components/pipeline-board";
import { buildRows, type DueReminderRow } from "./_lib/rows";

export const metadata = { title: "Suivi — Prospect" };

/** Fin de journée : une relance due aujourd'hui doit apparaître dès le matin. */
function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** Pipeline + relances du jour. Toutes les données passent par la RLS Supabase. */
export default async function SuiviPage() {
  await requireUser();
  const supabase = createClient();

  const [prospectsResult, messagesResult, remindersResult] = await Promise.all([
    supabase.from("prospects").select("*").order("updated_at", { ascending: false }),
    supabase.from("messages").select("*"),
    supabase.from("reminders").select("*").eq("done", false).order("due_at"),
  ]);

  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const messages = (messagesResult.data ?? []) as Message[];
  const reminders = (remindersResult.data ?? []) as Reminder[];

  const rows = buildRows(prospects, messages, reminders);
  const byId = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const limit = endOfToday();

  const due: DueReminderRow[] = reminders
    .filter((reminder) => reminder.due_at <= limit && byId.has(reminder.prospect_id))
    .map((reminder) => {
      const prospect = byId.get(reminder.prospect_id) as Prospect;
      return {
        id: reminder.id,
        prospectId: reminder.prospect_id,
        companyName: prospect.company_name,
        status: prospect.status,
        dueAt: reminder.due_at,
      };
    });

  const drafts = messages.filter((message) => message.status === "draft").length;

  return (
    <>
      <PageHeader
        title="Suivi"
        description={
          prospects.length === 0
            ? "Pipeline, relances programmées et deals en cours."
            : `${prospects.length} prospect${prospects.length > 1 ? "s" : ""} · ${drafts} brouillon${drafts > 1 ? "s" : ""} en attente d'envoi.`
        }
      />
      <DueReminders reminders={due} />
      <PipelineBoard rows={rows} />
    </>
  );
}

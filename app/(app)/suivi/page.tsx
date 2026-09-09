import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatEur } from "@/lib/utils";
import type { Deal, Message, Prospect, Reminder } from "@/types";
import { DueReminders } from "./_components/due-reminders";
import { PipelineBoard } from "./_components/pipeline-board";
import { splitPipelineValue } from "./_lib/estimates";
import { buildRows, type DueReminderRow } from "./_lib/rows";

export const metadata = { title: "Suivi · ORION" };

/** Fin de journée : une relance due aujourd'hui doit apparaître dès le matin. */
function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** Pipeline Kanban + relances du jour. Toutes les données passent par la RLS. */
export default async function SuiviPage() {
  await requireUser();
  const supabase = createClient();

  const [prospectsResult, messagesResult, remindersResult, dealsResult] = await Promise.all([
    supabase.from("prospects").select("*").order("updated_at", { ascending: false }),
    supabase.from("messages").select("*"),
    supabase.from("reminders").select("*").eq("done", false).order("due_at"),
    supabase.from("deals").select("*"),
  ]);

  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const messages = (messagesResult.data ?? []) as Message[];
  const reminders = (remindersResult.data ?? []) as Reminder[];
  const deals = (dealsResult.data ?? []) as Deal[];

  const rows = buildRows(prospects, messages, reminders, deals);
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

  const open = rows.filter((row) => row.stageKey !== "gagne" && row.stageKey !== "perdu");
  const value = splitPipelineValue(open.map((row) => row.value));
  const drafts = rows.reduce((total, row) => total + row.draftsCount, 0);

  const summary = [
    `${prospects.length} prospect${prospects.length > 1 ? "s" : ""}`,
    `${formatEur(value.real + value.example)} en jeu${value.example > 0 ? " (fourchettes indicatives incluses)" : ""}`,
    drafts > 0 ? `${drafts} brouillon${drafts > 1 ? "s" : ""} à envoyer` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Suivi"
        description={prospects.length === 0 ? "Pipeline, relances et contrats." : summary}
      />
      <DueReminders reminders={due} />
      <PipelineBoard rows={rows} />
    </>
  );
}

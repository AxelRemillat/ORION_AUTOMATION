import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/trash/portfolio";
import { requireUser } from "@/lib/auth";
import { offWeekend } from "@/lib/outbox/paris-time";
import { followUpBlock } from "@/lib/outbox/follow-up-policy";
import { offTargetReason } from "@/lib/funnel/off-target";
import { formatEur } from "@/lib/utils";
import type { Prospect } from "@/types";
import { DueReminders } from "./_components/due-reminders";
import { PipelineBoard } from "./_components/pipeline-board";
import { countValued, sumPipeline } from "./_lib/estimates";
import { buildRows, type DueReminderRow } from "./_lib/rows";
import { FamilyStats } from "./_components/family-stats";
import { loadVariantStats } from "@/lib/variants/load";

export const metadata = { title: "Pipeline · ORION" };

/** Famille (message_variants.family) de chaque intro ; colonne absente ou lecture en échec : aucune. */
async function introFamilies(supabase: ReturnType<typeof createClient>, ids: string[]): Promise<Map<string, string>> {
  const families = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await supabase.from("message_variants").select("message_id, family").in("message_id", ids.slice(index, index + 150)).not("family", "is", null);
    if (error) return families;
    for (const row of (data ?? []) as { message_id: string; family: string | null }[]) if (row.family) families.set(row.message_id, row.family);
  }
  return families;
}

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

  // Corbeille exclue : ses relances sont suspendues tant qu'elle y reste.
  const { prospects, messages, reminders, deals } = await loadPortfolio(
    supabase,
    ["messages", "reminders", "deals"],
    { orderBy: "updated_at", openRemindersOnly: true },
  );

  // Expérience n° 2 : famille de chaque intro (badge) et taux par famille (tableau).
  const families = await introFamilies(supabase, messages.filter((message) => message.type === "intro").map((message) => message.id));
  const { stats } = await loadVariantStats(supabase);
  const rows = buildRows(prospects, messages, reminders, deals, families);
  const byId = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const limit = endOfToday();

  // Même règle partout (lib/outbox/follow-up-policy.ts) : pas de relance le
  // week-end (repoussée au lundi), ni pour un prospect opposé, « ne plus
  // contacter », perdu ou qui a répondu.
  const due: DueReminderRow[] = reminders
    .map((reminder) => ({ reminder, dueAt: offWeekend(new Date(reminder.due_at)).toISOString() }))
    /*
     * Hors cible EN PLUS du blocage de relance : une ETI ou une filiale de
     * groupe ne doit pas apparaitre ici avec un bouton « Relancer ». ESPACE
     * 3000, categorie INSEE ETI, y figurait — `followUpBlock` ne regarde que
     * l opposition et le statut, pas la cible (Cowork #15).
     */
    .filter(({ reminder, dueAt }) => {
      const prospect = byId.get(reminder.prospect_id) ?? null;
      return dueAt <= limit && prospect !== null && !followUpBlock(prospect) && !offTargetReason(prospect);
    })
    .map(({ reminder, dueAt }) => {
      const prospect = byId.get(reminder.prospect_id) as Prospect;
      return {
        id: reminder.id,
        prospectId: reminder.prospect_id,
        companyName: prospect.company_name,
        status: prospect.status,
        dueAt,
      };
    });

  const open = rows.filter((row) => row.stageKey !== "gagne" && row.stageKey !== "perdu");
  const openValues = open.map((row) => row.value);
  const pipeline = sumPipeline(openValues);
  const valued = countValued(openValues);
  const drafts = rows.reduce((total, row) => total + row.draftsCount, 0);

  const summary = [
    `${prospects.length} prospect${prospects.length > 1 ? "s" : ""}`,
    valued > 0
      ? `${formatEur(pipeline)} en jeu sur ${valued} prospect${valued > 1 ? "s" : ""} chiffré${valued > 1 ? "s" : ""}`
      : "aucun montant estimé saisi",
    drafts > 0 ? `${drafts} brouillon${drafts > 1 ? "s" : ""} à envoyer` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={prospects.length === 0 ? "Pipeline, relances et contrats." : summary}
      />
      <DueReminders reminders={due} />
      <PipelineBoard rows={rows} />
      <div className="mt-6">
        <FamilyStats rows={stats.family ?? []} />
      </div>
    </>
  );
}

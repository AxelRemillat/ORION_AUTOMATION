import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatDate, formatEur } from "@/lib/utils";
import type { Deal, Message, Prospect, Reminder } from "@/types";
import { DealTimeline } from "../_components/deal-timeline";
import { FollowUpButton } from "../_components/follow-up-button";
import { ProspectSummary } from "../_components/prospect-summary";
import { EstimateInput } from "../_components/estimate-input";
import { StatusControl } from "../_components/status-control";
import { guessEmail } from "../_lib/contact";
import { dealValue } from "../_lib/estimates";
import { nextAction } from "../_lib/next-action";
import { STAGE_TONE_VARS, stageOf } from "../_lib/stages";
import { buildTimeline } from "../_lib/timeline";

/** Relance à proposer ensuite : la 1re tant qu'elle n'existe pas, puis la 2e. */
function nextFollowUp(messages: Message[]): "relance_1" | "relance_2" | null {
  const has = (type: Message["type"]) => messages.some((message) => message.type === type);
  if (!has("relance_1")) return "relance_1";
  if (!has("relance_2")) return "relance_2";
  return null;
}

/** Fiche prospect : étape, timeline de l'affaire, valeur, chiffres clés. */
export default async function ProspectDetailPage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = createClient();

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!prospect) notFound();

  const [messagesResult, dealsResult, remindersResult] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("prospect_id", params.id)
      .order("created_at", { ascending: true }),
    supabase.from("deals").select("*").eq("prospect_id", params.id),
    supabase.from("reminders").select("*").eq("prospect_id", params.id).order("due_at"),
  ]);

  const messages = (messagesResult.data ?? []) as Message[];
  const deals = (dealsResult.data ?? []) as Deal[];
  const reminders = (remindersResult.data ?? []) as Reminder[];
  const typed = prospect as Prospect;

  const stage = stageOf(typed.status);
  const tone = STAGE_TONE_VARS[stage.tone];
  const value = dealValue(deals);
  const openReminder = reminders.find((reminder) => !reminder.done);
  const action = nextAction({
    status: typed.status,
    draftsCount: messages.filter((message) => message.status === "draft").length,
    nextDueAt: openReminder?.due_at ?? null,
  });
  const events = buildTimeline(messages, reminders, deals);
  const followUp = nextFollowUp(messages);

  return (
    <>
      <Link
        href="/suivi"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au pipeline
      </Link>

      <PageHeader
        title={typed.company_name}
        description={[typed.sector, typed.city].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
              style={{ background: tone.soft, color: tone.accent }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} aria-hidden />
              {stage.label}
            </span>
            {followUp && <FollowUpButton prospectId={typed.id} type={followUp} />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-halo" aria-hidden />
            <CardHeader className="relative flex-row flex-wrap items-end justify-between gap-4">
              <div className="min-w-[220px]">
                <CardTitle>Prochaine action</CardTitle>
                <p className="mt-1 text-[13px] text-muted">
                  {action.label}
                  {action.dueAt && (
                    <span className="font-data ml-1.5 text-[12px] text-faint">
                      {formatDate(action.dueAt)}
                    </span>
                  )}
                </p>
                {typed.pain_point && (
                  <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-faint">
                    {typed.pain_point}
                  </p>
                )}
              </div>
              <StatusControl prospectId={typed.id} status={typed.status} hasDeal={deals.length > 0} />
            </CardHeader>

            <CardContent className="relative flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <span title={value.basis}>Montant estimé</span>
                <EstimateInput
                  prospectId={typed.id}
                  amount={value.amount}
                  editable={value.basis !== "Montant du contrat signé"}
                />
              </span>
              <span className="text-[13px] text-muted">
                {messages.filter((message) => message.status === "sent").length} message(s) envoyé(s)
                · {messages.filter((message) => message.status === "draft").length} brouillon(s)
              </span>
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tight text-text">
              Fil de l&apos;affaire
            </h2>
            <DealTimeline events={events} prospectId={typed.id} defaultTo={guessEmail(typed)} />
          </div>
        </div>

        <ProspectSummary prospect={typed} deals={deals} reminders={reminders} />
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  ProspectStatusBadge,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Deal, Message, Prospect, Reminder } from "@/types";
import { FollowUpButton } from "../_components/follow-up-button";
import { MessageTimeline } from "../_components/message-timeline";
import { ProspectSummary } from "../_components/prospect-summary";
import { StatusControl } from "../_components/status-control";
import { guessEmail } from "../_lib/contact";

/** Relance à proposer ensuite : la 1re tant qu'elle n'existe pas, puis la 2e. */
function nextFollowUp(messages: Message[]): "relance_1" | "relance_2" | null {
  const has = (type: Message["type"]) => messages.some((message) => message.type === type);
  if (!has("relance_1")) return "relance_1";
  if (!has("relance_2")) return "relance_2";
  return null;
}

/** Fiche prospect : statut, historique des messages, chiffres clés, contrats. */
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
  const followUp = nextFollowUp(messages);

  return (
    <>
      <Link
        href="/suivi"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au pipeline
      </Link>

      <PageHeader
        title={typed.company_name}
        description={[typed.sector, typed.city].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <ProspectStatusBadge status={typed.status} className="mr-1" />
            {followUp && <FollowUpButton prospectId={typed.id} type={followUp} />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
              <div>
                <CardTitle>Où en est ce prospect</CardTitle>
                {typed.pain_point && (
                  <p className="mt-1 max-w-prose text-[13px] text-muted">{typed.pain_point}</p>
                )}
              </div>
              <StatusControl
                prospectId={typed.id}
                status={typed.status}
                hasDeal={deals.length > 0}
              />
            </CardHeader>
            <CardContent className="pt-2 text-[13px] text-muted">
              {messages.filter((message) => message.status === "sent").length} message(s) envoyé(s) ·{" "}
              {messages.filter((message) => message.status === "draft").length} brouillon(s)
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-fg">Historique</h2>
            <MessageTimeline
              messages={messages}
              prospectId={typed.id}
              defaultTo={guessEmail(typed)}
            />
          </div>
        </div>

        <ProspectSummary prospect={typed} deals={deals} reminders={reminders} />
      </div>
    </>
  );
}

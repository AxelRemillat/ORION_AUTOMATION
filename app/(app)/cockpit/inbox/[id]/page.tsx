import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { activeProspects } from "@/lib/trash/scope";
import type { InboundMessage, Message, Prospect } from "@/types";
import { currentReplyDraft } from "@/lib/outbox/reply-draft";
import { MailTrashButton } from "@/components/outbox/mail-trash-button";
import { DoNotContactButton } from "@/components/outbox/do-not-contact-button";
import { ReplyComposer } from "./reply-composer";
import { ThreadView, type ThreadEntry } from "./thread-view";

export const metadata = { title: "Réponse reçue — ORION" };

/**
 * Fil d'une conversation, ouvert depuis la boîte de réception du Cockpit.
 *
 * Réunit les deux sens : les messages partis (`messages`) et ceux reçus
 * (`inbound_messages`), remis dans l'ordre. C'est le contexte que lit l'IA pour
 * proposer une réponse, et celui que relit l'utilisateur avant de valider.
 */
export default async function InboxThreadPage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = createClient();

  // La RLS restreint déjà à l'utilisateur courant.
  const { data } = await supabase
    .from("inbound_messages")
    .select("*")
    .eq("id", params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const inbound = data as InboundMessage;

  let prospect: Prospect | null = null;
  let messages: Message[] = [];
  let inbounds: InboundMessage[] = [inbound];

  if (inbound.prospect_id) {
    const [prospectResult, messagesResult, inboundResult] = await Promise.all([
      activeProspects(supabase).eq("id", inbound.prospect_id).maybeSingle(),
      supabase
        .from("messages")
        .select("*")
        .eq("prospect_id", inbound.prospect_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("inbound_messages")
        .select("*")
        .eq("prospect_id", inbound.prospect_id)
        .is("deleted_at", null)
        .order("received_at", { ascending: true }),
    ]);
    prospect = (prospectResult.data as Prospect) ?? null;
    // Réponse d'un prospect mis à la corbeille : masquée avec lui.
    if (!prospect) notFound();
    messages = (messagesResult.data ?? []) as Message[];
    const received = (inboundResult.data ?? []) as InboundMessage[];
    if (received.length) inbounds = received;
  }

  // Seuls les messages réellement partis font partie du fil : un brouillon
  // jamais envoyé n'a pas été lu par l'interlocuteur.
  const replyDraft = await currentReplyDraft(supabase, inbound.id).catch(() => null);

  const entries: ThreadEntry[] = [
    ...messages
      .filter((message) => message.status === "sent")
      .map((message) => ({
        id: message.id,
        who: "moi" as const,
        subject: message.subject,
        body: message.body,
        at: message.sent_at ?? message.created_at,
      })),
    ...inbounds.map((item) => ({
      id: item.id,
      who: "lui" as const,
      subject: item.subject,
      body: item.body,
      at: item.received_at,
      answering: item.id === inbound.id,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <>
      <Link
        href="/cockpit"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au Cockpit
      </Link>

      <PageHeader
        title={prospect?.company_name ?? inbound.from_email}
        description={
          prospect
            ? `Conversation avec ${inbound.from_email}.`
            : "Expéditeur non rattaché à un prospect."
        }
        actions={
          <>
            {prospect && (
              <DoNotContactButton
                prospectId={prospect.id}
                companyName={prospect.company_name}
                active={Boolean(prospect.do_not_contact)}
              />
            )}
            <MailTrashButton messageId={inbound.id} kind="received" label="ce mail reçu" redirectTo="/cockpit" />
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <ThreadView entries={entries} />
        <ReplyComposer
          key={replyDraft?.id ?? "new"}
          inboundId={inbound.id}
          prospectId={inbound.prospect_id}
          defaultTo={inbound.from_email}
          draft={replyDraft}
        />
      </div>
    </>
  );
}

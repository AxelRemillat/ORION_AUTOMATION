import { MailCheck, PenLine } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { Message } from "@/types";
import { SendMessageDialog } from "./send-message-dialog";

/** Historique complet des échanges d'un prospect, du plus ancien au plus récent. */
export function MessageTimeline({
  messages,
  prospectId,
  defaultTo,
}: {
  messages: Message[];
  prospectId: string;
  defaultTo: string;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Aucun message pour ce prospect"
        description="Rédigez l'introduction depuis la Prospection, ou générez directement une relance ci-dessus."
      />
    );
  }

  return (
    <ol className="space-y-3">
      {messages.map((message) => {
        const sent = message.status === "sent";
        return (
          <li
            key={message.id}
            className="rounded-lg border border-border bg-surface p-4 shadow-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sent ? "success" : "warning"}>
                {sent ? (
                  <MailCheck className="h-3 w-3" aria-hidden />
                ) : (
                  <PenLine className="h-3 w-3" aria-hidden />
                )}
                {sent ? "Envoyé" : "Brouillon"}
              </Badge>
              <Badge tone="neutral">{MESSAGE_TYPE_LABELS[message.type]}</Badge>
              <span className="text-[12px] text-muted">
                {sent ? formatDateTime(message.sent_at) : `créé le ${formatDateTime(message.created_at)}`}
              </span>
              {!sent && message.type !== "note" && (
                <div className="ml-auto">
                  <SendMessageDialog
                    prospectId={prospectId}
                    messageId={message.id}
                    subject={message.subject}
                    body={message.body}
                    defaultTo={defaultTo}
                  />
                </div>
              )}
            </div>

            {message.subject && (
              <p className="mt-3 text-sm font-medium text-fg">{message.subject}</p>
            )}
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
              {message.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

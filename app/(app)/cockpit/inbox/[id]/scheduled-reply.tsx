"use client";

import { Card, CardContent } from "@/components/ui";
import type { ReplyDraft } from "@/lib/outbox/reply-draft";
import { MailActions } from "@/components/outbox/mail-actions";

/** Réponse déjà programmée : son texte et ses actions (envoyer, déprogrammer…). */
export function ScheduledReply({ draft, defaultTo }: { draft: ReplyDraft; defaultTo: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Réponse programmée</h2>
        {draft.subject && <p className="text-sm font-medium text-text">{draft.subject}</p>}
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{draft.body}</p>
        <MailActions
          state={{
            messageId: draft.id,
            sendStatus: draft.send_status,
            scheduledAt: draft.scheduled_at,
            scheduledTo: draft.scheduled_to,
            sendError: draft.send_error,
          }}
          defaultTo={defaultTo}
          label="la réponse"
        />
      </CardContent>
    </Card>
  );
}

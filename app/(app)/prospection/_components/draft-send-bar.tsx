"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui";
import { MailActions, type MailSendState } from "@/components/outbox/mail-actions";
import { MailTrashButton } from "@/components/outbox/mail-trash-button";
import type { Message } from "@/types";

type Row = Pick<Message, "status" | "send_status" | "scheduled_at" | "scheduled_to" | "send_error">;

/**
 * Sous l'éditeur : programmer l'envoi du brouillon enregistré, ou le mettre à
 * la corbeille. La programmation n'est proposée qu'une fois le brouillon
 * VALIDÉ (relu) ; la corbeille, toujours.
 */
export function DraftSendBar({
  messageId,
  defaultTo,
  validated,
  companyName,
  onTrashed,
}: {
  messageId: string;
  defaultTo: string;
  validated: boolean;
  companyName: string;
  onTrashed: () => void;
}) {
  const [state, setState] = useState<MailSendState | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await createClient()
      .from("messages")
      .select("status, send_status, scheduled_at, scheduled_to, send_error")
      .eq("id", messageId)
      .is("deleted_at", null)
      .maybeSingle();
    const row = data as Row | null;
    setState(
      row
        ? {
            messageId,
            sendStatus: row.status === "sent" ? "sent" : (row.send_status ?? "draft"),
            scheduledAt: row.scheduled_at ?? null,
            scheduledTo: row.scheduled_to ?? null,
            sendError: row.send_error ?? null,
          }
        : null,
    );
  }, [messageId]);

  useEffect(() => void refresh(), [refresh]);
  if (!state) return null;
  const label = `le brouillon pour ${companyName}`;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-[13px] text-muted">
          {validated
            ? "Envoyez-le depuis la fiche du Suivi, ou programmez son départ."
            : "Validez le brouillon pour pouvoir programmer son envoi."}
        </p>
        {validated ? (
          <MailActions state={state} defaultTo={defaultTo} label={label} onTrashed={onTrashed} onChanged={refresh} />
        ) : (
          <MailTrashButton messageId={messageId} label={label} onTrashed={onTrashed} />
        )}
      </CardContent>
    </Card>
  );
}

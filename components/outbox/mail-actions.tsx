"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { unscheduleMail } from "@/lib/outbox/actions";
import type { SendStatus } from "@/types";
import { MailTrashButton } from "./mail-trash-button";
import { ScheduleDialog } from "./schedule-dialog";
import { SendStateBadge } from "./send-state-badge";

export interface MailSendState {
  messageId: string;
  sendStatus?: SendStatus | null;
  scheduledAt?: string | null;
  scheduledTo?: string | null;
  sendError?: string | null;
}

/**
 * Actions d'un brouillon non envoyé : état d'envoi, programmer / modifier
 * l'heure, annuler la programmation (retour en brouillon), corbeille.
 * Rien n'est proposé pendant l'envoi ni après : l'historique ne se touche pas.
 */
export function MailActions({
  state,
  defaultTo,
  label,
  onTrashed,
  onChanged,
}: {
  state: MailSendState;
  defaultTo: string;
  /** Nom du mail dans les toasts (« le brouillon pour ACME »). */
  label?: string;
  onTrashed?: () => void;
  /** Programmation posée ou annulée : l'appelant peut relire l'état. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const status = state.sendStatus ?? "draft";
  if (status === "sent" || status === "sending") {
    return <SendStateBadge sendStatus={status} />;
  }
  const scheduled = status === "scheduled";

  function unschedule() {
    startTransition(async () => {
      const result = await unscheduleMail(state.messageId);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Programmation annulée : le mail redevient un brouillon.");
      onChanged?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SendStateBadge sendStatus={status} scheduledAt={state.scheduledAt} sendError={state.sendError} />
      {status === "failed" && state.sendError && (
        <span className="max-w-[320px] truncate text-[12px] text-lost-ink" title={state.sendError}>
          {state.sendError}
        </span>
      )}
      <ScheduleDialog
        messageId={state.messageId}
        defaultTo={defaultTo}
        scheduledAt={scheduled ? state.scheduledAt : null}
        scheduledTo={state.scheduledTo}
        onScheduled={onChanged}
      />
      {scheduled && (
        <Button size="sm" variant="ghost" onClick={unschedule} loading={pending}>
          <CalendarX className="h-3.5 w-3.5" aria-hidden />
          Annuler l&apos;envoi programmé
        </Button>
      )}
      <MailTrashButton messageId={state.messageId} label={label} onTrashed={onTrashed} />
    </div>
  );
}
